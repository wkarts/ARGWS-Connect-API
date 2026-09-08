import {
  AcceptGroupInvite,
  CreateGroupDto,
  GetParticipant,
  GroupDescriptionDto,
  GroupInvite,
  GroupJid,
  GroupPictureDto,
  GroupSendInvite,
  GroupSubjectDto,
  GroupToggleEphemeralDto,
  GroupUpdateParticipantDto,
  GroupUpdateSettingDto,
} from '@api/dto/group.dto';
import { BadRequestException, InternalServerErrorException, NotFoundException } from '@exceptions';
import axios from 'axios';
import { isBase64, isURL } from 'class-validator';

import { ZapoAccountStartupService } from './zapo.provider.account.extensions';

/** Provider-neutral group facade implemented with Zapo's public group APIs. */
export class ZapoGroupStartupService extends ZapoAccountStartupService {
  private groupClient(): any {
    if (!this.client || this.connectionStatus?.state !== 'open') {
      throw new BadRequestException('WhatsApp instance is not connected');
    }
    return this.client;
  }

  private normalizeGroupJid(value: unknown): string {
    const raw = String(value ?? '').trim();
    if (!raw) throw new BadRequestException('Group JID is required');

    const jid = raw.includes('@') ? raw : `${raw}@g.us`;
    if (!jid.endsWith('@g.us')) throw new BadRequestException('Invalid WhatsApp group JID');
    return jid;
  }

  private normalizeGroupMetadata(metadata: any, includeParticipants = true) {
    if (!metadata) return null;

    const participants = Array.isArray(metadata.participants)
      ? metadata.participants.map((participant: any) => ({
          id: participant.jid,
          jid: participant.jid,
          lid: participant.lid,
          phoneNumber: participant.phoneNumber,
          name: participant.displayName,
          username: participant.username,
          admin: participant.isSuperAdmin ? 'superadmin' : participant.isAdmin ? 'admin' : null,
          isAdmin: participant.isAdmin === true,
          isSuperAdmin: participant.isSuperAdmin === true,
        }))
      : [];

    const normalized = {
      ...metadata,
      id: metadata.jid,
      jid: metadata.jid,
      participants: includeParticipants ? participants : undefined,
    };

    if (!includeParticipants) delete normalized.participants;
    return normalized;
  }

  private async normalizeParticipants(numbers: string[]): Promise<string[]> {
    const input = Array.isArray(numbers) ? numbers : [];
    if (input.length === 0) return [];

    const results = await this.whatsappNumber({ numbers: input });
    return results.filter((result) => result?.exists === true).map((result) => result.jid);
  }

  private async resolvePicture(image: string): Promise<Uint8Array> {
    const value = String(image ?? '').trim();
    if (!value) throw new BadRequestException('Group image must be a url or a base64');

    if (isURL(value)) {
      const response = await axios.get(value, { responseType: 'arraybuffer', timeout: 30_000 });
      return new Uint8Array(Buffer.from(response.data));
    }

    if (isBase64(value)) return new Uint8Array(Buffer.from(value, 'base64'));
    throw new BadRequestException('Group image must be a url or a base64');
  }

  public async createGroup(create: CreateGroupDto) {
    try {
      const subject = String(create?.subject ?? '').trim();
      if (!subject) throw new BadRequestException('Group subject is required');

      const participants = await this.normalizeParticipants(create.participants);
      const metadata = await this.groupClient().group.createGroup(subject, participants, {
        ...(create.description ? { description: create.description } : {}),
      });

      if (create.promoteParticipants && participants.length > 0) {
        await this.groupClient().group.promoteParticipants(metadata.jid, participants);
      }

      const current = await this.groupClient().group.queryGroupMetadata(metadata.jid);
      return this.normalizeGroupMetadata(current);
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error creating group', (error as Error)?.toString());
    }
  }

  public async updateGroupPicture(picture: GroupPictureDto) {
    try {
      const groupJid = this.normalizeGroupJid(picture?.groupJid);
      const bytes = await this.resolvePicture(picture?.image);
      const id = await this.groupClient().profile.setProfilePicture(bytes, groupJid);
      return { update: 'success', groupJid, pictureId: id };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error updating group picture', (error as Error)?.toString());
    }
  }

  public async updateGroupSubject(update: GroupSubjectDto) {
    try {
      const groupJid = this.normalizeGroupJid(update?.groupJid);
      const subject = String(update?.subject ?? '').trim();
      if (!subject) throw new BadRequestException('Group subject is required');

      await this.groupClient().group.setSubject(groupJid, subject);
      return { update: 'success', groupJid, subject };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error updating group subject', (error as Error)?.toString());
    }
  }

  public async updateGroupDescription(update: GroupDescriptionDto) {
    try {
      const groupJid = this.normalizeGroupJid(update?.groupJid);
      const metadata = await this.groupClient()
        .group.queryGroupMetadata(groupJid)
        .catch(() => null);
      await this.groupClient().group.setDescription(groupJid, update?.description ?? null, metadata?.descId);
      return { update: 'success', groupJid, description: update?.description ?? null };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error updating group description', (error as Error)?.toString());
    }
  }

  public async findGroup(data: GroupJid) {
    try {
      const groupJid = this.normalizeGroupJid(data?.groupJid);
      const metadata = await this.groupClient().group.queryGroupMetadata(groupJid);
      return this.normalizeGroupMetadata(metadata);
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new NotFoundException('Group not found', (error as Error)?.toString());
    }
  }

