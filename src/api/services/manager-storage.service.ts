import {
  BUCKET,
  deleteStoredFile,
  listBucketObjects,
  MANAGED_OBJECT_PREFIX,
  managedObjectKey,
  minioEnabled,
  StoredObjectSummary,
} from '@api/integrations/storage/s3/libs/minio.server';
import { PrismaRepository } from '@api/repository/repository.service';
import { Logger } from '@config/logger.config';
import { prismaJsonPath } from '@utils/prismaJsonPath';
import { randomBytes } from 'crypto';

export const STORAGE_STATUS_RESOURCE = 'status-broadcast';
export const STORAGE_PLAN_TTL_MS = 5 * 60 * 1000;

type StorageScope = 'global' | 'instance';
type StorageResource = {
  key: string;
  label: string;
  objectCount: number;
  mediaCount: number;
  bytes: number;
  cleanable: boolean;
  note?: string;
};

export type ManagerStorageOverview = {
  enabled: boolean;
  bucket: string | null;
  managedPrefix: string;
  generatedAt: string;
  truncated: boolean;
  objectCount: number;
  totalBytes: number;
  managedObjectCount: number;
  managedBytes: number;
  untrackedObjectCount: number;
  untrackedBytes: number;
  databaseMediaCount: number;
  missingObjectCount: number;
  resources: StorageResource[];
  instances: Array<{
    id: string;
    name: string;
    databaseMediaCount: number;
    objectCount: number;
    bytes: number;
    missingObjectCount: number;
  }>;
  cleanup: {
    supportedResources: Array<{ key: string; label: string; safe: boolean }>;
    policy: string;
  };
};

type StorageMedia = {
  id: string;
  fileName: string;
  type: string;
  mimetype: string;
  createdAt: Date | null;
  instanceId: string;
  Message?: { id?: string; key?: unknown; messageTimestamp?: number } | null;
};

type CleanupCandidate = {
  messageId: string;
  instanceId: string;
  fileName: string | null;
  bytes: number;
  resource: string;
  messageTimestamp: number | null;
};

type CleanupPlan = {
  id: string;
  scope: StorageScope;
  instanceId?: string;
  resource: string;
  expiresAt: number;
  candidates: CleanupCandidate[];
};

type StorageRepository = Pick<PrismaRepository, 'media' | 'message' | 'instance'>;

export class ManagerStorageError extends Error {
  constructor(
    message: string,
    public readonly status = 503,
  ) {
    super(message);
    this.name = 'ManagerStorageError';
  }
}

function positiveInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(maximum, Math.max(0, Math.floor(parsed)));
}

function remoteJid(key: unknown): string {
  if (!key || typeof key !== 'object') return '';
  return String((key as Record<string, unknown>).remoteJid || '');
}

function resourceFor(media: StorageMedia): string {
  if (remoteJid(media.Message?.key) === 'status@broadcast') return STORAGE_STATUS_RESOURCE;
  const type = String(media.type || '')
    .trim()
    .toLowerCase();
  const mimetype = String(media.mimetype || '')
    .trim()
    .toLowerCase();
  return type || mimetype.split('/')[0] || 'other';
}

function resourceLabel(key: string): string {
  if (key === STORAGE_STATUS_RESOURCE) return 'Status/broadcast';
  if (key === 'image') return 'Imagens';
  if (key === 'video') return 'Vídeos';
  if (key === 'audio') return 'Áudios';
  if (key === 'document') return 'Documentos';
  return key === 'other' ? 'Outros' : key;
}

/**
 * Read and clean only application-owned MinIO media. The service intentionally
 * never exposes credentials, presigned URLs, container paths, or arbitrary
 * object deletion to the Manager.
 */
export class ManagerStorageService {
  private readonly logger = new Logger(ManagerStorageService.name);
  private readonly plans = new Map<string, CleanupPlan>();

  constructor(private readonly prismaRepository: StorageRepository) {}

  public async overview(instanceId?: string): Promise<ManagerStorageOverview> {
    const snapshot = await this.snapshot();
    return this.toOverview(snapshot, instanceId);
  }

