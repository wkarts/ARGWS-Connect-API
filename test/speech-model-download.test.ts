import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SpeechModelDownloadService } from '@api/services/speech-model-download.service';
import { TranscriptionService } from '@api/services/transcription.service';
import { verifyModelDirectory } from '../transcription-worker/src/model-checksum';

const MODEL_FILES = [
  'added_tokens.json', 'config.json', 'generation_config.json', 'merges.txt', 'normalizer.json',
  'preprocessor_config.json', 'quant_config.json', 'quantize_config.json', 'special_tokens_map.json',
  'tokenizer.json', 'tokenizer_config.json', 'vocab.json',
  'onnx/decoder_model_merged_quantized.onnx', 'onnx/encoder_model_quantized.onnx',
];

function hash(value: Buffer) {
  return createHash('sha256').update(value).digest('hex');
}

test('modelo de voz baixa para o volume persistente, valida e reutiliza os arquivos', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'argws-speech-model-'));
  const previousRoot = process.env.SPEECH_MODELS_PATH;
  const previousModelPath = process.env.SPEECH_MODEL_PATH;
  const previousModel = process.env.SPEECH_MODEL;
  const originalFetch = globalThis.fetch;
  const buffers = new Map(MODEL_FILES.map((filename) => [filename, Buffer.from(`fixture:${filename}`)]));
  let fetchCount = 0;
  process.env.SPEECH_MODELS_PATH = root;
  process.env.SPEECH_MODEL_PATH = path.join(root, 'Xenova', 'whisper-small');
  process.env.SPEECH_MODEL = 'Xenova/whisper-small';
  (globalThis as any).fetch = async (input: any) => {
    fetchCount += 1;
    const url = String(input);
    if (url.includes('/api/models/')) {
      const metadata = MODEL_FILES.map((filename) => {
        const bytes = buffers.get(filename)!;
        return { type: 'file', path: filename, size: bytes.length, lfs: { oid: `sha256:${hash(bytes)}` } };
      });
      return new Response(JSON.stringify(metadata), { status: 200 });
    }
    const filename = MODEL_FILES.find((value) => new URL(url).pathname.endsWith(`/${value}`));
    assert.ok(filename, `unexpected model file URL: ${url}`);
    return new Response(buffers.get(filename) as any, { status: 200 });
  };

  try {
    const downloader = new SpeechModelDownloadService();
    const initial = await downloader.status();
    assert.equal(initial.available, true);
    assert.equal(initial.installed, false);

    const started = await downloader.start('Xenova/whisper-small');
    assert.ok(['downloading', 'ready'].includes(started.status));
    const deadline = Date.now() + 5000;
    let finished = await downloader.status();
    while (!finished.installed && finished.status !== 'failed' && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      finished = await downloader.status();
    }
    assert.equal(finished.status, 'ready', finished.errorMessage || 'download did not finish');
    assert.equal(finished.progressPercent, 100);

    const modelPath = path.join(root, 'Xenova', 'whisper-small');
    assert.equal(await verifyModelDirectory(modelPath), MODEL_FILES.length);
    assert.equal((await stat(path.join(modelPath, 'onnx', 'decoder_model_merged_quantized.onnx'))).size, buffers.get(MODEL_FILES[12])!.length);

    const requestsBeforeReuse = fetchCount;
    const reused = await downloader.start('Xenova/whisper-small');
    assert.equal(reused.installed, true);
    assert.equal(fetchCount, requestsBeforeReuse);

    const manifest = JSON.parse(await readFile(path.join(modelPath, '.speech-model-checksums.json'), 'utf8'));
    assert.equal(manifest.revision, '2d67713f236afa48a18992566e7647f6ca848e13');
  } finally {
    (globalThis as any).fetch = originalFetch;
    if (previousRoot === undefined) delete process.env.SPEECH_MODELS_PATH;
    else process.env.SPEECH_MODELS_PATH = previousRoot;
    if (previousModelPath === undefined) delete process.env.SPEECH_MODEL_PATH;
    else process.env.SPEECH_MODEL_PATH = previousModelPath;
    if (previousModel === undefined) delete process.env.SPEECH_MODEL;
    else process.env.SPEECH_MODEL = previousModel;
    await rm(root, { recursive: true, force: true });
  }
});

