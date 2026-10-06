import { SendAudioDto } from '@api/dto/sendMessage.dto';
import { BadRequestException } from '@exceptions';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';
import axios from 'axios';
import { spawn } from 'child_process';
import { isBase64, isURL } from 'class-validator';
import mimeTypes from 'mime-types';
import path from 'path';

const MAX_AUDIO_BYTES = 25 * 1024 * 1024;
const MAX_VOICE_SECONDS = 600;
const PCM_SAMPLES_PER_SECOND = 8000;
const VOICE_MIME = 'audio/ogg; codecs=opus';

type SourceFile = { buffer?: Buffer; mimetype?: string; originalname?: string };

export type OutgoingAudio = {
  buffer: Buffer;
  mimetype: string;
  ptt: boolean;
  seconds?: number;
  waveform?: Uint8Array;
};

/** Caller intent and the protocol PTT bit are stronger than container, codec or filename. */
export function isVoiceNote(data: Pick<SendAudioDto, 'intent' | 'ptt' | 'recordedByMicrophone'>): boolean {
  const explicitVoice = ['voice_note', 'dictation', 'transcription'].includes(data.intent || '');
  const explicitGeneric = ['attachment', 'music', 'generic_audio'].includes(data.intent || '');
  if ((explicitVoice && data.ptt === false) || (explicitGeneric && data.ptt === true)) {
    throw new BadRequestException('intent e ptt são incompatíveis.');
  }
  if (explicitVoice) return true;
  if (explicitGeneric) return false;
  if (data.ptt !== undefined) return data.ptt;
  if (data.recordedByMicrophone !== undefined) return data.recordedByMicrophone;
  // The existing sendWhatsAppAudio route has always meant PTT. Only explicit
  // auto mode changes that fallback; an OGG/Opus file alone is never evidence.
  return data.intent !== 'auto';
}

function mimeFromFileName(fileName?: string): string | undefined {
  const extension = path.extname(String(fileName || '').split('?')[0]).toLowerCase();
  return (extension && mimeTypes.lookup(`file${extension}`)) || undefined;
}

function detectAudioMime(bytes: Buffer): string | undefined {
  if (bytes.subarray(0, 4).toString('ascii') === 'OggS') return 'audio/ogg';
  if (bytes.subarray(0, 4).toString('ascii') === 'RIFF' && bytes.subarray(8, 12).toString('ascii') === 'WAVE') {
    return 'audio/wav';
  }
  if (bytes.subarray(0, 3).toString('ascii') === 'ID3') return 'audio/mpeg';
  return undefined;
}

async function loadAudio(data: SendAudioDto, file?: SourceFile): Promise<{ buffer: Buffer; mimetype: string }> {
  let buffer: Buffer;
  let declaredMime = file?.mimetype || '';
  let fileName = file?.originalname || data.fileName;

  if (file?.buffer) {
    buffer = file.buffer;
  } else if (isURL(data.audio || '')) {
    const url = new URL(data.audio);
    if (!['http:', 'https:'].includes(url.protocol)) throw new BadRequestException('URL de áudio inválida.');
    const response = await axios.get(data.audio, { responseType: 'stream', timeout: 30_000, maxRedirects: 3 });
    declaredMime = String(response.headers['content-type'] || '');
    fileName = url.pathname;
    const chunks: Buffer[] = [];
    let size = 0;
    try {
      for await (const chunk of response.data) {
        const bytes = Buffer.from(chunk);
        size += bytes.length;
        if (size > MAX_AUDIO_BYTES) throw new BadRequestException('Áudio excede o limite de 25 MiB.');
        chunks.push(bytes);
      }
    } catch (error) {
      response.data.destroy();
      throw error;
    }
    buffer = Buffer.concat(chunks, size);
  } else {
    const value = String(data.audio || '');
    const uri = /^data:([^;,]+)?(?:;charset=[^;,]+)?;base64,(.+)$/s.exec(value);
    const base64 = uri?.[2] || value;
    if (!isBase64(base64)) throw new BadRequestException('Envie arquivo, URL ou áudio em base64 válido.');
    if (base64.length > Math.ceil((MAX_AUDIO_BYTES * 4) / 3) + 4) {
      throw new BadRequestException('Áudio excede o limite de 25 MiB.');
    }
    declaredMime = uri?.[1] || '';
    buffer = Buffer.from(base64, 'base64');
  }

  if (!buffer.length) throw new BadRequestException('O áudio está vazio.');
  if (buffer.length > MAX_AUDIO_BYTES) throw new BadRequestException('Áudio excede o limite de 25 MiB.');
  const responseMime = String(declaredMime).split(';', 1)[0].trim().toLowerCase();
  const mimetype = String(
    data.mimetype ||
      (responseMime.startsWith('audio/') ? responseMime : '') ||
      mimeFromFileName(fileName) ||
      detectAudioMime(buffer) ||
      '',
  )
    .split(';', 1)[0]
    .trim()
    .toLowerCase();
  return { buffer, mimetype };
}