  public async cleanupPreview(input: {
    scope?: StorageScope;
    instanceId?: string;
    resource?: string;
    olderThanDays?: number;
    limit?: number;
  }) {
    if (!minioEnabled()) {
      throw new ManagerStorageError('MinIO não está habilitado nesta instalação.', 409);
    }

    const scope: StorageScope = input.scope === 'instance' ? 'instance' : 'global';
    const instanceId = String(input.instanceId || '').trim();
    if (scope === 'instance' && !instanceId) {
      throw new ManagerStorageError('Informe a instância para uma limpeza individual.', 400);
    }

    const resource = String(input.resource || STORAGE_STATUS_RESOURCE)
      .trim()
      .toLowerCase();
    if (resource !== STORAGE_STATUS_RESOURCE) {
      throw new ManagerStorageError(
        'A limpeza automática está limitada a Status/broadcast. Objetos de outros recursos podem ser usados por mensagens ou integrações externas.',
        409,
      );
    }

    const olderThanDays = positiveInteger(input.olderThanDays, 1, 3650);
    const limit = Math.min(500, Math.max(1, positiveInteger(input.limit, 100, 500)));
    const cutoff = Math.floor(Date.now() / 1000) - olderThanDays * 24 * 60 * 60;
    const where: any = {
      AND: [
        { key: { path: prismaJsonPath('remoteJid'), equals: 'status@broadcast' } },
        ...(instanceId ? [{ instanceId }] : []),
        ...(olderThanDays > 0 ? [{ messageTimestamp: { lte: cutoff } }] : []),
      ],
    };

    const rows = (await (this.prismaRepository.message as any).findMany({
      where,
      orderBy: { messageTimestamp: 'asc' },
      take: limit,
      select: {
        id: true,
        instanceId: true,
        key: true,
        messageTimestamp: true,
        Media: { select: { fileName: true } },
      },
    })) as Array<{
      id: string;
      instanceId: string;
      key: unknown;
      messageTimestamp: number;
      Media?: { fileName: string } | null;
    }>;

    let objects: StoredObjectSummary[];
    try {
      objects = (await listBucketObjects()).objects;
    } catch (error) {
      this.logger.warn(`Unable to inspect MinIO for a cleanup preview: ${error?.message || error}`);
      throw new ManagerStorageError('Não foi possível consultar o MinIO para preparar a limpeza.', 503);
    }
    const objectByKey = new Map(objects.map((object) => [object.key, object]));
    const candidates: CleanupCandidate[] = rows
      .filter((row) => remoteJid(row.key) === 'status@broadcast')
      .map((row) => {
        const fileName = row.Media?.fileName || null;
        const object = fileName ? objectByKey.get(managedObjectKey(fileName) || '') : undefined;
        return {
          messageId: row.id,
          instanceId: row.instanceId,
          fileName,
          bytes: object?.size || 0,
          resource: STORAGE_STATUS_RESOURCE,
          messageTimestamp: Number.isFinite(Number(row.messageTimestamp)) ? Number(row.messageTimestamp) : null,
        };
      });

    const plan: CleanupPlan = {
      id: randomBytes(24).toString('hex'),
      scope,
      ...(instanceId ? { instanceId } : {}),
      resource,
      expiresAt: Date.now() + STORAGE_PLAN_TTL_MS,
      candidates,
    };
    this.plans.set(plan.id, plan);
    this.prunePlans();

    const instances = await this.prismaRepository.instance.findMany({ select: { id: true, name: true } });
    const names = new Map(instances.map((item) => [item.id, item.name]));
    return {
      planId: plan.id,
      expiresAt: new Date(plan.expiresAt).toISOString(),
      scope,
      instanceId: instanceId || null,
      resource,
      count: candidates.length,
      bytes: candidates.reduce((total, item) => total + item.bytes, 0),
      candidates: candidates.map((item) => ({
        ...item,
        instanceName: names.get(item.instanceId) || item.instanceId,
        timestamp: item.messageTimestamp ? new Date(item.messageTimestamp * 1000).toISOString() : null,
      })),
      warning:
        'A confirmação remove somente mensagens status@broadcast e a mídia vinculada. Objetos externos, sessões e integrações não são tocados.',
    };
  }

