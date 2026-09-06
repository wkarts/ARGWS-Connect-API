import { PrismaRepository } from '@api/repository/repository.service';
import { configService } from '@config/env.config';

import { MetaCloudGraphError } from './meta-cloud.error';
import { MetaCloudIdentityResolver } from './meta-cloud-identity.resolver';

export class MetaCloudController {
  constructor(
    private readonly prisma: PrismaRepository,
    private readonly identityResolver: MetaCloudIdentityResolver,
  ) {}

  public async getCompatibility(instanceName: string) {
    const identity = await this.identityResolver.resolveByInstanceName(instanceName);
    const config = await this.prisma.metaCompatibility.findUnique({ where: { instanceId: identity.instanceId } });
    return this.serializeConfig(identity, config);
  }

  public async setCompatibility(instanceName: string, data: { enabled?: boolean; webhookUrl?: string | null }) {
    const identity = await this.identityResolver.resolveByInstanceName(instanceName);
    if (data.webhookUrl && !/^https?:\/\//i.test(data.webhookUrl)) {
      throw new MetaCloudGraphError(400, 'webhookUrl must be an absolute HTTP(S) URL.');
    }

    const current = await this.prisma.metaCompatibility.findUnique({ where: { instanceId: identity.instanceId } });
    const config = await this.prisma.metaCompatibility.upsert({
      where: { instanceId: identity.instanceId },
      create: {
        instanceId: identity.instanceId,
        enabled: true,
        webhookUrl: data.webhookUrl ?? null,
      },
      update: {
        enabled: true,
        webhookUrl: data.webhookUrl === undefined ? (current?.webhookUrl ?? null) : data.webhookUrl,
      },
    });
    return this.serializeConfig(identity, config);
  }

  private serializeConfig(identity: any, config: any) {
    const serverUrl = String(configService.get<any>('SERVER')?.URL || '').replace(/\/$/, '');
    return {
      // Kept for wire compatibility. Meta Compatible is always available for addressable instances.
      enabled: true,
      instanceName: identity.instanceName,
      provider: identity.provider,
      phoneNumberId: identity.phoneNumberId,
      businessAccountId: identity.businessAccountId,
      displayPhoneNumber: identity.displayPhoneNumber,
      graphUrl: `${serverUrl}/graph`,
      webhookUrl: config?.webhookUrl ?? null,
    };
  }
}
