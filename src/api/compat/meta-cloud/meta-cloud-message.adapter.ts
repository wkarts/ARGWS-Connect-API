import { ChatController } from '@api/controllers/chat.controller';
import { SendMessageController } from '@api/controllers/sendMessage.controller';
import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { prismaJsonPath } from '@utils/prismaJsonPath';

import { MetaCloudGraphError } from './meta-cloud.error';
import { MetaCloudMediaService } from './meta-cloud-media.service';
import { MetaCloudResponseSerializer } from './meta-cloud-response.serializer';
import { MetaCloudMessageRequest } from './types/meta-message.types';
import { MetaCloudIdentity } from './types/meta-response.types';

export class MetaCloudMessageAdapter {
  constructor(
    private readonly sendController: SendMessageController,
    private readonly chatController: ChatController,
    private readonly prisma: PrismaRepository,
    private readonly monitor: WAMonitoringService,
    private readonly mediaService: MetaCloudMediaService,
    private readonly responseSerializer: MetaCloudResponseSerializer,
  ) {}

  public async execute(identity: MetaCloudIdentity, payload: MetaCloudMessageRequest) {
    this.assertConnected(identity);
    if (payload.messaging_product && payload.messaging_product !== 'whatsapp') {
      throw new MetaCloudGraphError(400, 'messaging_product must be whatsapp.');
    }
    if (payload.status === 'read') return this.markRead(identity, payload.message_id);
    const to = this.normalizeRecipient(payload.to);
    if (!payload.type) throw new MetaCloudGraphError(400, 'Message type is required.');
    const instance = this.instanceDto(identity);
    let result: any;

    switch (payload.type) {
      case 'text':
        if (!payload.text?.body) throw new MetaCloudGraphError(400, 'text.body is required.');
        result = await this.sendController.sendText(instance, { number: to, text: payload.text.body });
        break;
      case 'image':
      case 'video': {
        const media = payload[payload.type];
        const url = await this.mediaService.resolveOutbound(media, identity);
        result = await this.sendController.sendMedia(instance, {
          number: to,
          mediatype: payload.type,
          media: url,
          mimetype: media?.mime_type,
          caption: media?.caption,
        });
        break;
      }
      case 'document': {
        const media = payload.document;
        const url = await this.mediaService.resolveOutbound(media, identity);
        result = await this.sendController.sendMedia(instance, {
          number: to,
          mediatype: 'document',
          media: url,
          mimetype: media?.mime_type,
          fileName: media?.filename,
          caption: media?.caption,
        });
        break;
      }
      case 'audio': {
        const media = payload.audio;
        const url = await this.mediaService.resolveOutbound(media, identity);
        result = await this.sendController.sendWhatsAppAudio(instance, { number: to, audio: url });
        break;
      }
      case 'location':
        if (payload.location?.latitude === undefined || payload.location?.longitude === undefined) {
          throw new MetaCloudGraphError(400, 'location.latitude and location.longitude are required.');
        }
        result = await this.sendController.sendLocation(instance, {
          number: to,
          latitude: Number(payload.location.latitude),
          longitude: Number(payload.location.longitude),
          name: payload.location.name,
          address: payload.location.address,
        });
        break;
      case 'contacts':
        result = await this.sendController.sendContact(instance, {
          number: to,
          contact: this.mapContacts(payload.contacts || []),
        });
        break;
      case 'reaction':
        if (!payload.reaction?.message_id || payload.reaction.emoji === undefined) {
          throw new MetaCloudGraphError(400, 'reaction.message_id and reaction.emoji are required.');
        }
        result = await this.sendController.sendReaction(instance, {
          key: { id: payload.reaction.message_id, remoteJid: `${to}@s.whatsapp.net`, fromMe: true },
          reaction: payload.reaction.emoji,
        });
        break;
      case 'interactive':
        result = await this.sendInteractive(instance, to, payload.interactive);
        break;
      case 'template': {
        const template = payload.template;
        if (!template?.name) throw new MetaCloudGraphError(400, 'template.name is required.');
        const language = template.language?.code || 'pt_BR';
        result = await this.sendController.sendTemplate(instance, {
          number: to,
          name: template.name,
          language,
          components: Array.isArray(template.components) ? template.components : [],
        });
        break;
      }
      default:
        throw new MetaCloudGraphError(400, `Message type ${String(payload.type)} is not supported by this provider.`);
    }
    return this.responseSerializer.messageResponse(to, result);
  }

