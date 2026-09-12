import { TemplateController } from '@api/controllers/template.controller';
import { isLocalTemplateProvider } from '@api/services/local-template.definition';
import { LocalTemplateService } from '@api/services/local-template.service';

import { MetaCloudGraphError } from './meta-cloud.error';
import { MetaCloudIdentity } from './types/meta-response.types';

export class MetaCloudTemplateService {
  constructor(
    private readonly templateController: TemplateController,
    private readonly localTemplates?: LocalTemplateService,
  ) {}

  public async list(identity: MetaCloudIdentity, query: { after?: unknown; limit?: unknown } = {}) {
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
    if (isLocalTemplateProvider(identity.provider)) {
      if (!this.localTemplates) throw new MetaCloudGraphError(503, 'Local template catalog is unavailable.');
      return this.localTemplates.list(identity.instanceName, query);
    }
    throw new MetaCloudGraphError(400, `Templates are not supported by provider ${identity.provider}.`);
  }
}
