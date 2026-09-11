export interface ProviderMediaRegistryEntry {
  getBase64FromMediaMessage?: (data: any, getBuffer?: boolean) => Promise<any>;
}

export interface CanonicalMediaStorage {
  uploadFile(fileName: string, buffer: Buffer, size: number, metadata: Record<string, string>): Promise<any>;
  getObjectUrl(fileName: string, expires?: number): Promise<string | null>;
}

export interface CanonicalMediaRecord {
  type: string;
  fileName: string;
  mimetype: string;
  instanceId: string;
}

type PersistCanonicalMedia = (record: CanonicalMediaRecord) => Promise<any>;

type MediaDescriptor = {
  type: string;
  mimetype: string;
  fileName: string;
};

const MEDIA_TYPES = [
  ['imageMessage', 'image', 'image/jpeg'],
  ['videoMessage', 'video', 'video/mp4'],
  ['ptvMessage', 'video', 'video/mp4'],
  ['audioMessage', 'audio', 'audio/ogg'],
  ['documentMessage', 'document', 'application/octet-stream'],
  ['stickerMessage', 'sticker', 'image/webp'],
] as const;

const MEDIA_WRAPPERS = [
  'ephemeralMessage',
  'viewOnceMessage',
  'viewOnceMessageV2',
  'viewOnceMessageV2Extension',
  'documentWithCaptionMessage',
  'editedMessage',
] as const;

export async function materializeProviderMedia(options: {
  mediaId: string;
  message: any;
  provider: ProviderMediaRegistryEntry | null | undefined;
  storage: CanonicalMediaStorage;
  persist: PersistCanonicalMedia;
  onError?: (error: unknown) => void;
}): Promise<any | null> {
  const { mediaId, message, provider, storage, persist, onError } = options;
  if (!provider || typeof provider.getBase64FromMediaMessage !== 'function') return null;

  try {
    const downloaded = await provider.getBase64FromMediaMessage(
      {
        message: {
          key: message.key,
          message: message.message,
        },
      },
      true,
    );
    const buffer = mediaBuffer(downloaded);
    if (!buffer?.length) return null;

    const descriptor = mediaDescriptor(message.message);
    const type = String(downloaded?.mediaType || descriptor?.type || 'document').slice(0, 100);
    const mimetype = String(downloaded?.mimetype || descriptor?.mimetype || 'application/octet-stream').slice(0, 100);
    const name = safeFileName(downloaded?.fileName || descriptor?.fileName || `${mediaId}.bin`);
    const fileName = `meta-compat/inbound/${message.Instance.id}/${mediaId}/${Date.now()}_${name}`;

    const uploaded = await storage.uploadFile(fileName, buffer, buffer.length, { 'Content-Type': mimetype });
    if (!uploaded) return null;

    return persist({
      type,
      fileName,
      mimetype,
      instanceId: message.Instance.id,
    });
  } catch (error) {
    onError?.(error);
    return null;
  }
}

export function mediaBuffer(downloaded: any): Buffer | null {
  if (Buffer.isBuffer(downloaded?.buffer)) return downloaded.buffer;
  if (downloaded?.buffer instanceof Uint8Array) return Buffer.from(downloaded.buffer);
  if (typeof downloaded?.base64 === 'string' && downloaded.base64.trim()) {
    return Buffer.from(downloaded.base64, 'base64');
  }
  return null;
}

export function mediaDescriptor(message: any): MediaDescriptor | null {
  if (!message || typeof message !== 'object') return null;

  for (const [key, type, fallbackMimetype] of MEDIA_TYPES) {
    const media = message[key];
    if (!media || typeof media !== 'object') continue;
    return {
      type,
      mimetype: String(media.mimetype || media.mimeType || fallbackMimetype),
      fileName: String(media.fileName || media.filename || `${type}.bin`),
    };
  }

  for (const wrapper of MEDIA_WRAPPERS) {
    const nested = message?.[wrapper]?.message;
    const descriptor = mediaDescriptor(nested);
    if (descriptor) return descriptor;
  }

  return null;
}

function safeFileName(value: string): string {
  const safe = String(value || 'media.bin')
    .replace(/[^A-Za-z0-9._-]/g, '_')
    .replace(/_+/g, '_');
  return safe || 'media.bin';
}
