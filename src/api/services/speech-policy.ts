import { createHash } from 'crypto';

export const SPEECH_PROTOCOL_VERSION = 2;
export const SPEECH_CONTROL_ROUTING_KEY = 'speech.control.v2';
export const SPEECH_ACTIVE_STATUSES = ['queued', 'processing'];
export const SPEECH_TERMINAL_STATUSES = ['completed', 'failed', 'cancelled'];

export function speechInteger(name: string, fallback: number, min = 1, max = 1_000_000): number {
  const value = Number(process.env[name]);
  return Number.isFinite(value) && value >= min ? Math.min(Math.floor(value), max) : fallback;
}

export function speechPoolId(): string {
  const value = String(process.env.SPEECH_POOL_ID || process.env.RABBITMQ_EXCHANGE_NAME || 'argws_connect').trim();
  if (!/^[A-Za-z0-9._-]{1,100}$/.test(value)) throw new Error('SPEECH_POOL_ID inválido.');
  return value;
}

export function speechScopeKey(instanceId?: string | null): string {
  return instanceId ? 'instance:' + instanceId : 'admin:global';
}

export function speechHash(...values: unknown[]): string {
  return createHash('sha256').update(JSON.stringify(values)).digest('hex');
}

export function speechQueue(mode: string): string {
  const raw = String(
    mode === 'dictation'
      ? process.env.SPEECH_DICTATION_QUEUE || 'speech.dictation'
      : process.env.SPEECH_TRANSCRIPTION_QUEUE || process.env.TRANSCRIPTION_QUEUE || 'speech.transcription',
  ).trim();
  return raw.endsWith('.v2') ? raw : raw + '.v2';
}

export function speechRequestRoutingKey(mode: string): string {
  return mode === 'dictation' ? 'speech.dictation.requested.v2' : 'transcription.requested.v2';
}

export function speechDictationRetentionMs(): number {
  return speechInteger('DICTATION_AUDIO_RETENTION_MINUTES', 5, 1, 60) * 60_000;
}

export function speechQueueArguments(mode: string): Record<string, unknown> {
  const ttl = speechInteger('SPEECH_QUEUE_RETENTION_SECONDS', 86_400, 60, 604_800) * 1000;
  return {
    'x-queue-type': 'quorum',
    'x-max-length': speechInteger('SPEECH_QUEUE_MAX_JOBS', 50),
    'x-max-length-bytes': speechInteger('SPEECH_QUEUE_MAX_BYTES', 8_388_608, 1024, 268_435_456),
    'x-overflow': 'reject-publish',
    'x-delivery-limit': speechInteger('SPEECH_MAX_ATTEMPTS', 3, 1, 10),
    'x-message-ttl': mode === 'dictation' ? Math.min(ttl, speechDictationRetentionMs()) : ttl,
    'x-dead-letter-exchange': '',
    'x-dead-letter-routing-key': speechQueue(mode) + '.dead-letter',
  };
}

export function speechDeadLetterArguments(): Record<string, unknown> {
  return {
    'x-queue-type': 'quorum',
    'x-max-length': speechInteger('SPEECH_DEAD_LETTER_MAX_JOBS', 100),
    'x-max-length-bytes': 1_048_576,
    'x-overflow': 'drop-head',
    'x-message-ttl': speechInteger('SPEECH_DEAD_LETTER_RETENTION_SECONDS', 86_400, 60, 604_800) * 1000,
  };
}

export function speechDeadline(mode: string): Date {
  const seconds =
    mode === 'dictation'
      ? speechInteger('DICTATION_JOB_DEADLINE_SECONDS', 120, 15, 1800)
      : speechInteger('SPEECH_JOB_DEADLINE_SECONDS', 900, 30, 86_400);
  return new Date(Date.now() + seconds * 1000);
}

export class TranscriptionServiceError extends Error {
  constructor(
    message: string,
    public readonly status = 503,
    public readonly retryAfterSeconds?: number,
  ) {
    super(message);
    this.name = 'TranscriptionServiceError';
  }
}

/** Publisher confirms must also observe basic.return (an unroutable publish is confirmed by AMQP). */
export async function publishSpeechConfirmed(
  channel: any,
  exchange: string,
  routingKey: string,
  payload: Record<string, unknown>,
  options: Record<string, unknown> = {},
): Promise<void> {
  const messageId = String(options.messageId || speechHash(payload, Date.now(), Math.random()));
  await new Promise<void>((resolve, reject) => {
    let settled = false;
    const cleanup = () => {
      clearTimeout(timer);
      channel.removeListener('return', returned);
      channel.removeListener('close', closed);
      channel.removeListener('error', failed);
    };
    const done = (error?: Error | null) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) reject(error);
      else resolve();
    };
    const returned = (message: any) => {
      if (message?.properties?.messageId === messageId) done(new Error('SPEECH_UNROUTABLE: ' + routingKey));
    };
    const closed = () => done(new Error('SPEECH_CHANNEL_CLOSED'));
    const failed = (error: Error) => done(error);
    const timer = setTimeout(() => done(new Error('SPEECH_PUBLISH_TIMEOUT')), 10_000);
    timer.unref?.();
    channel.on('return', returned);
    channel.on('close', closed);
    channel.on('error', failed);
    try {
      channel.publish(
        exchange,
        routingKey,
        Buffer.from(JSON.stringify(payload)),
        {
          ...options,
          persistent: true,
          mandatory: true,
          contentType: 'application/json',
          messageId,
        },
        done,
      );
    } catch (error) {
      done(error as Error);
    }
  });
}
