import { getObjectUrl, uploadFile } from '@api/integrations/storage/s3/libs/minio.server';
import type { PrismaRepository } from '@api/repository/repository.service';
import type { CacheService } from '@api/services/cache.service';
import { Logger } from '@config/logger.config';
import { prismaJsonPath } from '@utils/prismaJsonPath';
import { randomUUID } from 'crypto';

import {
  CanonicalMediaStorage,
  materializeProviderMedia,
  ProviderMediaRegistryEntry,
} from './meta-cloud-media.materializer';
import { MetaCloudGraphError } from './meta-cloud.error';
import { metaCloudMetrics } from './meta-cloud.metrics';
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

const DEFAULT_MEDIA_STORAGE: CanonicalMediaStorage = { getObjectUrl, uploadFile };

export class MetaCloudMediaService {
  private readonly memoryUploads = new Map<string, UploadedMediaRef>();
  private readonly logger = new Logger('MetaCloudMediaService');

  constructor(
    private readonly prisma: PrismaRepository,
    private readonly cache: CacheService,
    private readonly monitor?: ProviderRegistry,
    private readonly storage: CanonicalMediaStorage = DEFAULT_MEDIA_STORAGE,
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

  public async describe(located: LocatedMedia) {
    let fileName = located.fileName;
    let mimetype = located.mimetype;

    if (!fileName && located.message) {
      const materialized = await this.materializeFromProvider(located.id, located.message);
      fileName = materialized?.fileName;
      mimetype = materialized?.mimetype;
    }

    if (!fileName) throw new MetaCloudGraphError(404, `Media ${located.id} was not found.`);
    const url = await this.storage.getObjectUrl(fileName, 300);
    if (!url) throw new MetaCloudGraphError(500, 'Unable to create a temporary media URL.');
    metaCloudMetrics.increment('connect_meta_compat_media_requests_total');
    return { id: located.id, mime_type: mimetype || 'application/octet-stream', url };
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
}
