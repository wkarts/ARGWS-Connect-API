import { Logger } from '@config/logger.config';

import { metaCloudMetrics } from './meta-cloud.metrics';
import { MetaCloudAuthService } from './meta-cloud-auth.service';
import { MetaCloudIdentityResolver } from './meta-cloud-identity.resolver';
import { MetaCloudMediaService } from './meta-cloud-media.service';
import { MetaCloudMessageAdapter } from './meta-cloud-message.adapter';
import { MetaCloudPolicyService } from './meta-cloud-policy.service';
import { MetaCloudTemplateService } from './meta-cloud-template.service';
import { MetaCloudMessageRequest } from './types/meta-message.types';
import { MetaCloudIdentity } from './types/meta-response.types';

export class MetaCloudGraphController {
  private readonly logger = new Logger('MetaCloudGraphController');

  constructor(
    private readonly resolver: MetaCloudIdentityResolver,
    private readonly auth: MetaCloudAuthService,
    private readonly adapter: MetaCloudMessageAdapter,
    private readonly media: MetaCloudMediaService,
    private readonly templates: MetaCloudTemplateService,
    private readonly policy: MetaCloudPolicyService,
  ) {}

  public async send(version: string, phoneNumberId: string, authorization: any, payload: MetaCloudMessageRequest) {
    const identity = await this.resolvePhone(phoneNumberId, authorization);
    this.log(identity, version, payload?.status === 'read' ? 'mark-read' : `send-${payload?.type || 'unknown'}`);
    if (payload?.status !== 'read' && payload?.to) {
      await this.policy.assertOutbound(identity, String(payload.to), String(payload.type || ''));
    }
    const result = await this.adapter.execute(identity, payload || {});
    if (payload?.status !== 'read') {
      metaCloudMetrics.increment('connect_meta_compat_messages_sent_total');
      if (payload?.to) await this.policy.recordOutbound(identity.instanceId, String(payload.to));
    }
    return result;
  }

  public async upload(version: string, phoneNumberId: string, authorization: any, file: any, type?: string) {
    const identity = await this.resolvePhone(phoneNumberId, authorization);
    this.log(identity, version, 'media-upload');
    return this.media.upload(identity, file, type);
  }

  public async getMedia(version: string, mediaId: string, authorization: any) {
    const located = await this.media.locate(mediaId);
    const identity = this.resolver.identityFromInstance(located.instance);
    this.auth.assertAuthorized(identity, authorization);
    this.log(identity, version, 'media-get', mediaId);
    return this.media.describe(located);
  }

  public async listTemplates(version: string, businessAccountId: string, authorization: any) {
    const identity = await this.resolver.resolveByBusinessAccountId(businessAccountId);
    this.auth.assertAuthorized(identity, authorization);
    this.log(identity, version, 'templates-list');
    return this.templates.list(identity);
  }

  private async resolvePhone(phoneNumberId: string, authorization: any) {
    const identity = await this.resolver.resolveByPhoneNumberId(phoneNumberId);
    this.auth.assertAuthorized(identity, authorization);
    return identity;
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
