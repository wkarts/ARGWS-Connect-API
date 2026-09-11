import { getObjectStream, getObjectUrl, uploadFile } from '@api/integrations/storage/s3/libs/minio.server';
import type { PrismaRepository } from '@api/repository/repository.service';
import type { CacheService } from '@api/services/cache.service';
import { ConfigService, HttpServer } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { prismaJsonPath } from '@utils/prismaJsonPath';
import { randomUUID } from 'crypto';

import { MetaCloudGraphError } from './meta-cloud.error';
import { metaCloudMetrics } from './meta-cloud.metrics';
import {
  CanonicalMediaStorage,
  materializeProviderMedia,
  ProviderMediaRegistryEntry,
} from './meta-cloud-media.materializer';
import { MetaCloudIdentity } from './types/meta-response.types';

interface UploadedMediaRef {
  id: string;
  instanceId: string;
  fileName: string;
  mimetype: string;
  createdAt: number;
}

interface LocatedMedia {
  instance: any;
  id: string;
  fileName?: string;
  mimetype?: string;
  message?: any;
}

interface ProviderRegistry {
  waInstances: Record<string, ProviderMediaRegistryEntry>;
}

interface PublicMediaStorage extends CanonicalMediaStorage {
  getObjectStream?: (fileName: string) => Promise<any | null>;
}

interface MediaDownloadTicket {
  mediaId: string;
  fileName: string;
  mimetype: string;
  expiresAt: number;
}

const MEDIA_DOWNLOAD_TTL_SECONDS = 300;
const DEFAULT_MEDIA_STORAGE: PublicMediaStorage = { getObjectStream, getObjectUrl, uploadFile };

function defaultPublicBaseUrl(): string {
  return String(new ConfigService().get<HttpServer>('SERVER')?.URL || '').replace(/\/+$/u, '');
}

export class MetaCloudMediaService {
  private readonly memoryUploads = new Map<string, UploadedMediaRef>();
  private readonly memoryDownloads = new Map<string, MediaDownloadTicket>();
  private readonly logger = new Logger('MetaCloudMediaService');

  constructor(
    private readonly prisma: PrismaRepository,
    private readonly cache: CacheService,
    private readonly monitor?: ProviderRegistry,
    private readonly storage: PublicMediaStorage = DEFAULT_MEDIA_STORAGE,
    private readonly publicBaseUrl: string = defaultPublicBaseUrl(),
  ) {}

  public async upload(identity: MetaCloudIdentity, file: any, declaredType?: string) {
    if (!file?.buffer?.length) throw new MetaCloudGraphError(400, 'A multipart file is required.');
    const id = randomUUID().replace(/-/g, '');
    const safeName = String(file.originalname || 'media.bin').replace(/[^A-Za-z0-9._-]/g, '_');
    const fileName = `meta-compat/${identity.instanceId}/${id}/${safeName}`;
    const mimetype = String(declaredType || file.mimetype || 'application/octet-stream');
    const result = await this.storage.uploadFile(fileName, file.buffer, file.size, { 'Content-Type': mimetype });
    if (!result) throw new MetaCloudGraphError(500, 'Media storage is not available.');

    const ref: UploadedMediaRef = { id, instanceId: identity.instanceId, fileName, mimetype, createdAt: Date.now() };
    this.memoryUploads.set(id, ref);
    await this.cache.set(this.cacheKey(id), JSON.stringify(ref), 3600);
    metaCloudMetrics.increment('connect_meta_compat_media_requests_total');
    return { id };
  }

  public async resolveOutbound(media: { link?: string; id?: string } | undefined, identity: MetaCloudIdentity) {
    if (media?.link) return media.link;
    if (!media?.id) throw new MetaCloudGraphError(400, 'Media must contain link or id.');
    const ref = await this.getUploadRef(media.id);
    if (!ref || ref.instanceId !== identity.instanceId)
      throw new MetaCloudGraphError(404, `Media ${media.id} was not found.`);
    const url = await this.storage.getObjectUrl(ref.fileName, 300);
    if (!url) throw new MetaCloudGraphError(500, 'Unable to create a temporary media URL.');
    return url;
  }

  public async locate(mediaId: string): Promise<LocatedMedia> {
    let message = await this.findMessage(mediaId);
    if (message?.Instance) return this.locateMessage(mediaId, message);

    const ref = await this.getUploadRef(mediaId);
    if (ref) {
      const instance = await this.prisma.instance.findUnique({ where: { id: ref.instanceId } });
      if (instance) return { instance, id: mediaId, fileName: ref.fileName, mimetype: ref.mimetype };
    }

    // A Meta webhook can reach its consumer before the normal persistence path
    // commits Message. Identification stays read-only here because Graph calls
    // locate() before authorization. Binary materialization happens in describe().
    message = await this.findMessageWithRetry(mediaId);
    if (message?.Instance) return this.locateMessage(mediaId, message);

    throw new MetaCloudGraphError(404, `Media ${mediaId} was not found.`);
  }

  public async describe(located: LocatedMedia, graphVersion = 'v20.0') {
    let fileName = located.fileName;
    let mimetype = located.mimetype;

    if (!fileName && located.message) {
      const materialized = await this.materializeFromProvider(located.id, located.message);
      fileName = materialized?.fileName;
      mimetype = materialized?.mimetype;
    }

    if (!fileName) throw new MetaCloudGraphError(404, `Media ${located.id} was not found.`);
    const resolvedMimetype = mimetype || 'application/octet-stream';
    const url = await this.issuePublicDownloadUrl(located.id, fileName, resolvedMimetype, graphVersion);
    metaCloudMetrics.increment('connect_meta_compat_media_requests_total');
    return { id: located.id, mime_type: resolvedMimetype, url };
  }

