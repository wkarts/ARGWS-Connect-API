import { getObjectUrl, uploadFile } from '@api/integrations/storage/s3/libs/minio.server';
import { PrismaRepository } from '@api/repository/repository.service';
import { CacheService } from '@api/services/cache.service';
import { prismaJsonPath } from '@utils/prismaJsonPath';
import { randomUUID } from 'crypto';

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

export class MetaCloudMediaService {
  private readonly memoryUploads = new Map<string, UploadedMediaRef>();

  constructor(
    private readonly prisma: PrismaRepository,
    private readonly cache: CacheService,
  ) {}

  public async upload(identity: MetaCloudIdentity, file: any, declaredType?: string) {
    if (!file?.buffer?.length) throw new MetaCloudGraphError(400, 'A multipart file is required.');
    const id = randomUUID().replace(/-/g, '');
    const safeName = String(file.originalname || 'media.bin').replace(/[^A-Za-z0-9._-]/g, '_');
    const fileName = `meta-compat/${identity.instanceId}/${id}/${safeName}`;
    const mimetype = String(declaredType || file.mimetype || 'application/octet-stream');
    const result = await uploadFile(fileName, file.buffer, file.size, { 'Content-Type': mimetype } as any);
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
    const url = await getObjectUrl(ref.fileName, 300);
    if (!url) throw new MetaCloudGraphError(500, 'Unable to create a temporary media URL.');
    return url;
  }

  public async locate(mediaId: string): Promise<{ instance: any; id: string; fileName: string; mimetype: string }> {
    const message = await this.prisma.message.findFirst({
      where: {
        key: { path: prismaJsonPath('id'), equals: mediaId } as any,
      },
      include: { Media: true, Instance: true },
    });
    if (message?.Media && message?.Instance) {
      return {
        instance: message.Instance,
        id: mediaId,
        fileName: message.Media.fileName,
        mimetype: message.Media.mimetype,
      };
    }

    const ref = await this.getUploadRef(mediaId);
    if (ref) {
      const instance = await this.prisma.instance.findUnique({ where: { id: ref.instanceId } });
      if (instance) return { instance, id: mediaId, fileName: ref.fileName, mimetype: ref.mimetype };
    }
    throw new MetaCloudGraphError(404, `Media ${mediaId} was not found.`);
  }

  public async describe(located: { id: string; fileName: string; mimetype: string }) {
    const url = await getObjectUrl(located.fileName, 300);
    if (!url) throw new MetaCloudGraphError(500, 'Unable to create a temporary media URL.');
    metaCloudMetrics.increment('connect_meta_compat_media_requests_total');
    return { id: located.id, mime_type: located.mimetype, url };
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