test('download gerenciado rejeita modelo diferente do perfil fixado', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'argws-speech-model-unsupported-'));
  const previousRoot = process.env.SPEECH_MODELS_PATH;
  const previousModelPath = process.env.SPEECH_MODEL_PATH;
  const previousModel = process.env.SPEECH_MODEL;
  process.env.SPEECH_MODELS_PATH = root;
  process.env.SPEECH_MODEL_PATH = path.join(root, 'custom', 'model');
  process.env.SPEECH_MODEL = 'custom/model';
  try {
    const downloader = new SpeechModelDownloadService();
    const status = await downloader.status();
    assert.equal(status.available, false);
    await assert.rejects(downloader.start('Xenova/whisper-small'), /somente para o modelo configurado/);
  } finally {
    if (previousRoot === undefined) delete process.env.SPEECH_MODELS_PATH;
    else process.env.SPEECH_MODELS_PATH = previousRoot;
    if (previousModelPath === undefined) delete process.env.SPEECH_MODEL_PATH;
    else process.env.SPEECH_MODEL_PATH = previousModelPath;
    if (previousModel === undefined) delete process.env.SPEECH_MODEL;
    else process.env.SPEECH_MODEL = previousModel;
    await rm(root, { recursive: true, force: true });
  }
});

test('API provisiona o modelo no início da stack mesmo com a transcrição desativada', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'argws-speech-model-bootstrap-'));
  const envNames = ['SPEECH_MODELS_PATH', 'SPEECH_MODEL_PATH', 'SPEECH_MODEL', 'SPEECH_ENABLED', 'TRANSCRIPTION_ENABLED'];
  const previousEnv = Object.fromEntries(envNames.map((name) => [name, process.env[name]));
  const originalFetch = globalThis.fetch;
  const buffers = new Map(MODEL_FILES.map((filename) => [filename, Buffer.from(`fixture:${filename}`)]));
  let metadataRequests = 0;
  process.env.SPEECH_MODELS_PATH = root;
  process.env.SPEECH_MODEL_PATH = path.join(root, 'Xenova', 'whisper-small');
  process.env.SPEECH_MODEL = 'Xenova/whisper-small';
  process.env.SPEECH_ENABLED = 'false';
  delete process.env.TRANSCRIPTION_ENABLED;
  (globalThis as any).fetch = async (input: any) => {
    const url = String(input);
    if (url.includes('/api/models/')) {
      metadataRequests += 1;
      return new Response(JSON.stringify(MODEL_FILES.map((filename) => {
        const bytes = buffers.get(filename)!;
        return { type: 'file', path: filename, size: bytes.length, lfs: { oid: `sha256:${hash(bytes)}` } };
      })), { status: 200 });
    }
    const filename = MODEL_FILES.find((value) => new URL(url).pathname.endsWith(`/${value}`));
    assert.ok(filename, `unexpected model file URL: ${url}`);
    return new Response(buffers.get(filename) as any, { status: 200 });
  };

  try {
    const service = new TranscriptionService({} as any);
    await Promise.all([service.init(), service.init()]);
    const statusPath = path.join(root, '.speech-model-download.json');
    let status: any = null;
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      try { status = JSON.parse(await readFile(statusPath, 'utf8')); } catch { /* Download has not written status yet. */ }
      if (status?.status === 'ready') break;
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(status?.status, 'ready', status?.errorMessage || 'API did not provision the model on startup');
    assert.equal(metadataRequests, 1, 'repeated init must not start a second download');
  } finally {
    (globalThis as any).fetch = originalFetch;
    for (const name of envNames) {
      if (previousEnv[name] === undefined) delete process.env[name];
      else process.env[name] = previousEnv[name];
    }
    await rm(root, { recursive: true, force: true });
  }
});
