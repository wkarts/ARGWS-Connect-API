import { deleteStoredFile } from '@api/integrations/storage/s3/libs/minio.server';
import { PrismaRepository } from '@api/repository/repository.service';
import { Logger } from '@config/logger.config';
import { prismaJsonPath } from '@utils/prismaJsonPath';

export const STATUS_BROADCAST_JID = 'status@broadcast';
export const STATUS_BROADCAST_TTL_SECONDS = 24 * 60 * 60;

const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
const CLEANUP_BATCH_SIZE = 100;

type StatusRetentionRepository = Pick<PrismaRepository, 'media' | 'message' | 'setting'>;
type RemoveStoredFile = (fileName: string) => Promise<boolean>;

type StatusMessage = {
  id: string;
};

/**
 * Status broadcasts are optional and ephemeral. The database is the source of
 * truth for their lifecycle; S3 is removed before the database record so a
 * transient object-store failure never creates untracked media.
 */
export class StatusBroadcastRetentionService {
  private readonly logger = new Logger(StatusBroadcastRetentionService.name);
  private timer?: NodeJS.Timeout;
  private pruning = false;

  constructor(
    private readonly prismaRepository: StatusRetentionRepository,
    private readonly removeStoredFile: RemoveStoredFile = deleteStoredFile,
  ) {}

  public start() {
    if (this.timer) return;

    this.timer = setInterval(() => void this.prune(), CLEANUP_INTERVAL_MS);
    this.timer.unref?.();
    void this.prune();
  }

  public async prune() {
    if (this.pruning) return;

    this.pruning = true;
    let removed = 0;
    let failed = 0;

    try {
      const enabledInstances = await this.getEnabledInstances();
      const expiresBefore = Math.floor(Date.now() / 1000) - STATUS_BROADCAST_TTL_SECONDS;

      let hasMoreMessages = true;
      while (hasMoreMessages) {
        const messages = await this.findStatusMessages(enabledInstances, expiresBefore);
        if (!messages.length) {
          hasMoreMessages = false;
          continue;
        }

        let removedInBatch = 0;
        for (const message of messages) {
          if (await this.removeMessage(message.id)) {
            removed += 1;
            removedInBatch += 1;
          } else {
            failed += 1;
          }
        }

        if (!removedInBatch) {
          hasMoreMessages = false;
          continue;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    } catch (error) {
      failed += 1;
      this.logger.error(`Unable to prune status broadcasts: ${error?.message || error}`);
    } finally {
      this.pruning = false;
    }

    if (removed) {
      this.logger.info(`Removed ${removed} expired or disabled status broadcast record(s).`);
    }
    if (failed) {
      this.logger.warn(`Retained ${failed} status broadcast record(s) for a later cleanup retry.`);
    }
  }

  public async removeMessage(messageId: string): Promise<boolean> {
    try {
      const media = await this.prismaRepository.media.findUnique({ where: { messageId } });
      if (media?.fileName && !(await this.removeStoredFile(media.fileName))) {
        return false;
      }

      await this.prismaRepository.message.deleteMany({ where: { id: messageId } });
      return true;
    } catch (error) {
      this.logger.error(`Unable to remove status broadcast ${messageId}: ${error?.message || error}`);
      return false;
    }
  }

  private async getEnabledInstances(): Promise<Set<string>> {
    const settings = await this.prismaRepository.setting.findMany({
      select: { instanceId: true, readStatus: true },
    });

    return new Set(settings.filter((setting) => setting.readStatus === true).map((setting) => setting.instanceId));
  }

  private async findStatusMessages(enabledInstances: Set<string>, expiresBefore: number): Promise<StatusMessage[]> {
    const lifecycleFilter = enabledInstances.size
      ? {
          OR: [{ messageTimestamp: { lte: expiresBefore } }, { instanceId: { notIn: [...enabledInstances] } }],
        }
      : {};

    return await this.prismaRepository.message.findMany({
      where: {
        AND: [{ key: { path: prismaJsonPath('remoteJid'), equals: STATUS_BROADCAST_JID } as any }, lifecycleFilter],
      },
      orderBy: { messageTimestamp: 'asc' },
      take: CLEANUP_BATCH_SIZE,
      select: {
        id: true,
      },
    });
  }
}
