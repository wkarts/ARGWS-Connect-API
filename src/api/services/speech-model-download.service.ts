import { createHash, randomUUID } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { access, lstat, mkdir, open, readFile, rename, rm, stat, utimes, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Readable, Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';

const MODEL_ID = 'Xenova/whisper-small';
const MODEL_REVISION = '2d67713f236afa48a18992566e7647f6ca848e13';
const MODEL_REPOSITORY = `https://huggingface.co/${MODEL_ID}`;
const MODEL_FILES = [
  'added_tokens.json',
  'config.json',
  'generation_config.json',
  'merges.txt',
  'normalizer.json',
  'preprocessor_config.json',
  'quant_config.json',
  'quantize_config.json',
  'special_tokens_map.json',
  'tokenizer.json',
  'tokenizer_config.json',
  'vocab.json',
  'onnx/decoder_model_merged_quantized.onnx',
  'onnx/encoder_model_quantized.onnx',
] as const;
const LOCK_STALE_AFTER_MS = 2 * 60 * 1000;

export type SpeechModelDownloadStatus = {
  id: string;
  revision: string;
  status: 'unavailable' | 'not_installed' | 'downloading' | 'ready' | 'failed';
  available: boolean;
  installed: boolean;
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number;
  errorMessage: string | null;
  updatedAt: string | null;
};

type RemoteFile = { path: string; size: number; lfs?: { oid?: string } };
type StoredStatus = Omit<SpeechModelDownloadStatus, 'available' | 'installed'> & {
  startedAt?: string | null;
};

function safeTarget(root: string, relativePath: string): string {
  const target = path.resolve(root, relativePath);
  if (target !== root && !target.startsWith(root + path.sep)) {
    throw new Error('Caminho de arquivo do modelo fora do diretório permitido.');
  }
  return target;
}

/**
 * Downloads the pinned multilingual q8 model into the shared persistent model
 * volume. The workers mount the same directory read-only and verify this
 * manifest before loading the model.
 */
export class SpeechModelDownloadService {
  private running: Promise<void> | null = null;
  private progressWrites: Promise<void> = Promise.resolve();
  private state: StoredStatus | null = null;

  private modelRoot(): string {
    return path.resolve(String(process.env.SPEECH_MODELS_PATH || '/models').trim() || '/models');
  }

  private configuredModel(): string {
    return String(process.env.SPEECH_MODEL || process.env.TRANSCRIPTION_LOCAL_MODEL || MODEL_ID).trim();
  }

  private targetPath(): string {
    const defaultPath = path.join(this.modelRoot(), 'Xenova', 'whisper-small');
    return path.resolve(String(process.env.SPEECH_MODEL_PATH || defaultPath).trim() || defaultPath);
  }

  private get isDownloadAvailable(): boolean {
    return (
      this.configuredModel() === MODEL_ID &&
      this.targetPath() === path.join(this.modelRoot(), 'Xenova', 'whisper-small')
    );
  }

  private statusPath(): string {
    return path.join(this.modelRoot(), '.speech-model-download.json');
  }

  private lockPath(): string {
    return path.join(this.modelRoot(), '.speech-model-download.lock');
  }

  private async isInstalled(): Promise<boolean> {
    if (!this.isDownloadAvailable) {
      try {
        await access(this.targetPath());
        return true;
      } catch {
        return false;
      }
    }

    try {
      const manifestPath = path.join(this.targetPath(), '.speech-model-checksums.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      if (manifest?.model !== MODEL_ID || manifest?.revision !== MODEL_REVISION) return false;
      for (const filename of MODEL_FILES) {
        const entry = await lstat(safeTarget(this.targetPath(), filename));
        if (!entry.isFile() || entry.isSymbolicLink() || entry.size <= 0) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  private async readStoredStatus(): Promise<StoredStatus | null> {
    try {
      const value = JSON.parse(await readFile(this.statusPath(), 'utf8'));
      return value?.id === MODEL_ID && value?.revision === MODEL_REVISION ? value : null;
    } catch {
      return null;
    }
  }

  private async saveStatus(value: StoredStatus): Promise<void> {
    this.state = { ...value, updatedAt: new Date().toISOString() };
    await mkdir(this.modelRoot(), { recursive: true });
    const tempPath = `${this.statusPath()}.${randomUUID()}.tmp`;
    await writeFile(tempPath, JSON.stringify(this.state), { mode: 0o644 });
    await rename(tempPath, this.statusPath());
    await utimes(this.lockPath(), new Date(), new Date()).catch(() => {});
  }

  private publicStatus(value: StoredStatus, installed: boolean): SpeechModelDownloadStatus {
    return {
      id: value.id,
      revision: value.revision,
      status: installed ? 'ready' : value.status,
      available: this.isDownloadAvailable,
      installed,
      progressPercent: installed ? 100 : Math.max(0, Math.min(99, Number(value.progressPercent) || 0)),
      downloadedBytes: Math.max(0, Number(value.downloadedBytes) || 0),
      totalBytes: Math.max(0, Number(value.totalBytes) || 0),
      errorMessage: installed ? null : value.errorMessage || null,
      updatedAt: value.updatedAt || null,
    };
  }

  public async status(): Promise<SpeechModelDownloadStatus> {
    const installed = await this.isInstalled();
    let stored = this.state || (await this.readStoredStatus());
    if (this.configuredModel() !== MODEL_ID) {
      return {
        id: this.configuredModel(),
        revision: '',
        status: installed ? 'ready' : 'unavailable',
        available: false,
        installed,
        progressPercent: installed ? 100 : 0,
        downloadedBytes: 0,
        totalBytes: 0,
        errorMessage: null,
        updatedAt: null,
      };
    }
    if (installed) {
      const completed = stored || {
        id: MODEL_ID,
        revision: MODEL_REVISION,
        status: 'ready' as const,
        progressPercent: 100,
        downloadedBytes: 0,
        totalBytes: 0,
        errorMessage: null,
        updatedAt: null,
      };
      return this.publicStatus(completed, true);
    }

    const lock = await stat(this.lockPath()).catch(() => null);
    if (lock && !this.running) {
      if (Date.now() - lock.mtimeMs > LOCK_STALE_AFTER_MS) {
        await rm(this.lockPath(), { force: true });
        if (stored?.status === 'downloading') {
          stored = {
            ...stored,
            status: 'failed',
            progressPercent: 0,
            downloadedBytes: 0,
            totalBytes: 0,
            errorMessage: 'O download foi interrompido. Tente novamente.',
          };
          await this.saveStatus(stored).catch(() => {});
        }
      } else {
        const lockedStatus = stored || {
          id: MODEL_ID,
          revision: MODEL_REVISION,
          status: 'downloading' as const,
          progressPercent: 0,
          downloadedBytes: 0,
          totalBytes: 0,
          errorMessage: null,
          updatedAt: lock.mtime.toISOString(),
        };
        if (lockedStatus.status !== 'failed') lockedStatus.status = 'downloading';
        return this.publicStatus(lockedStatus, false);
      }
    }

    const value = stored || {
      id: MODEL_ID,
      revision: MODEL_REVISION,
      status: this.isDownloadAvailable ? ('not_installed' as const) : ('unavailable' as const),
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      errorMessage: null,
      updatedAt: null,
    };
    if (value.status === 'downloading' && !lock) {
      value.status = 'failed';
      value.errorMessage = 'O download foi interrompido. Tente novamente.';
    }
    return this.publicStatus(value, false);
  }

  public async start(modelId: string): Promise<SpeechModelDownloadStatus> {
    if (modelId !== MODEL_ID || !this.isDownloadAvailable) {
      throw new Error('O download gerenciado está disponível somente para o modelo configurado Xenova/whisper-small.');
    }
    const current = await this.status();
    if (current.installed || current.status === 'downloading') return current;
    if (this.running) return this.status();

    await mkdir(this.modelRoot(), { recursive: true });
    let lock;
    try {
      lock = await open(this.lockPath(), 'wx', 0o644);
      await lock.writeFile(JSON.stringify({ pid: process.pid, startedAt: new Date().toISOString() }));
    } catch (error: any) {
      if (error?.code !== 'EEXIST') throw error;
      const existingLock = await stat(this.lockPath()).catch(() => null);
      if (existingLock && Date.now() - existingLock.mtimeMs > LOCK_STALE_AFTER_MS) {
        await rm(this.lockPath(), { force: true });
        return this.start(modelId);
      }
      return this.status();
    } finally {
      await lock?.close().catch(() => {});
    }

    const initial: StoredStatus = {
      id: MODEL_ID,
      revision: MODEL_REVISION,
      status: 'downloading',
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: 0,
      errorMessage: null,
      updatedAt: new Date().toISOString(),
      startedAt: new Date().toISOString(),
    };
    await this.saveStatus(initial);
    this.running = this.download().finally(async () => {
      this.running = null;
      await rm(this.lockPath(), { force: true }).catch(() => {});
    });
    return this.status();
  }

  private async fetchRemoteFiles(): Promise<RemoteFile[]> {
    const response = await fetch(
      `https://huggingface.co/api/models/${MODEL_ID}/tree/${MODEL_REVISION}?recursive=true&expand=true`,
    );
    if (!response.ok) throw new Error(`Não foi possível consultar os arquivos do modelo (HTTP ${response.status}).`);
    const entries = await response.json();
    if (!Array.isArray(entries)) throw new Error('A Hugging Face retornou uma lista de arquivos inválida.');
    const selected = MODEL_FILES.map((filename) => {
      const entry = entries.find((item: any) => item?.path === filename && item?.type === 'file');
      const size = Number(entry?.size);
      if (!entry || !Number.isSafeInteger(size) || size <= 0) {
        throw new Error(`O arquivo ${filename} não está disponível na revisão fixada do modelo.`);
      }
      return { path: filename, size, lfs: entry.lfs } as RemoteFile;
    });
    return selected;
  }

  private async downloadFile(
    file: RemoteFile,
    stagingPath: string,
    completedBytes: number,
    totalBytes: number,
  ): Promise<string> {
    const encodedPath = file.path.split('/').map(encodeURIComponent).join('/');
    const response = await fetch(`${MODEL_REPOSITORY}/resolve/${MODEL_REVISION}/${encodedPath}?download=true`);
    if (!response.ok || !response.body) {
      throw new Error(`Não foi possível baixar ${file.path} (HTTP ${response.status}).`);
    }

    const destination = safeTarget(stagingPath, file.path);
    await mkdir(path.dirname(destination), { recursive: true });
    const tempPath = `${destination}.part`;
    const hash = createHash('sha256');
    let currentFileBytes = 0;
    let lastSavedBytes = 0;
    let lastSaveAt = Date.now();
    const progress = new Transform({
      transform: (chunk: Buffer, _encoding, callback) => {
        currentFileBytes += chunk.length;
        hash.update(chunk);
        const now = Date.now();
        if (currentFileBytes - lastSavedBytes >= 2 * 1024 * 1024 || now - lastSaveAt >= 1000) {
          lastSavedBytes = currentFileBytes;
          lastSaveAt = now;
          const downloadedBytes = completedBytes + currentFileBytes;
          this.progressWrites = this.progressWrites
            .then(() =>
              this.saveStatus({
                id: MODEL_ID,
                revision: MODEL_REVISION,
                status: 'downloading',
                progressPercent: totalBytes ? Math.floor((downloadedBytes / totalBytes) * 100) : 0,
                downloadedBytes,
                totalBytes,
                errorMessage: null,
                updatedAt: new Date().toISOString(),
              }),
            )
            .catch(() => undefined);
        }
        callback(null, chunk);
      },
    });
    await pipeline(Readable.fromWeb(response.body as any), progress, createWriteStream(tempPath, { flags: 'wx' }));
    await this.progressWrites;

    if (currentFileBytes !== file.size) {
      throw new Error(`O tamanho recebido para ${file.path} não corresponde ao arquivo publicado.`);
    }
    const downloadedHash = hash.digest('hex');
    const remoteHash = String(file.lfs?.oid || '')
      .replace(/^sha256:/i, '')
      .toLowerCase();
    if (remoteHash && /^[a-f0-9]{64}$/.test(remoteHash) && downloadedHash !== remoteHash) {
      throw new Error(`A verificação SHA-256 falhou para ${file.path}.`);
    }
    await rename(tempPath, destination);
    return downloadedHash;
  }

  private async download(): Promise<void> {
    const root = this.modelRoot();
    const stagingPath = path.join(root, `.speech-model-download-${randomUUID()}`);
    try {
      const files = await this.fetchRemoteFiles();
      const totalBytes = files.reduce((total, file) => total + file.size, 0);
      let completedBytes = 0;
      const hashes: Record<string, string> = {};
      await mkdir(stagingPath, { recursive: true });
      for (const file of files) {
        hashes[file.path] = await this.downloadFile(file, stagingPath, completedBytes, totalBytes);
        completedBytes += file.size;
        await this.saveStatus({
          id: MODEL_ID,
          revision: MODEL_REVISION,
          status: 'downloading',
          progressPercent: Math.min(99, Math.floor((completedBytes / totalBytes) * 100)),
          downloadedBytes: completedBytes,
          totalBytes,
          errorMessage: null,
          updatedAt: new Date().toISOString(),
        });
      }

      await writeFile(
        path.join(stagingPath, '.speech-model-checksums.json'),
        JSON.stringify({
          algorithm: 'sha256',
          model: MODEL_ID,
          revision: MODEL_REVISION,
          downloadedAt: new Date().toISOString(),
          files: hashes,
        }),
        { mode: 0o644 },
      );

      const targetPath = this.targetPath();
      await mkdir(path.dirname(targetPath), { recursive: true });
      const backupPath = `${targetPath}.previous-${randomUUID()}`;
      const previous = await stat(targetPath).catch(() => null);
      if (previous) await rename(targetPath, backupPath);
      try {
        await rename(stagingPath, targetPath);
      } catch (error) {
        if (previous) await rename(backupPath, targetPath).catch(() => {});
        throw error;
      }
      if (previous) await rm(backupPath, { recursive: true, force: true });

      await this.saveStatus({
        id: MODEL_ID,
        revision: MODEL_REVISION,
        status: 'ready',
        progressPercent: 100,
        downloadedBytes: totalBytes,
        totalBytes,
        errorMessage: null,
        updatedAt: new Date().toISOString(),
      });
    } catch (error: any) {
      await rm(stagingPath, { recursive: true, force: true }).catch(() => {});
      await this.saveStatus({
        id: MODEL_ID,
        revision: MODEL_REVISION,
        status: 'failed',
        progressPercent: 0,
        downloadedBytes: 0,
        totalBytes: 0,
        errorMessage: String(error?.message || error).slice(0, 500),
        updatedAt: new Date().toISOString(),
      }).catch(() => {});
    }
  }
}

export const speechModelDownloadDetails = {
  modelId: MODEL_ID,
  revision: MODEL_REVISION,
  approximateSizeBytes: 253_500_000,
};