  public async cleanup(input: { planId?: string; confirm?: boolean }) {
    const planId = String(input.planId || '').trim();
    if (!planId || input.confirm !== true) {
      throw new ManagerStorageError('Confirme explicitamente o plano de limpeza antes de executar.', 400);
    }
    const plan = this.plans.get(planId);
    if (!plan || plan.expiresAt <= Date.now()) {
      this.plans.delete(planId);
      throw new ManagerStorageError('O plano de limpeza expirou. Gere uma nova prévia.', 409);
    }

    let removed = 0;
    let failed = 0;
    let skipped = 0;
    let freedBytes = 0;
    const failures: string[] = [];

    for (const candidate of plan.candidates) {
      try {
        const current = await (this.prismaRepository.message as any).findUnique({
          where: { id: candidate.messageId },
          select: {
            id: true,
            instanceId: true,
            key: true,
            Media: { select: { fileName: true } },
          },
        });
        if (
          !current ||
          current.instanceId !== candidate.instanceId ||
          remoteJid(current.key) !== 'status@broadcast' ||
          (plan.scope === 'instance' && current.instanceId !== plan.instanceId)
        ) {
          skipped += 1;
          continue;
        }

        const fileName = current.Media?.fileName ? String(current.Media.fileName) : '';
        if (fileName && !managedObjectKey(fileName)) {
          failed += 1;
          failures.push(`${candidate.messageId}: nome de arquivo não gerenciado`);
          continue;
        }
        if (fileName && !(await deleteStoredFile(fileName))) {
          failed += 1;
          failures.push(`${candidate.messageId}: MinIO não confirmou a remoção`);
          continue;
        }

        await (this.prismaRepository.message as any).deleteMany({ where: { id: candidate.messageId } });
        removed += 1;
        freedBytes += candidate.bytes;
      } catch (error) {
        failed += 1;
        failures.push(`${candidate.messageId}: ${error?.message || 'falha inesperada'}`);
      }
    }

    this.plans.delete(planId);
    return {
      status: failed ? 'partial' : 'completed',
      requested: plan.candidates.length,
      removed,
      skipped,
      failed,
      freedBytes,
      failures,
    };
  }

  private async snapshot() {
    let objectResult: { objects: StoredObjectSummary[]; truncated: boolean };
    try {
      objectResult = await listBucketObjects();
    } catch (error) {
      this.logger.warn(`Unable to inspect MinIO bucket: ${error?.message || error}`);
      throw new ManagerStorageError('Não foi possível consultar o MinIO nesta instalação.', 503);
    }

    const [media, instances] = await Promise.all([
      (this.prismaRepository.media as any).findMany({
        select: {
          id: true,
          fileName: true,
          type: true,
          mimetype: true,
          createdAt: true,
          instanceId: true,
          Message: { select: { id: true, key: true, messageTimestamp: true } },
        },
      }),
      (this.prismaRepository.instance as any).findMany({
        select: { id: true, name: true },
      }),
    ]);

    return {
      objects: objectResult.objects,
      truncated: objectResult.truncated,
      media: media as StorageMedia[],
      instances,
    };
  }