  public async fetchAllGroups(data: GetParticipant) {
    try {
      const includeParticipants = String(data?.getParticipants ?? '').toLowerCase() === 'true';
      const groups = await this.groupClient().group.queryAllGroups();
      return groups.map((group: any) => this.normalizeGroupMetadata(group, includeParticipants));
    } catch (error) {
      throw new InternalServerErrorException('Error fetching groups', (error as Error)?.toString());
    }
  }

  public async inviteCode(data: GroupJid) {
    try {
      const groupJid = this.normalizeGroupJid(data?.groupJid);
      const code = await this.groupClient().group.queryInviteCode(groupJid);
      return { inviteUrl: `https://chat.whatsapp.com/${code}`, inviteCode: code };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new NotFoundException('No invite code', (error as Error)?.toString());
    }
  }

  public async inviteInfo(data: GroupInvite) {
    try {
      const code = String(data?.inviteCode ?? '').trim();
      if (!code) throw new BadRequestException('Invite code is required');
      const info = await this.groupClient().group.queryGroupInviteInfo(code);
      return this.normalizeGroupMetadata(info);
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new NotFoundException('No invite info', (error as Error)?.toString());
    }
  }

  public async sendInvite(data: GroupSendInvite) {
    try {
      const invite = await this.inviteCode({ groupJid: data.groupJid });
      const description = String(data?.description ?? '').trim();
      const text = `${description}${description ? '\n\n' : ''}${invite.inviteUrl}`;
      const targets = await this.normalizeParticipants(data?.numbers ?? []);

      await Promise.all(
        targets.map((jid) =>
          this.groupClient().message.send(jid, {
            type: 'text',
            text,
          }),
        ),
      );

      return { send: true, inviteUrl: invite.inviteUrl };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new NotFoundException('No send invite', (error as Error)?.toString());
    }
  }

  public async acceptInviteCode(data: AcceptGroupInvite) {
    try {
      const code = String(data?.inviteCode ?? '').trim();
      if (!code) throw new BadRequestException('Invite code is required');
      const group = await this.groupClient().group.joinGroupViaInvite(code);
      return this.normalizeGroupMetadata(group);
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error accepting group invite', (error as Error)?.toString());
    }
  }

  public async revokeInviteCode(data: GroupJid) {
    try {
      const groupJid = this.normalizeGroupJid(data?.groupJid);
      const result = await this.groupClient().group.revokeInvite(groupJid);
      return {
        inviteUrl: `https://chat.whatsapp.com/${result.code}`,
        inviteCode: result.code,
        affectedParticipants: result.affectedParticipants ?? [],
      };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error revoking group invite', (error as Error)?.toString());
    }
  }

  public async findParticipants(data: GroupJid) {
    const group = await this.findGroup(data);
    return group?.participants ?? [];
  }

  public async updateGParticipant(update: GroupUpdateParticipantDto) {
    try {
      const groupJid = this.normalizeGroupJid(update?.groupJid);
      const participants = await this.normalizeParticipants(update?.participants ?? []);
      if (participants.length === 0) throw new BadRequestException('No valid WhatsApp participants found');

      const group = this.groupClient().group;
      switch (update.action) {
        case 'add':
          return await group.addParticipants(groupJid, participants);
        case 'remove':
          return await group.removeParticipants(groupJid, participants);
        case 'promote':
          return await group.promoteParticipants(groupJid, participants);
        case 'demote':
          return await group.demoteParticipants(groupJid, participants);
        default:
          throw new BadRequestException(`Unsupported group participant action: ${update.action}`);
      }
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error updating group participants', (error as Error)?.toString());
    }
  }

  public async updateGSetting(update: GroupUpdateSettingDto) {
    try {
      const groupJid = this.normalizeGroupJid(update?.groupJid);
      const group = this.groupClient().group;

      switch (update.action) {
        case 'announcement':
          await group.setSetting(groupJid, 'announce', true);
          break;
        case 'not_announcement':
          await group.setSetting(groupJid, 'announce', false);
          break;
        case 'locked':
          await group.setSetting(groupJid, 'restrict', true);
          break;
        case 'unlocked':
          await group.setSetting(groupJid, 'restrict', false);
          break;
        default:
          throw new BadRequestException(`Unsupported group setting action: ${update.action}`);
      }

      return { update: 'success', groupJid, action: update.action };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error updating group setting', (error as Error)?.toString());
    }
  }

  public async toggleEphemeral(update: GroupToggleEphemeralDto) {
    try {
      const groupJid = this.normalizeGroupJid(update?.groupJid);
      await this.groupClient().group.setEphemeralDuration(groupJid, Number(update?.expiration ?? 0));
      return { update: 'success', groupJid, expiration: Number(update?.expiration ?? 0) };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error updating ephemeral duration', (error as Error)?.toString());
    }
  }

  public async leaveGroup(data: GroupJid) {
    try {
      const groupJid = this.normalizeGroupJid(data?.groupJid);
      await this.groupClient().group.leaveGroup([groupJid]);
      return { leave: 'success', groupJid };
    } catch (error) {
      if (error && typeof error === 'object' && 'status' in error) throw error;
      throw new InternalServerErrorException('Error leaving group', (error as Error)?.toString());
    }
  }
}
