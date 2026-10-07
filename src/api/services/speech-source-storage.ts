import { ConfigService, S3 } from '@config/env.config';
import * as Minio from 'minio';
import { Readable } from 'stream';

import { TranscriptionServiceError } from './speech-policy';

/** Be conservative: a conditional anonymous Allow is still public access. */
export function speechPolicyAllowsAnonymous(policy: string): boolean {
  if (!policy.trim()) return false;
  const parsed = JSON.parse(policy);
  const statements = Array.isArray(parsed.Statement) ? parsed.Statement : [parsed.Statement];
  const containsWildcard = (value: unknown): boolean =>
    value === '*' ||
    (Array.isArray(value) && value.some(containsWildcard)) ||
    (!!value && typeof value === 'object' && Object.values(value).some(containsWildcard));
  return statements.some(
    (statement: any) =>
      statement?.Effect === 'Allow' && (statement.NotPrincipal !== undefined || containsWildcard(statement.Principal)),
  );
}

/** Dedicated speech bucket: never inherits the legacy media bucket's public policy. */
export class SpeechSourceStorage {
  private readonly configuration: S3;
  private readonly client: any;
  private preparing: Promise<string> | null = null;

  constructor(configuration?: S3, client?: any) {
    this.configuration = configuration || new ConfigService().get<S3>('S3');
    const cfg = this.configuration;
    this.client =
      client ||
      (cfg?.ENABLE
        ? new Minio.Client({
            endPoint: cfg.ENDPOINT,
            port: cfg.PORT,
            useSSL: cfg.USE_SSL,
            accessKey: cfg.ACCESS_KEY,
            secretKey: cfg.SECRET_KEY,
            region: cfg.REGION,
          })
        : null);
  }
  mediaBucket(): string {
    return String(this.configuration?.BUCKET_NAME || '');
  }
  privateBucket(): string {
    const bucket = String(process.env.SPEECH_S3_BUCKET_NAME || this.mediaBucket() + '-speech').trim();
    if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket) || bucket.includes('..') || bucket === this.mediaBucket()) {
      throw new TranscriptionServiceError(
        'SPEECH_S3_BUCKET_NAME deve ser um bucket válido e distinto do bucket de mídia.',
        409,
      );
    }
    return bucket;
  }
  enabled(): boolean {
    return Boolean(this.client && this.configuration?.ENABLE && this.mediaBucket());
  }
  private async bounded<T>(operation: Promise<T>): Promise<T> {
    let timer: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new TranscriptionServiceError('O armazenamento de voz não respondeu dentro do prazo.', 503)),
            15_000,
          );
          timer.unref?.();
        }),
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
  async ensurePrivate(): Promise<string> {
    if (!this.enabled())
      throw new TranscriptionServiceError('O armazenamento privado de áudio não está disponível.', 503);
    if (this.preparing) return this.preparing;
    this.preparing = (async () => {
      const bucket = this.privateBucket();
      if (!(await this.bounded<boolean>(this.client.bucketExists(bucket)))) {
        try {
          await this.bounded(this.client.makeBucket(bucket));
        } catch (error) {
          if (!['BucketAlreadyOwnedByYou', 'BucketAlreadyExists'].includes(error?.code)) throw error;
        }
      }
      let policy = '';
      try {
        policy = await this.bounded<string>(this.client.getBucketPolicy(bucket));
      } catch (error) {
        if (!['NoSuchBucketPolicy', 'NoSuchPolicy'].includes(error?.code)) {
          throw new TranscriptionServiceError('Não foi possível comprovar a política privada do bucket de voz.', 503);
        }
      }
      try {
        if (speechPolicyAllowsAnonymous(policy))
          throw new TranscriptionServiceError(
            'O bucket de voz permite acesso anônimo. Corrija a política antes de enviar áudios.',
            503,
          );
      } catch (error) {
        if (error instanceof TranscriptionServiceError) throw error;
        throw new TranscriptionServiceError('A política do bucket de voz não pôde ser validada.', 503);
      }
      return bucket;
    })().finally(() => {
      this.preparing = null;
    });
    return this.preparing;
  }
  private bucket(value?: string | null): string {
    const bucket = value || this.mediaBucket();
    if (![this.mediaBucket(), this.privateBucket()].includes(bucket))
      throw new TranscriptionServiceError('A fonte pertence a um bucket não autorizado.', 409);
    return bucket;
  }
  private objectKey(key: string): string {
    const normalized = String(key || '').replace(/\\/g, '/');
    if (!normalized || normalized.startsWith('/') || normalized.includes('\0') || normalized.split('/').includes('..'))
      throw new TranscriptionServiceError('Chave de áudio inválida.', 400);
    return normalized.startsWith('argws-connect-api/') ? normalized : 'argws-connect-api/' + normalized;
  }
  async upload(key: string, stream: Readable, size: number, mimeType: string, sha256: string) {
    const bucket = await this.ensurePrivate();
    if (stream.destroyed) throw new TranscriptionServiceError('O upload foi interrompido antes do armazenamento.', 408);
    await this.client.putObject(bucket, this.objectKey(key), stream, size, {
      'Content-Type': mimeType,
      'x-amz-meta-sha256': sha256,
    });
    return { bucket };
  }
  async open(bucket: string | null | undefined, key: string): Promise<Readable> {
    if (!this.enabled()) throw new TranscriptionServiceError('Armazenamento de voz indisponível.', 503);
    let abandoned = false;
    const pending = this.client.getObject(this.bucket(bucket), this.objectKey(key));
    void pending.then(
      (stream: Readable) => {
        if (abandoned) stream.destroy();
      },
      () => {},
    );
    try {
      return await this.bounded<Readable>(pending);
    } catch (error) {
      abandoned = true;
      throw error;
    }
  }
  async exists(bucket: string | null | undefined, key: string): Promise<boolean> {
    if (!this.enabled()) return false;
    try {
      await this.bounded(this.client.statObject(this.bucket(bucket), this.objectKey(key)));
      return true;
    } catch {
      return false;
    }
  }
  async remove(bucket: string | null | undefined, key: string): Promise<boolean> {
    if (!this.enabled()) return false;
    try {
      await this.bounded(this.client.removeObject(this.bucket(bucket), this.objectKey(key)));
      return true;
    } catch {
      return false;
    }
  }
}
