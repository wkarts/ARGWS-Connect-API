import { SendMessageController } from '@api/controllers/sendMessage.controller';
import type { ChatController } from '@api/controllers/chat.controller';
import type { SendStatusDto } from '@api/dto/sendMessage.dto';
import { TranscriptionService } from '@api/services/transcription.service';
import { Logger } from '@config/logger.config';

import { MetaCloudGraphError } from './meta-cloud.error';
import { metaCloudMetrics } from './meta-cloud.metrics';
import { MetaCloudAuthService } from './meta-cloud-auth.service';
import { MetaCloudIdentityResolver } from './meta-cloud-identity.resolver';
import { MetaCloudMediaService } from './meta-cloud-media.service';
import { MetaCloudMessageAdapter } from './meta-cloud-message.adapter';
import { MetaCloudTemplateService } from './meta-cloud-template.service';
import {
  MetaCloudMessageRequest,
  MetaCloudStatusRequest,
  MetaCloudTranscriptionRequest,
} from './types/meta-message.types';
import { MetaCloudIdentity } from './types/meta-response.types';

export class MetaCloudGraphController {
  private readonly logger = new Logger('MetaCloudGraphController');

  constructor(
    private readonly resolver: MetaCloudIdentityResolver,
    private readonly auth: MetaCloudAuthService,
    private readonly adapter: MetaCloudMessageAdapter,
    private readonly media: MetaCloudMediaService,
    private readonly templates: MetaCloudTemplateService,
    private readonly sendController?: Pick<SendMessageController, 'sendStatus'>,
    private readonly transcription?: TranscriptionService,
    private readonly chatController?: Pick<ChatController, 'fetchMessages' | 'deleteMessage'>,
  ) {}

  public async send(version: string, phoneNumberId: string, authorization: any, payload: MetaCloudMessageRequest) {
    const identity = await this.resolvePhone(phoneNumberId, authorization);
    this.log(identity, version, payload?.status === 'read' ? 'mark-read' : `send-${payload?.type || 'unknown'}`);
    const result = await this.adapter.execute(identity, payload || {});
    if (payload?.status !== 'read') metaCloudMetrics.increment('connect_meta_compat_messages_sent_total');
    return result;
  }

  public async upload(version: string, phoneNumberId: string, authorization: any, file: any, type?: string) {
    const identity = await this.resolvePhone(phoneNumberId, authorization);
    this.log(identity, version, 'media-upload');
    return this.media.upload(identity, file, type);
  }

  public async publishStatus(
    version: string,
    phoneNumberId: string,
    authorization: any,
    payload: MetaCloudStatusRequest,
    file?: any,
  ) {
    const identity = await this.resolvePhone(phoneNumberId, authorization);
    this.assertStatusProvider(identity);
    if (!this.sendController) throw new MetaCloudGraphError(503, 'Status publication is temporarily unavailable.');
    if (payload?.messaging_product && payload.messaging_product !== 'whatsapp') {
      throw new MetaCloudGraphError(400, 'messaging_product must be whatsapp.');
    }
    const data = await this.statusData(identity, payload || {}, file);
    this.log(identity, version, 'status-publish');
    const result = await this.sendController.sendStatus(this.instanceDto(identity), data, file);
    metaCloudMetrics.increment('connect_meta_compat_status_published_total');
    return this.statusResponse(result);
  }

  public async listStatuses(
    version: string,
    phoneNumberId: string,
    authorization: any,
    query: { page?: unknown; limit?: unknown } = {},
  ) {
    const identity = await this.resolvePhone(phoneNumberId, authorization);
    this.assertStatusProvider(identity);
    const chat = this.chatController;
    if (!chat) throw new MetaCloudGraphError(503, 'Status history is temporarily unavailable.');

    const page = Math.min(Math.max(Number.parseInt(String(query.page || '1'), 10) || 1, 1), 10000);
    const limit = Math.min(Math.max(Number.parseInt(String(query.limit || '50'), 10) || 50, 1), 500);
    const result = await chat.fetchMessages(this.instanceDto(identity), {
      where: {
        key: { remoteJid: 'status@broadcast', fromMe: true },
        status: { not: 'DELETED' },
      },
      sort: 'desc',
      page,
      offset: limit,
    } as any);
    const records = Array.isArray(result?.messages?.records) ? result.messages.records : [];
    this.log(identity, version, 'status-list');
    return {
      messaging_product: 'whatsapp',
      data: records.map((message: any) => this.statusSummary(message)),
      paging: {
        total: Number(result?.messages?.total || 0),
        page,
        limit,
        pages: Number(result?.messages?.pages || 0),
      },
      connect_api: { target: 'status@broadcast' },
    };
  }

