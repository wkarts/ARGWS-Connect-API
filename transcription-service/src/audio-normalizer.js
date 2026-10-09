'use strict';

// Only the speech executor calls this module. Never rewrite provider media.
const fs = require('node:fs');
const fsp = fs.promises;
const RATE = 16000;
const fail = (message, code = 'INVALID_AUDIO') => Object.assign(new Error(message), { code, retryable: false });

function speechWindow(config, mode) {
  const requested = Number(mode === 'dictation' ? config.dictationChunkSeconds ?? config.chunkSeconds : config.chunkSeconds);
  const seconds = Number.isFinite(requested) && requested > 0 ? Math.min(30, requested) : 30;
  const overlap = Number(mode === 'dictation' ? config.dictationStrideSeconds ?? config.strideSeconds : config.strideSeconds);
  // A stride >= window previously advanced only one sample per inference.
  const strideSeconds = Number.isFinite(overlap) ? Math.max(0, Math.min(overlap, seconds / 2)) : 0;
  return { seconds, strideSeconds };
}

function isDigitalSilence(samples) {
  for (let i = 0; i < samples.length; i += 1) if (samples[i] !== 0) return false;
  return true;
}

async function readExactly(handle, buffer, position) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, position + offset);
    if (!bytesRead) throw fail('WAV truncado.');
    offset += bytesRead;
  }
}

/**
 * Fast path for canonical mono 16 kHz PCM16/float32 WAV. Other formats return
 * null and retain the bounded FFmpeg decoder. Reads at most one ASR window;
 * creates neither a decoder process nor a temporary PCM file.
 */
async function decodeNormalizedWav(filePath, options = {}) {
  if (options.isCancelled?.()) throw fail('Processamento cancelado.', 'CANCELLED');
  const start = Number(options.startSeconds ?? 0);
  const duration = Number(options.chunkSeconds ?? 0);
  if (!Number.isFinite(start) || start < 0 || !Number.isFinite(duration) || duration <= 0 || duration > 31) return null;
  const handle = await fsp.open(filePath, fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0));
  try {
    const info = await handle.stat();
    if (!info.isFile()) throw fail('A fonte de áudio não é um arquivo regular.');
    if (info.size < 12) return null;
    const header = Buffer.alloc(12);
    await readExactly(handle, header, 0);
    if (header.toString('ascii', 0, 4) !== 'RIFF' || header.toString('ascii', 8, 12) !== 'WAVE') return null;
    const end = header.readUInt32LE(4) + 8;
    if (end > info.size || end < 12) throw fail('Tamanho RIFF inválido.');
    let format;
    let cursor = 12;
    for (let chunks = 0; cursor + 8 <= end && chunks < 128 && cursor <= 65536; chunks += 1) {
      const entry = Buffer.alloc(8);
      await readExactly(handle, entry, cursor);
      const type = entry.toString('ascii', 0, 4);
      const size = entry.readUInt32LE(4);
      const dataOffset = cursor + 8;
      if (dataOffset + size > end) throw fail('Chunk WAV truncado.');
      if (type === 'fmt ') {
        if (format || size < 16) return null;
        const fmt = Buffer.alloc(16);
        await readExactly(handle, fmt, dataOffset);
        const codec = fmt.readUInt16LE(0);
        const channels = fmt.readUInt16LE(2);
        const rate = fmt.readUInt32LE(4);
        const bytesPerSecond = fmt.readUInt32LE(8);
        const align = fmt.readUInt16LE(12);
        const bits = fmt.readUInt16LE(14);
        if (channels !== 1 || rate !== RATE || !((codec === 1 && bits === 16) || (codec === 3 && bits === 32))) return null;
        if (align !== bits / 8 || bytesPerSecond !== RATE * align) throw fail('Formato PCM inconsistente.');
        format = { codec, align };
      } else if (type === 'data') {
        if (!format) return null;
        if (size % format.align) throw fail('Amostra PCM incompleta.');
        const total = size / format.align;
        const first = Math.round(start * RATE);
        const maximum = Math.ceil(duration * RATE);
        if (!Number.isSafeInteger(first) || !Number.isSafeInteger(maximum)) throw fail('Janela PCM inválida.');
        const count = Math.min(maximum, Math.max(0, total - first));
        if (!count && !options.allowEmpty) throw fail('O áudio não contém amostras.');
        const bytes = Buffer.alloc(count * format.align);
        await readExactly(handle, bytes, dataOffset + first * format.align);
        const samples = new Float32Array(count);
        for (let i = 0; i < count; i += 1) {
          const sample = format.codec === 1 ? bytes.readInt16LE(i * 2) / 32768 : bytes.readFloatLE(i * 4);
          if (!Number.isFinite(sample)) throw fail('Amostra PCM não finita.');
          samples[i] = Math.max(-1, Math.min(1, sample));
        }
        if (options.isCancelled?.()) throw fail('Processamento cancelado.', 'CANCELLED');
        return { samples, samplesCount: count, durationMs: Math.round(count / RATE * 1000),
          normalization: 'native-wav', dispose: async () => {} };
      }
      cursor = dataOffset + size + (size % 2);
    }
    return null;
  } finally { await handle.close(); }
}

module.exports = { decodeNormalizedWav, speechWindow, isDigitalSilence };
