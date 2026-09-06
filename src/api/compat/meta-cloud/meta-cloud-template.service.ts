import { TemplateController } from '@api/controllers/template.controller';

import { MetaCloudGraphError } from './meta-cloud.error';
import { MetaCloudIdentity } from './types/meta-response.types';

export class MetaCloudTemplateService {
  constructor(private readonly templateController: TemplateController) {}

  public async list(identity: MetaCloudIdentity) {
    if (identity.provider === 'WHATSAPP-BUSINESS') {
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
    if (identity.provider === 'WHATSAPP-BAILEYS' || identity.provider === 'CONNECT') return { data: [] };
    throw new MetaCloudGraphError(400, `Templates are not supported by provider ${identity.provider}.`);
  }
}