  public async deleteStatus(
    version: string,
    phoneNumberId: string,
    authorization: any,
    statusId: string,
  ) {
    const identity = await this.resolvePhone(phoneNumberId, authorization);
    this.assertStatusProvider(identity);
    const normalizedId = String(statusId || '').trim();
    if (!/^[A-Za-z0-9._:-]{1,128}$/.test(normalizedId)) {
      throw new MetaCloudGraphError(400, 'Invalid status identifier.');
    }
    const chat = this.chatController;
    if (!chat) throw new MetaCloudGraphError(503, 'Status deletion is temporarily unavailable.');
    await chat.deleteMessage(this.instanceDto(identity), {
      id: normalizedId,
      fromMe: true,
      remoteJid: 'status@broadcast',
    } as any);
    this.log(identity, version, 'status-delete', normalizedId);
    return {
      messaging_product: 'whatsapp',
      id: normalizedId,
      deleted: true,
      connect_api: { target: 'status@broadcast' },
    };
  }

  public async transcribe(
    version: string,
    phoneNumberId: string,
    authorization: any,
    payload: MetaCloudTranscriptionRequest,
    file?: any,
  ) {
    const identity = await this.resolvePhone(phoneNumberId, authorization);
    if (!this.transcription) throw new MetaCloudGraphError(503, 'Transcription is temporarily unavailable.');
    if (payload?.messaging_product && payload.messaging_product !== 'whatsapp') {
      throw new MetaCloudGraphError(400, 'messaging_product must be whatsapp.');
    }
    const body = payload || {};
    const job = file?.buffer?.length
      ? await this.transcription.enqueueUpload({
          instanceId: identity.instanceId,
          buffer: file.buffer,
          fileName: file.originalname,
          mimeType: file.mimetype,
          language: body.language,
          model: body.model,
        })
      : await this.transcription.enqueue({
          instanceId: identity.instanceId,
          messageId: body.message_id,
          language: body.language,
          model: body.model,
        });
    this.log(identity, version, 'transcription-request', job.id);
    metaCloudMetrics.increment('connect_meta_compat_transcription_requests_total');
    return {
      messaging_product: 'whatsapp',
      id: job.id,
      status: job.status,
      transcription: job,
      connect_api: { operation: 'transcription', source: file?.buffer?.length ? 'upload' : 'message' },
    };
  }

  public async getTranscription(version: string, phoneNumberId: string, authorization: any, jobId: string) {
    const identity = await this.resolvePhone(phoneNumberId, authorization);
    if (!this.transcription) throw new MetaCloudGraphError(503, 'Transcription is temporarily unavailable.');
    const job = await this.transcription.get(jobId, identity.instanceId);
    this.log(identity, version, 'transcription-read', job.id);
    return job;
  }

  public async retryTranscription(version: string, phoneNumberId: string, authorization: any, jobId: string) {
    const identity = await this.resolvePhone(phoneNumberId, authorization);
    if (!this.transcription) throw new MetaCloudGraphError(503, 'Transcription is temporarily unavailable.');
    const job = await this.transcription.retry(jobId, identity.instanceId);
    this.log(identity, version, 'transcription-retry', job.id);
    metaCloudMetrics.increment('connect_meta_compat_transcription_requests_total');
    return job;
  }

  public async deleteTranscription(version: string, phoneNumberId: string, authorization: any, jobId: string) {
    const identity = await this.resolvePhone(phoneNumberId, authorization);
    if (!this.transcription) throw new MetaCloudGraphError(503, 'Transcription is temporarily unavailable.');
    const result = await this.transcription.delete(jobId, identity.instanceId);
    this.log(identity, version, 'transcription-delete', result.id);
    metaCloudMetrics.increment('connect_meta_compat_transcription_requests_total');
    return {
      messaging_product: 'whatsapp',
      id: result.id,
      deleted: true,
      cancelled: result.cancelled,
      source_removed: result.sourceRemoved,
      source_retained: result.sourceRetained,
    };
  }

  public async getMedia(version: string, mediaId: string, authorization: any) {
    const located = await this.media.locate(mediaId);
    const identity = this.resolver.identityFromInstance(located.instance);
    this.auth.assertAuthorized(identity, authorization);
    this.log(identity, version, 'media-get', mediaId);
    return this.media.describe(located, version);
  }

  public async downloadMedia(mediaId: string, token?: string) {
    return this.media.openPublicDownload(mediaId, token);
  }

  public async listTemplates(
    version: string,
    businessAccountId: string,
    authorization: any,
    query: { after?: unknown; limit?: unknown } = {},
  ) {
    const identity = await this.resolver.resolveByBusinessAccountId(
      businessAccountId,
      this.auth.extractBearer(authorization),
    );
    this.auth.assertAuthorized(identity, authorization);
    this.log(identity, version, 'templates-list');
    return this.templates.list(identity, query);
  }

  private async resolvePhone(phoneNumberId: string, authorization: any) {
    const identity = await this.resolver.resolveByPhoneNumberId(phoneNumberId, this.auth.extractBearer(authorization));
    this.auth.assertAuthorized(identity, authorization);
    return identity;
  }

