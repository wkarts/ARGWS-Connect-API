import { TemplateController } from '@api/controllers/template.controller';

import { MetaCloudGraphError } from './meta-cloud.error';
import { MetaCloudIdentity } from './types/meta-response.types';

export class MetaCloudTemplateService {
  constructor(private readonly templateController: TemplateController) {}

  public async list(identity: MetaCloudIdentity) {
    if (!['WHATSAPP-BUSINESS', 'WHATSAPP-BAILEYS', 'CONNECT'].includes(identity.provider)) {
      throw new MetaCloudGraphError(400, `Templates are not supported by provider ${identity.provider}.`);
    }

    const result = await this.templateController.findTemplate({
      instanceName: identity.instanceName,
      instanceId: identity.instanceId,
      integration: identity.provider,
      businessId: identity.businessAccountId,
      token: identity.token,
    });

    if (result && typeof result === 'object' && 'data' in result) return result;
    return { data: Array.isArray(result) ? result : result ? [result] : [] };
  }
}