  private toOverview(snapshot: Awaited<ReturnType<ManagerStorageService['snapshot']>>, instanceId?: string) {
    const objectByKey = new Map(snapshot.objects.map((object) => [object.key, object]));
    const mediaByKey = new Map<string, StorageMedia[]>();
    for (const media of snapshot.media) {
      const key = managedObjectKey(media.fileName);
      if (!key) continue;
      const current = mediaByKey.get(key) || [];
      current.push(media);
      mediaByKey.set(key, current);
    }

    // Keep one complete database snapshot so that the global integrity report
    // remains accurate even when the Manager is displaying one instance. The
    // resource and usage totals below are scoped to the selected instance.
    const scopedMedia = instanceId ? snapshot.media.filter((media) => media.instanceId === instanceId) : snapshot.media;
    const scopedObjectKeys = new Set<string>();
    for (const media of scopedMedia) {
      const key = managedObjectKey(media.fileName);
      if (key && objectByKey.has(key)) scopedObjectKeys.add(key);
    }

    const resourceMap = new Map<string, StorageResource>();
    const instanceMap = new Map<
      string,
      {
        id: string;
        name: string;
        databaseMediaCount: number;
        objectCount: number;
        bytes: number;
        missingObjectCount: number;
        keys: Set<string>;
      }
    >();
    for (const instance of snapshot.instances.filter((item) => !instanceId || item.id === instanceId)) {
      instanceMap.set(instance.id, {
        id: instance.id,
        name: instance.name,
        databaseMediaCount: 0,
        objectCount: 0,
        bytes: 0,
        missingObjectCount: 0,
        keys: new Set(),
      });
    }

    let managedBytes = 0;
    let managedObjectCount = 0;
    let missingObjectCount = 0;
    const managedKeys = new Set<string>();
    for (const media of scopedMedia) {
      const instance = instanceMap.get(media.instanceId) || {
        id: media.instanceId,
        name: media.instanceId,
        databaseMediaCount: 0,
        objectCount: 0,
        bytes: 0,
        missingObjectCount: 0,
        keys: new Set<string>(),
      };
      instanceMap.set(media.instanceId, instance);
      instance.databaseMediaCount += 1;
      const key = managedObjectKey(media.fileName);
      const object = key ? objectByKey.get(key) : undefined;
      const resourceKey = resourceFor(media);
      const resource = resourceMap.get(resourceKey) || {
        key: resourceKey,
        label: resourceLabel(resourceKey),
        objectCount: 0,
        mediaCount: 0,
        bytes: 0,
        cleanable: resourceKey === STORAGE_STATUS_RESOURCE,
        ...(resourceKey !== STORAGE_STATUS_RESOURCE
          ? { note: 'Não limpar automaticamente: pode estar ligado a mensagens ou integrações externas.' }
          : {}),
      };
      resource.mediaCount += 1;
      if (!object) {
        missingObjectCount += 1;
        instance.missingObjectCount += 1;
      } else if (key && !managedKeys.has(key)) {
        managedKeys.add(key);
        managedBytes += object.size;
        managedObjectCount += 1;
        resource.objectCount += 1;
        resource.bytes += object.size;
        if (!instance.keys.has(key)) {
          instance.keys.add(key);
          instance.objectCount += 1;
          instance.bytes += object.size;
        }
      }
      resourceMap.set(resourceKey, resource);
    }

    const scopedObjects = instanceId
      ? snapshot.objects.filter((object) => scopedObjectKeys.has(object.key))
      : snapshot.objects;
    const totalBytes = scopedObjects.reduce((total, object) => total + object.size, 0);
    const untrackedObjects = snapshot.objects.filter((object) => !mediaByKey.has(object.key));
    const result: ManagerStorageOverview = {
      enabled: minioEnabled(),
      bucket: minioEnabled() ? String(BUCKET.BUCKET_NAME || '') || null : null,
      managedPrefix: MANAGED_OBJECT_PREFIX,
      generatedAt: new Date().toISOString(),
      truncated: snapshot.truncated,
      objectCount: scopedObjects.length,
      totalBytes,
      managedObjectCount,
      managedBytes,
      untrackedObjectCount: untrackedObjects.length,
      untrackedBytes: untrackedObjects.reduce((total, object) => total + object.size, 0),
      databaseMediaCount: scopedMedia.length,
      missingObjectCount,
      resources: [...resourceMap.values()].sort((a, b) => b.bytes - a.bytes),
      instances: [...instanceMap.values()]
        .map(({ id, name, databaseMediaCount, objectCount, bytes, missingObjectCount }) => ({
          id,
          name,
          databaseMediaCount,
          objectCount,
          bytes,
          missingObjectCount,
        }))
        .sort((a, b) => b.bytes - a.bytes),
      cleanup: {
        supportedResources: [{ key: STORAGE_STATUS_RESOURCE, label: 'Status/broadcast', safe: true }],
        policy:
          'A limpeza confirmada remove somente status@broadcast expirado e sua mídia gerenciada. Objetos sem referência, sessões e integrações externas permanecem intactos.',
      },
    };

    if (instanceId && !result.instances.some((item) => item.id === instanceId)) {
      throw new ManagerStorageError('Instância não encontrada para o relatório de armazenamento.', 404);
    }
    return result;
  }

  private prunePlans() {
    const now = Date.now();
    for (const [id, plan] of this.plans) {
      if (plan.expiresAt <= now) this.plans.delete(id);
    }
    while (this.plans.size > 32) {
      const first = this.plans.keys().next().value;
      if (!first) break;
      this.plans.delete(first);
    }
  }
}
