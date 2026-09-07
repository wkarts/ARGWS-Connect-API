import { BlockUserDto, PrivacySettingDto, ReadMessageDto } from '@api/dto/chat.dto';
import { BadRequestException, InternalServerErrorException } from '@exceptions';
import { createJid } from '@utils/createJid';
import axios from 'axios';
import { isBase64, isURL } from 'class-validator';

import { ZapoExtendedStartupService } from './zapo.provider.extensions';

/**
 * Connect|API account/chat compatibility built only on Zapo's public client
 * coordinators. Keeping this outside the transport provider avoids coupling
 * controller parity to Zapo protocol internals.
 */
export class ZapoAccountStartupService extends ZapoExtendedStartupService {
  private connectedClient(): any {
    if (!this.client || this.connectionStatus?.state !== 'open') {
      throw new BadRequestException('WhatsApp instance is not connected');
    }
    return this.client;
  }

  private normalizeAccountJid(value: unknown): string {
    const raw = String(value ?? '').trim();
    if (!raw) throw new BadRequestException('WhatsApp number or JID is required');

    const jid = createJid(raw);
    const localPart = jid.split('@')[0];
    if (!jid.includes('@') || !localPart) {
      throw new BadRequestException('Invalid WhatsApp number or JID');
    }
    if ((jid.endsWith('@s.whatsapp.net') || jid.endsWith('@lid')) && !/^\d+@/.test(jid)) {
      throw new BadRequestException('Invalid WhatsApp user JID');
    }

    return jid;
  }

  /** Mark one or more conversations read using Zapo's native receipt API. */
  public async markMessageAsRead(data: ReadMessageDto) {
    try {
      const client = this.connectedClient();
      const grouped = new Map<string, string[]>();

      for (const message of data?.readMessages ?? []) {
        if (!message?.id) continue;
        const jid = this.normalizeAccountJid(message.remoteJid);
        const ids = grouped.get(jid) ?? [];
        ids.push(message.id);
        grouped.set(jid, ids);
      }

      for (const [jid, ids] of grouped) {
        await client.message.sendReceipt(jid, ids, { type: 'read' });
      }

      return { message: 'Read messages', read: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Read messages fail', (error as Error)?.toString());
    }
  }

  /** Return the legacy Connect|API privacy payload using Zapo's typed snapshot. */
  public async fetchPrivacySettings() {
    try {
      const privacy = await this.connectedClient().privacy.getPrivacySettings();
      return {
        readreceipts: privacy.readReceipts,
        profile: privacy.profilePicture,
        status: privacy.about,
        online: privacy.online,
        last: privacy.lastSeen,
        groupadd: privacy.groupAdd,
      };
    } catch (error) {
      throw new InternalServerErrorException('Error fetching privacy settings', (error as Error)?.toString());
    }
  }

  /**
   * Preserve the existing Connect|API privacy DTO while routing every category
   * through Zapo's public privacy coordinator.
   */
  public async updatePrivacySettings(settings: PrivacySettingDto) {
    try {
      const privacy = this.connectedClient().privacy;
      await privacy.setPrivacySetting('readReceipts', settings.readreceipts);
      await privacy.setPrivacySetting('profilePicture', settings.profile);
      await privacy.setPrivacySetting('about', settings.status);
      await privacy.setPrivacySetting('online', settings.online);
      await privacy.setPrivacySetting('lastSeen', settings.last);
      await privacy.setPrivacySetting('groupAdd', settings.groupadd);

      return { update: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Error updating privacy settings', (error as Error)?.toString());
    }
  }

  /** Update the WhatsApp push/display name without reconnecting the session. */
  public async updateProfileName(name: string) {
    try {
      const normalized = String(name ?? '').trim();
      if (!normalized) throw new BadRequestException('Profile name is required');

      await this.connectedClient().profile.setPushName(normalized);
      return { update: 'success' };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Error updating profile name', (error as Error)?.toString());
    }
  }

  /** Update the legacy WhatsApp About/status text. */
  public async updateProfileStatus(status: string) {
    try {
      await this.connectedClient().profile.setStatus(String(status ?? ''));
      return { update: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Error updating profile status', (error as Error)?.toString());
    }
  }

  private async resolveProfilePicture(picture: string): Promise<Uint8Array> {
    const value = String(picture ?? '').trim();
    if (!value) throw new BadRequestException('"profilePicture" must be a url or a base64');

    if (isURL(value)) {
      const response = await axios.get(value, {
        responseType: 'arraybuffer',
        timeout: 30_000,
      });
      return new Uint8Array(Buffer.from(response.data));
    }

    if (isBase64(value)) {
      return new Uint8Array(Buffer.from(value, 'base64'));
    }

    throw new BadRequestException('"profilePicture" must be a url or a base64');
  }

  /** Update the current account picture through Zapo's public profile API. */
  public async updateProfilePicture(picture: string) {
    try {
      const bytes = await this.resolveProfilePicture(picture);
      await this.connectedClient().profile.setProfilePicture(bytes);
      return { update: 'success' };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Error updating profile picture', (error as Error)?.toString());
    }
  }

  public async removeProfilePicture() {
    try {
      await this.connectedClient().profile.deleteProfilePicture();
      return { update: 'success' };
    } catch (error) {
      throw new InternalServerErrorException('Error removing profile picture', (error as Error)?.toString());
    }
  }

  /** Block/unblock through Zapo's LID-aware blocklist implementation. */
  public async blockUser(data: BlockUserDto) {
    try {
      const contact = (await this.whatsappNumber({ numbers: [data.number] }))?.[0];
      if (!contact?.exists) {
        throw new BadRequestException('Number is not on WhatsApp');
      }

      const privacy = this.connectedClient().privacy;
      if (data.status === 'block') {
        await privacy.blockUser(contact.jid);
      } else {
        await privacy.unblockUser(contact.jid);
      }

      return { block: 'success' };
    } catch (error) {
      if (error instanceof BadRequestException) throw error;
      throw new InternalServerErrorException('Error blocking user', (error as Error)?.toString());
    }
  }
}