  public async openPublicDownload(mediaId: string, token: string | undefined) {
    this.cleanupExpiredDownloadTickets();
    const ticket = token ? await this.getDownloadTicket(token) : null;
    if (!ticket || ticket.mediaId !== mediaId || ticket.expiresAt <= Date.now()) {
      throw new MetaCloudGraphError(404, `Media ${mediaId} was not found or the temporary URL has expired.`);
    }

    if (typeof this.storage.getObjectStream !== 'function') {
      throw new MetaCloudGraphError(500, 'Media storage streaming is not available.');
    }

    const stream = await this.storage.getObjectStream(ticket.fileName);
    if (!stream) throw new MetaCloudGraphError(500, 'Unable to read media from storage.');

    return {
      stream,
      mimetype: ticket.mimetype,
      fileName: ticket.fileName.split('/').pop() || 'media.bin',
      expiresAt: ticket.expiresAt,
    };
  }

  private async issuePublicDownloadUrl(
    mediaId: string,
    fileName: string,
    mimetype: string,
    graphVersion: string,
  ): Promise<string> {
    if (!this.publicBaseUrl) {
      throw new MetaCloudGraphError(500, 'SERVER_URL is required to expose temporary media downloads.');
    }

    this.cleanupExpiredDownloadTickets();
    const token = randomUUID().replace(/-/g, '') + randomUUID().replace(/-/g, '');
    const ticket: MediaDownloadTicket = {
      mediaId,
      fileName,
      mimetype,
      expiresAt: Date.now() + MEDIA_DOWNLOAD_TTL_SECONDS * 1000,
    };
    this.memoryDownloads.set(token, ticket);
    await this.cache.set(this.downloadCacheKey(token), JSON.stringify(ticket), MEDIA_DOWNLOAD_TTL_SECONDS);

    return `${this.publicBaseUrl}/graph/${encodeURIComponent(graphVersion)}/${encodeURIComponent(mediaId)}/content?token=${encodeURIComponent(token)}`;
  }

  private cleanupExpiredDownloadTickets() {
    const now = Date.now();
    for (const [token, ticket] of this.memoryDownloads.entries()) {
      if (ticket.expiresAt <= now) this.memoryDownloads.delete(token);
    }
  }

  private async getDownloadTicket(token: string): Promise<MediaDownloadTicket | null> {
    const local = this.memoryDownloads.get(token);
    if (local?.expiresAt && local.expiresAt > Date.now()) return local;

    const cached = await this.cache.get(this.downloadCacheKey(token));
    if (!cached) return null;

    try {
      const ticket = (typeof cached === 'string' ? JSON.parse(cached) : cached) as MediaDownloadTicket;
      if (!ticket?.mediaId || !ticket?.fileName || !ticket?.expiresAt || ticket.expiresAt <= Date.now()) return null;
      this.memoryDownloads.set(token, ticket);
      return ticket;
    } catch {
      return null;
    }
  }

  private locateMessage(mediaId: string, message: any): LocatedMedia {
    if (message.Media) {
      return {
        instance: message.Instance,
        id: mediaId,
        fileName: message.Media.fileName,
        mimetype: message.Media.mimetype,
      };
    }

    return {
      instance: message.Instance,
      id: mediaId,
      message,
    };
  }

  private async materializeFromProvider(mediaId: string, message: any): Promise<any | null> {
    const instanceName = String(message?.Instance?.name || '').trim();
    const provider = instanceName ? this.monitor?.waInstances?.[instanceName] : null;

    return materializeProviderMedia({
      mediaId,
      message,
      provider,
      storage: this.storage,
      persist: (record) =>
        this.prisma.media.upsert({
          where: { messageId: message.id },
          update: record,
          create: {
            messageId: message.id,
            ...record,
          },
        }),
      onError: (error) =>
        this.logger.warn(
          `Unable to materialize provider-neutral media ${mediaId}: ${(error as Error)?.message || error}`,
        ),
    });
  }

  private async findMessage(mediaId: string): Promise<any | null> {
    return this.prisma.message.findFirst({
      where: {
        key: { path: prismaJsonPath('id'), equals: mediaId } as any,
      },
      include: { Media: true, Instance: true },
    });
  }

  private async findMessageWithRetry(mediaId: string): Promise<any | null> {
    for (const delayMs of [75, 225, 500, 1000]) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      const message = await this.findMessage(mediaId);
      if (message) return message;
    }
    return null;
  }

  private async getUploadRef(id: string): Promise<UploadedMediaRef | null> {
    const local = this.memoryUploads.get(id);
    if (local) return local;
    const cached = await this.cache.get(this.cacheKey(id));
    if (!cached) return null;
    try {
      const ref = typeof cached === 'string' ? JSON.parse(cached) : cached;
      if (ref?.id && ref?.instanceId && ref?.fileName) {
        this.memoryUploads.set(id, ref);
        return ref;
      }
    } catch {
      return null;
    }
    return null;
  }

  private cacheKey(id: string) {
    return `meta-cloud:media:${id}`;
  }

  private downloadCacheKey(token: string) {
    return `meta-cloud:download:${token}`;
  }
}