  private assertStatusProvider(identity: MetaCloudIdentity) {
    if (!['WHATSAPP-BAILEYS', 'WHATSAPP-ZAPO'].includes(identity.provider)) {
      throw new MetaCloudGraphError(409, 'Status publication is not available for this WhatsApp provider.');
    }
  }

  private async statusData(
    identity: MetaCloudIdentity,
    payload: MetaCloudStatusRequest,
    file?: any,
  ): Promise<SendStatusDto> {
    const type = String(payload.type || '')
      .trim()
      .toLowerCase() as MetaCloudStatusRequest['type'];
    if (!['text', 'image', 'video', 'audio'].includes(type)) {
      throw new MetaCloudGraphError(400, 'type must be text, image, video or audio.');
    }

    const allContacts = this.booleanValue(payload.all_contacts);
    const recipients = this.statusRecipients(payload.status_jid_list);
    if (!allContacts && !recipients.length) {
      throw new MetaCloudGraphError(400, 'Provide all_contacts=true or status_jid_list with at least one number.');
    }

    const nested = type === 'text' ? payload.text : payload[type];
    let content = String(payload.content || '').trim();
    let caption = String(payload.caption || '').trim() || undefined;
    if (type === 'text') {
      content = String(payload.text?.body || content).trim();
    } else if (file?.buffer?.length) {
      // The native provider reads the binary from `file`; this non-empty value
      // only satisfies the shared DTO contract before the provider replaces it.
      content = content || 'uploaded';
      caption = caption || (nested as any)?.caption || undefined;
    } else {
      const media = nested as { link?: string; id?: string; caption?: string } | undefined;
      content = await this.media.resolveOutbound(media, identity);
      caption = caption || media?.caption || undefined;
    }
    if (!content) throw new MetaCloudGraphError(400, 'Status content is required.');

    const backgroundColor = String(payload.background_color || payload.text?.background_color || '#FFFFFF').trim();
    const fontValue = Number(payload.font ?? payload.text?.font ?? 1);
    const font = Number.isInteger(fontValue) && fontValue >= 0 && fontValue <= 5 ? fontValue : 1;
    return {
      number: identity.displayPhoneNumber,
      type,
      content,
      caption,
      backgroundColor,
      font,
      allContacts,
      statusJidList: recipients.length ? recipients : undefined,
    };
  }

  private statusRecipients(value: unknown): string[] {
    let parsed: unknown = value;
    if (typeof parsed === 'string') {
      const text = parsed.trim();
      if (!text) return [];
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text.split(/[\s,;\n]+/u);
      }
    }
    const values = Array.isArray(parsed) ? parsed : parsed ? [parsed] : [];
    return [...new Set(values.map((item) => String(item).split('@', 1)[0].replace(/\D/g, '')))].filter((item) =>
      /^\d{8,15}$/u.test(item),
    );
  }

  private booleanValue(value: unknown): boolean {
    if (value === true) return true;
    if (typeof value === 'string') return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
    return false;
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

  private statusResponse(providerResult: any) {
    const id =
      providerResult?.key?.id ??
      providerResult?.id ??
      providerResult?.message?.key?.id ??
      providerResult?.data?.key?.id;
    if (!id) throw new MetaCloudGraphError(500, 'Provider did not return a status identifier.');
    return {
      messaging_product: 'whatsapp',
      status: 'published',
      messages: [{ id: String(id) }],
      connect_api: { target: 'status@broadcast' },
    };
  }

  private statusSummary(message: any) {
    const key = message?.key && typeof message.key === 'object' ? message.key : {};
    const body = message?.message && typeof message.message === 'object' ? message.message : {};
    const text =
      body?.conversation ||
      body?.extendedTextMessage?.text ||
      body?.status?.extendedTextMessage?.text ||
      body?.status?.conversation ||
      body?.status?.content?.extendedTextMessage?.text ||
      body?.status?.content?.conversation ||
      body?.status?.content?.text ||
      body?.status?.content?.caption ||
      body?.status?.status?.content?.text ||
      body?.status?.status?.content?.caption ||
      body?.status?.text ||
      body?.status?.image?.caption ||
      body?.status?.video?.caption ||
      body?.imageMessage?.caption ||
      body?.videoMessage?.caption ||
      body?.audioMessage?.caption ||
      null;
    const timestamp = Number(message?.messageTimestamp);
    return {
      id: String(key.id || message?.id || ''),
      type: String(message?.messageType || 'status'),
      text: text ? String(text).slice(0, 10_000) : null,
      timestamp: Number.isFinite(timestamp) && timestamp > 0 ? new Date(timestamp * 1000).toISOString() : null,
      from_me: key.fromMe === true,
      remote_jid: String(key.remoteJid || 'status@broadcast'),
    };
  }

  private log(identity: MetaCloudIdentity, graphVersion: string, operation: string, messageId?: string) {
    this.logger.log({
      metaCompatibility: true,
      graphVersion,
      instanceId: identity.instanceId,
      instanceName: identity.instanceName,
      provider: identity.provider,
      phoneNumberId: identity.phoneNumberId,
      messageId,
      operation,
    });
  }
}
