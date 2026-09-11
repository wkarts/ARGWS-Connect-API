import { getBase64FromMediaMessageDto } from '@api/dto/chat.dto';
import { prismaJsonPath } from '@utils/prismaJsonPath';

import { ZapoParityStartupService } from './zapo.parity.extensions';
import { isZapoMediaMessage, restorePersistedZapoMedia } from './zapo.media-recovery.helpers';

/**
 * Final ZAPO media compatibility layer.
 *
 * ZapoParityStartupService already owns live raw-event media hydration, S3 and
 * receipt parity. This class only fixes the later/fallback path used by generic
 * Connect|API consumers (HUB included): persisted/webhook JSON has binary ZAPO
 * key material encoded as Base64, while zapo-js requires Uint8Array.
 */
export class ZapoMediaRecoveryStartupService extends ZapoParityStartupService {
  private async findPersistedMessage(messageId: string) {
    if (!messageId) return null;

    return this.prismaRepository.message.findFirst({
      where: {
        instanceId: this.instanceId,
        key: { path: prismaJsonPath('id'), equals: messageId } as any,
      },
    });
  }

  public async getBase64FromMediaMessage(data: getBase64FromMediaMessageDto, getBuffer = false) {
    const input = data?.message as any;
    const messageId = String(input?.key?.id ?? '').trim();
    let recovered = input;

    if (input?.message && typeof input.message === 'object') {
      recovered = {
        ...input,
        message: restorePersistedZapoMedia(input.message),
      };
    } else if (isZapoMediaMessage(input)) {
      // Accept raw Proto.IMessage-shaped requests as well as WebMessageInfo.
      recovered = {
        key: input?.key,
        message: restorePersistedZapoMedia(input),
      };
    } else if (messageId) {
      const stored = await this.findPersistedMessage(messageId);
      if (stored?.message && typeof stored.message === 'object') {
        recovered = {
          ...input,
          key: input?.key ?? stored.key,
          message: restorePersistedZapoMedia(stored.message),
        };
      }
    }

    return super.getBase64FromMediaMessage(
      {
        ...data,
        message: recovered,
      } as getBase64FromMediaMessageDto,
      getBuffer,
    );
  }
}
