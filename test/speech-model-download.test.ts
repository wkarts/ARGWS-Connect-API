import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readFile, rename, rm, stat, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { SpeechModelDownloadService } from '@api/services/speech-model-download.service';
const { provisionModel } = require('../scripts/speech-model-provision.cjs');
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
    const downloader = new SpeechModelDownloadService({ run: (options) => provisionModel(options, { fetch: globalThis.fetch }) });
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
    const fileToCorrupt = path.join(modelPath, MODEL_FILES[12]);
    const original = await readFile(fileToCorrupt);
    await writeFile(fileToCorrupt, Buffer.alloc(original.length, 120));
    let corrupted = await downloader.status();
    assert.equal(corrupted.installed, false, 'same-size corruption must not remain ready');
    while (corrupted.status === 'verifying') {
      await new Promise((resolve) => setTimeout(resolve, 10));
      corrupted = await downloader.status();
    }
    assert.equal(corrupted.status, 'failed');
    assert.match(corrupted.errorMessage || '', /Checksum/);
    await downloader.start('Xenova/whisper-small', { force: true });
    let repaired = await downloader.status();
    while (['downloading', 'verifying'].includes(repaired.status)) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      repaired = await downloader.status();
    }
    assert.equal(repaired.installed, true, repaired.errorMessage || 'repair did not complete');
    assert.equal(await verifyModelDirectory(modelPath), MODEL_FILES.length);

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
    const downloader = new SpeechModelDownloadService({ run: (options) => provisionModel(options, { fetch: globalThis.fetch }) });
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


test('download valida tamanho remoto e remove trava após erro', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'speech-model-overflow-'));
  const fetcher = async (input: any) => {
    if (String(input).includes('/api/models/')) {
      return new Response(JSON.stringify(MODEL_FILES.map((name) => ({ type: 'file', path: name, size: 1 }))));
    }
    return new Response(Buffer.alloc(100));
  };
  try {
    await assert.rejects(provisionModel({ modelId: 'Xenova/whisper-small', root }, { fetch: fetcher }), /tamanho publicado/);
    const state = JSON.parse(await readFile(path.join(root, '.speech-model-download.json'), 'utf8'));
    assert.equal(state.status, 'failed');
    await assert.rejects(stat(path.join(root, '.speech-model-download.lock')), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});

test('instalação interrompida restaura o modelo anterior e remove somente o estágio registrado', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'speech-model-recovery-'));
  const modelId = 'Xenova/whisper-small';
  const fetcher = async (input: any) => String(input).includes('/api/models/')
    ? new Response(JSON.stringify(MODEL_FILES.map((name) => ({ type: 'file', path: name, size: 3 }))))
    : new Response(Buffer.from('abc'));
  try {
    await provisionModel({ modelId, root }, { fetch: fetcher });
    const target = path.join(root, 'Xenova', 'whisper-small');
    const backupId = '11111111-1111-4111-8111-111111111111';
    const stage = '.speech-model-staging-22222222-2222-4222-8222-222222222222';
    await rename(target, target + '.previous-' + backupId);
    await mkdir(path.join(root, stage));
    await writeFile(path.join(root, stage, 'download.part'), 'partial');
    await writeFile(path.join(root, 'keep.txt'), 'preserve');
    await writeFile(path.join(root, '.speech-model-transaction.json'), JSON.stringify({ modelId, stage, backupId }));
    await provisionModel({ modelId, root, operation: 'verify' }, {
      fetch: async () => { throw new Error('Recovery must not download'); },
    });
    assert.equal(await verifyModelDirectory(target), MODEL_FILES.length);
    assert.equal(await readFile(path.join(root, 'keep.txt'), 'utf8'), 'preserve');
    for (const item of [stage, '.speech-model-transaction.json', '.speech-model-download.lock']) {
      await assert.rejects(stat(path.join(root, item)), { code: 'ENOENT' });
    }
    await assert.rejects(stat(target + '.previous-' + backupId), { code: 'ENOENT' });
  } finally { await rm(root, { recursive: true, force: true }); }
});
