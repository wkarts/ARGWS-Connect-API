import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { lstat, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

export type SpeechModelDefinition = {
  id: string;
  engine: 'transformers' | 'whisper.cpp';
  format: 'onnx' | 'ggml';
  revision: string;
  repository: string;
  quantization: string;
  relativeDirectory: string;
  modelFile?: string;
  files: string[];
  approximateSizeBytes: number;
  recommendedBudgetMiB: number;
};

// scripts/ is copied to the final API image; no model bytes are read here.
const models: SpeechModelDefinition[] = JSON.parse(readFileSync(path.resolve('scripts/speech-models.json'), 'utf8'));

export function getSpeechModelCatalog(): SpeechModelDefinition[] {
  return models.map((model) => ({ ...model, files: [...model.files] }));
}

export function getConfiguredSpeechModel(): SpeechModelDefinition | null {
  const engine = String(process.env.SPEECH_ENGINE || 'whisper.cpp')
    .trim()
    .toLowerCase();
  const id = String(
    process.env.SPEECH_MODEL ||
      process.env.TRANSCRIPTION_LOCAL_MODEL ||
      (engine === 'whisper.cpp' ? 'whisper-base-q5_1' : 'Xenova/whisper-small'),
  ).trim();
  return models.find((model) => model.id === id && model.engine === engine) || null;
}

export type SpeechModelDownloadStatus = {
  id: string;
  revision: string;
  engine?: string;
  status: 'unavailable' | 'not_installed' | 'verifying' | 'downloading' | 'ready' | 'failed';
  available: boolean;
  installed: boolean;
  progressPercent: number;
  downloadedBytes: number;
  totalBytes: number;
  errorMessage: string | null;
  updatedAt: string | null;
  verifiedAt?: string | null;
};

type ProvisionOptions = { modelId: string; root: string; operation: 'download' | 'verify'; force?: boolean };
type ProvisionRunner = (options: ProvisionOptions) => Promise<unknown>;

/** HTTP supervisor reads small fingerprints/status only; hashing/downloads run in a child. */
export class SpeechModelDownloadService {
  private running: Promise<unknown> | null = null;
  private operation: 'download' | 'verify' | null = null;
  private lastError: string | null = null;
  private readonly run: ProvisionRunner;

  constructor(options: { run?: ProvisionRunner } = {}) {
    this.run = options.run || ((input) => this.runProcess(input));
  }

  private modelRoot(): string {
    return path.resolve(String(process.env.SPEECH_MODELS_PATH || '/models').trim() || '/models');
  }

  private targetPath(model: SpeechModelDefinition): string {
    return path.resolve(String(process.env.SPEECH_MODEL_PATH || path.join(this.modelRoot(), model.relativeDirectory)));
  }

  private configured(model: SpeechModelDefinition): boolean {
    return (
      this.targetPath(model) === path.join(this.modelRoot(), model.relativeDirectory) &&
      (model.engine !== 'transformers' ||
        String(process.env.SPEECH_DTYPE || process.env.TRANSCRIPTION_LOCAL_DTYPE || 'q8') === 'q8')
    );
  }

  private async fingerprint(model: SpeechModelDefinition): Promise<string | null> {
    try {
      const directory = await lstat(this.targetPath(model));
      if (!directory.isDirectory() || directory.isSymbolicLink()) return null;
      const parts = [];
      for (const filename of ['.speech-model-checksums.json', ...model.files]) {
        const item = await lstat(path.join(this.targetPath(model), filename));
        if (!item.isFile() || item.isSymbolicLink() || !item.size) return null;
        parts.push([filename, item.size, item.mtimeMs, item.ctimeMs, item.ino]);
      }
      return createHash('sha256').update(JSON.stringify(parts)).digest('hex');
    } catch {
      return null;
    }
  }

  private async stored(): Promise<any> {
    try {
      return JSON.parse(await readFile(path.join(this.modelRoot(), '.speech-model-download.json'), 'utf8'));
    } catch {
      return null;
    }
  }

  private runProcess(input: ProvisionOptions): Promise<void> {
    return new Promise((resolve, reject) => {
      const child = spawn(
        process.execPath,
        [
          '--max-old-space-size=96',
          path.resolve('scripts/speech-model-provision.cjs'),
          input.modelId,
          input.root,
          ...(input.operation === 'verify' ? ['--verify'] : []),
          ...(input.force ? ['--force'] : []),
        ],
        { stdio: ['ignore', 'ignore', 'pipe'], detached: process.platform !== 'win32' },
      );
      let errorText = '';
      child.stderr.on('data', (bytes: Buffer) => {
        errorText = (errorText + bytes.toString()).slice(-500);
      });
      const timer = setTimeout(() => {
        try {
          if (process.platform !== 'win32' && child.pid) process.kill(-child.pid, 'SIGKILL');
          else child.kill('SIGKILL');
        } catch {
          /* Process already exited. */
        }
      }, 1_830_000);
      timer.unref?.();
      child.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
      child.once('close', (code) => {
        clearTimeout(timer);
        if (code === 0) resolve();
        else reject(new Error(errorText || 'O provisionamento do modelo foi interrompido.'));
      });
    });
  }

  private launch(model: SpeechModelDefinition, operation: 'download' | 'verify', force = false): void {
    if (this.running) return;
    this.operation = operation;
    this.lastError = null;
    this.running = this.run({ modelId: model.id, root: this.modelRoot(), operation, force })
      .catch((error: any) => {
        this.lastError = String(error?.message || error).slice(0, 500);
      })
      .finally(() => {
        this.running = null;
        this.operation = null;
      });
  }

  public async status(): Promise<SpeechModelDownloadStatus> {
    const model = getConfiguredSpeechModel();
    const initial: SpeechModelDownloadStatus = {
      id: model?.id || String(process.env.SPEECH_MODEL || ''),
      revision: model?.revision || '',
      engine: model?.engine || String(process.env.SPEECH_ENGINE || 'whisper.cpp'),
      status: 'unavailable',
      available: !!model && this.configured(model),
      installed: false,
      progressPercent: 0,
      downloadedBytes: 0,
      totalBytes: model?.approximateSizeBytes || 0,
      errorMessage: null,
      updatedAt: null,
      verifiedAt: null,
    };
    if (!model || !initial.available) {
      initial.errorMessage = 'Engine, modelo, formato ou caminho fora do catálogo configurado.';
      return initial;
    }
    const stored = await this.stored();
    const validStored = stored?.id === model.id && stored?.revision === model.revision ? stored : null;
    const signature = await this.fingerprint(model);
    const lock = await stat(path.join(this.modelRoot(), '.speech-model-download.lock')).catch(() => null);
    const busy = !!this.running || (!!lock && Date.now() - lock.mtimeMs < 120_000);
    const verified = !!signature && validStored?.status === 'ready' && validStored.checkedFingerprint === signature;
    if (verified && !busy)
      return {
        ...initial,
        ...this.publicStored(validStored),
        status: 'ready',
        installed: true,
        progressPercent: 100,
        errorMessage: null,
      };
    if (busy)
      return {
        ...initial,
        ...this.publicStored(validStored),
        status: this.operation === 'verify' || validStored?.status === 'verifying' ? 'verifying' : 'downloading',
        installed: false,
        progressPercent: Math.min(99, validStored?.progressPercent || 0),
      };
    if (signature && validStored?.checkedFingerprint !== signature) {
      this.launch(model, 'verify');
      return { ...initial, status: 'verifying' };
    }
    if (
      validStored?.status === 'failed' ||
      this.lastError ||
      ['downloading', 'verifying'].includes(validStored?.status)
    ) {
      return {
        ...initial,
        ...this.publicStored(validStored),
        status: 'failed',
        installed: false,
        errorMessage:
          this.lastError || validStored?.errorMessage || 'Provisionamento interrompido. Use baixar/reparar.',
      };
    }
    return { ...initial, status: 'not_installed' };
  }

  private publicStored(stored: any): Partial<SpeechModelDownloadStatus> {
    if (!stored) return {};
    return {
      downloadedBytes: Number(stored.downloadedBytes) || 0,
      totalBytes: Number(stored.totalBytes) || 0,
      errorMessage: stored.errorMessage || null,
      updatedAt: stored.updatedAt || null,
      verifiedAt: stored.verifiedAt || null,
    };
  }

  public async start(modelId: string, options: { force?: boolean } = {}): Promise<SpeechModelDownloadStatus> {
    const model = getConfiguredSpeechModel();
    if (!model || model.id !== modelId || !this.configured(model)) {
      throw new Error(
        'O download gerenciado está disponível somente para o modelo configurado no catálogo da instalação.',
      );
    }
    const current = await this.status();
    if (
      this.running ||
      current.status === 'downloading' ||
      current.status === 'verifying' ||
      (current.installed && !options.force)
    ) {
      return current;
    }
    this.launch(model, 'download', options.force === true);
    return { ...current, status: 'downloading', installed: false, progressPercent: 0, errorMessage: null };
  }
}

// Existing imports remain valid; new callers use the complete catalogue.
export const speechModelDownloadDetails = {
  modelId: models[0].id,
  revision: models[0].revision,
  approximateSizeBytes: models[0].approximateSizeBytes,
};