function runFfmpeg(input: Buffer, args: string[], maxOutputBytes: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPath.path, [
      '-hide_banner',
      '-loglevel',
      'error',
      '-i',
      'pipe:0',
      '-vn',
      ...args,
      'pipe:1',
    ]);
    const chunks: Buffer[] = [];
    let total = 0;
    let stderr = '';
    let settled = false;
    const timer = setTimeout(() => fail(new Error('Tempo limite de conversão de áudio excedido.')), 120_000);

    function fail(error: Error) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.kill('SIGKILL');
      reject(error);
    }

    child.stdout.on('data', (chunk: Buffer) => {
      total += chunk.length;
      if (total > maxOutputBytes) return fail(new Error('Áudio excede o limite de processamento.'));
      chunks.push(chunk);
    });
    child.stderr.on('data', (chunk: Buffer) => {
      stderr = (stderr + chunk.toString()).slice(-600);
    });
    child.stdin.on('error', (error: Error) => fail(error));
    child.on('error', (error: Error) => fail(error));
    child.on('close', (code: number) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (code !== 0 || total === 0) {
        reject(new Error(`Áudio inválido ou conversão indisponível: ${stderr || code}`));
      } else {
        resolve(Buffer.concat(chunks, total));
      }
    });
    child.stdin.end(input);
  });
}

function oggOpus(buffer: Buffer): boolean {
  return buffer.subarray(0, 4).toString('ascii') === 'OggS' && buffer.subarray(0, 4096).includes('OpusHead');
}

function waveformFromPcm(pcm: Buffer): Uint8Array {
  const waveform = new Uint8Array(64);
  const block = Math.max(1, Math.ceil(pcm.length / waveform.length));
  let peak = 0;
  for (let index = 0; index < waveform.length; index += 1) {
    const start = index * block;
    const end = Math.min(start + block, pcm.length);
    let volume = 0;
    for (let sample = start; sample < end; sample += 1) volume += Math.abs(pcm[sample] - 128);
    waveform[index] = end > start ? Math.min(127, Math.round(volume / (end - start))) : 0;
    peak = Math.max(peak, waveform[index]);
  }
  if (peak)
    for (let index = 0; index < waveform.length; index += 1) {
      waveform[index] = Math.round((waveform[index] * 100) / peak);
    }
  return waveform;
}

/** Shared by Baileys and Zapo. STT is intentionally decoded only inside its bounded worker. */
export async function prepareOutgoingAudio(data: SendAudioDto, file?: SourceFile): Promise<OutgoingAudio> {
  const ptt = isVoiceNote(data);
  const source = await loadAudio(data, file);
  if (!ptt) {
    if (!/^audio\/[a-z0-9.+-]{1,80}$/.test(source.mimetype)) {
      throw new BadRequestException('Informe um MIME de áudio válido.');
    }
    return { buffer: source.buffer, mimetype: source.mimetype, ptt: false };
  }

  if (data.encoding === false && !oggOpus(source.buffer)) {
    throw new BadRequestException('encoding=false exige áudio OGG/Opus válido para PTT.');
  }
  let buffer = source.buffer;
  if (data.encoding !== false) {
    try {
      buffer = await runFfmpeg(
        source.buffer,
        [
          '-t',
          String(MAX_VOICE_SECONDS + 1),
          '-ac',
          '1',
          '-ar',
          '48000',
          '-c:a',
          'libopus',
          '-b:a',
          '24k',
          '-application',
          'voip',
          '-f',
          'ogg',
        ],
        MAX_AUDIO_BYTES,
      );
    } catch (error) {
      throw new BadRequestException(String((error as Error).message || error));
    }
  }
  // Sampling at 8 kHz retains the speech envelope and bounds this intermediate to ~4.8 MiB.
  let pcm: Buffer;
  try {
    pcm = await runFfmpeg(
      buffer,
      ['-t', String(MAX_VOICE_SECONDS + 1), '-ac', '1', '-ar', String(PCM_SAMPLES_PER_SECOND), '-f', 'u8'],
      (MAX_VOICE_SECONDS + 2) * PCM_SAMPLES_PER_SECOND,
    );
  } catch (error) {
    throw new BadRequestException(String((error as Error).message || error));
  }
  if (pcm.length > MAX_VOICE_SECONDS * PCM_SAMPLES_PER_SECOND) {
    throw new BadRequestException('Nota de voz excede o limite de 10 minutos; envie como áudio comum.');
  }
  return {
    buffer,
    mimetype: VOICE_MIME,
    ptt: true,
    seconds: Math.max(1, Math.ceil(pcm.length / PCM_SAMPLES_PER_SECOND)),
    waveform: waveformFromPcm(pcm),
  };
}