  private async sendInteractive(instance: any, to: string, interactive: any) {
    if (interactive?.type === 'button') {
      const buttons = interactive?.action?.buttons || [];
      if (!buttons.length) throw new MetaCloudGraphError(400, 'interactive.action.buttons is required.');
      return this.sendController.sendButtons(instance, {
        number: to,
        title: interactive?.body?.text || interactive?.header?.text || 'WhatsApp',
        description: interactive?.header?.text,
        footer: interactive?.footer?.text,
        buttons: buttons.map((button: any) => ({
          type: 'reply' as const,
          id: button?.reply?.id,
          displayText: button?.reply?.title,
        })),
      });
    }
    if (interactive?.type === 'list') {
      const sections = interactive?.action?.sections || [];
      if (!sections.length) throw new MetaCloudGraphError(400, 'interactive.action.sections is required.');
      return this.sendController.sendList(instance, {
        number: to,
        title: interactive?.header?.text || interactive?.body?.text || 'WhatsApp',
        description: interactive?.body?.text,
        footerText: interactive?.footer?.text,
        buttonText: interactive?.action?.button || 'Opções',
        sections: sections.map((section: any) => ({
          title: section?.title || '',
          rows: (section?.rows || []).map((row: any) => ({
            title: row?.title || '',
            description: row?.description || '',
            rowId: row?.id || '',
          })),
        })),
      });
    }
    throw new MetaCloudGraphError(
      400,
      `Interactive type ${String(interactive?.type || '')} is not supported by this provider.`,
    );
  }

  private async markRead(identity: MetaCloudIdentity, messageId?: string) {
    if (!messageId) throw new MetaCloudGraphError(400, 'message_id is required for status=read.');
    const message = await this.prisma.message.findFirst({
      where: {
        instanceId: identity.instanceId,
        key: { path: prismaJsonPath('id'), equals: messageId } as any,
      },
    });
    if (!message) throw new MetaCloudGraphError(404, `Message ${messageId} was not found.`);
    const key: any = message.key;
    await this.chatController.readMessage(this.instanceDto(identity), {
      readMessages: [
        {
          id: messageId,
          remoteJid: key?.remoteJid,
          fromMe: Boolean(key?.fromMe),
        },
      ],
    });
    return { success: true };
  }

  private mapContacts(contacts: any[]) {
    if (!contacts.length) throw new MetaCloudGraphError(400, 'contacts must not be empty.');
    return contacts.map((contact) => {
      const phone = String(contact?.phones?.[0]?.phone || contact?.phones?.[0]?.wa_id || '').replace(/\D/g, '');
      const fullName =
        contact?.name?.formatted_name ||
        [contact?.name?.first_name, contact?.name?.last_name].filter(Boolean).join(' ') ||
        phone;
      if (!phone || !fullName) throw new MetaCloudGraphError(400, 'Each contact requires a name and phone.');
      return {
        fullName,
        wuid: phone,
        phoneNumber: phone,
        organization: contact?.org?.company,
        email: contact?.emails?.[0]?.email,
        url: contact?.urls?.[0]?.url,
      };
    });
  }

  private assertConnected(identity: MetaCloudIdentity) {
    const instance = this.monitor.waInstances[identity.instanceName];
    if (!instance || (instance.connectionStatus?.state && instance.connectionStatus.state !== 'open')) {
      throw new MetaCloudGraphError(409, `Instance ${identity.instanceName} is disconnected.`);
    }
  }

  private normalizeRecipient(to?: string) {
    const value = String(to || '').replace(/\D/g, '');
    if (!value) throw new MetaCloudGraphError(400, 'to is required.');
    return value;
  }

  private instanceDto(identity: MetaCloudIdentity): any {
    return {
      instanceName: identity.instanceName,
      instanceId: identity.instanceId,
      integration: identity.provider,
      number: identity.displayPhoneNumber,
      businessId: identity.businessAccountId,
      token: identity.token,
    };
  }
}
