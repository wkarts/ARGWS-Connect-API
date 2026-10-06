import { strict as assert } from 'node:assert';
import { spawnSync } from 'node:child_process';
import { test } from 'node:test';

import { isVoiceNote, prepareOutgoingAudio } from '@api/services/audio-message.service';
import ffmpegPath from '@ffmpeg-installer/ffmpeg';

import { messages } from '../manager/src/services/normalizers';

test('intenção explícita prevalece, auto não deduz voz do MIME e legado continua PTT', () => {
  assert.equal(isVoiceNote({}), true);
  assert.equal(isVoiceNote({ intent: 'auto' }), false);
  assert.equal(isVoiceNote({ intent: 'auto', recordedByMicrophone: true }), true);
  assert.equal(isVoiceNote({ intent: 'music', recordedByMicrophone: true }), false);
  assert.equal(isVoiceNote({ intent: 'dictation' }), true);
  assert.throws(() => isVoiceNote({ intent: 'attachment', ptt: true }), (error: any) => error.status === 400);
  assert.throws(() => isVoiceNote({ intent: 'voice_note', ptt: false }), (error: any) => error.status === 400);
});

test('áudio comum conserva bytes e MIME sem marcar PTT; preconvertido inválido falha', async () => {
  const original = Buffer.from('ID3\x03\x00\x00amostra', 'latin1');
  const file = { buffer: original, mimetype: 'audio/mpeg', originalname: 'music.mp3' };
  const prepared = await prepareOutgoingAudio({ number: '5575988881111', audio: '', intent: 'auto' }, file);
  assert.equal(prepared.buffer, original);
  assert.equal(prepared.mimetype, 'audio/mpeg');
  assert.equal(prepared.ptt, false);
  assert.equal(prepared.waveform, undefined);
  await assert.rejects(
    prepareOutgoingAudio({ number: '5575988881111', audio: '', encoding: false }, file),
    (error: any) => error.status === 400 && String(error.message[0]).includes('OGG/Opus'),
  );
});

test('mensagem recebida usa o bit PTT, não o MIME OGG, para identificar nota de voz', () => {
  const received = messages([
    { id: 'voice', messageType: 'audioMessage', message: { audioMessage: { mimetype: 'audio/ogg', ptt: true } } },
    { id: 'music', messageType: 'audioMessage', message: { audioMessage: { mimetype: 'audio/ogg', ptt: false } } },
  ]);
  assert.equal(received[0].isVoiceNote, true);
  assert.equal(received[0].text, 'Nota de voz');
  assert.equal(received[1].isVoiceNote, false);
  assert.equal(received[1].text, 'Áudio');
});

test('nota de voz é OGG/Opus mono com duração e waveform bounded', async () => {
  const fixture = spawnSync(ffmpegPath.path, [
    '-hide_banner', '-loglevel', 'error', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=1',
    '-ar', '16000', '-ac', '1', '-c:a', 'pcm_s16le', '-f', 'wav', 'pipe:1',
  ], { maxBuffer: 128 * 1024 });
  assert.equal(fixture.status, 0, fixture.stderr.toString());
  const file = { buffer: fixture.stdout, mimetype: 'audio/wav', originalname: 'recording.wav' };
  const voice = await prepareOutgoingAudio({ number: '5575988881111', audio: '', intent: 'voice_note' }, file);
  assert.equal(voice.ptt, true);
  assert.equal(voice.mimetype, 'audio/ogg; codecs=opus');
  assert.equal(voice.buffer.subarray(0, 4).toString('ascii'), 'OggS');
  assert.ok(voice.buffer.includes('OpusHead'));
  assert.ok(voice.seconds! >= 1 && voice.seconds! <= 2);
  assert.equal(voice.waveform?.length, 64);
  assert.ok(voice.waveform!.some((sample) => sample > 0));
  assert.equal(file.buffer.subarray(0, 4).toString('ascii'), 'RIFF');

  const prepared = await prepareOutgoingAudio({ number: '5575988881111', audio: '', encoding: false }, {
    buffer: voice.buffer, mimetype: voice.mimetype,
  });
  assert.equal(prepared.buffer, voice.buffer);
  assert.equal(prepared.ptt, true);
});
