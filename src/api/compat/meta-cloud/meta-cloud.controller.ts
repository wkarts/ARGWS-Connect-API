import { PrismaRepository } from '@api/repository/repository.service';
import { configService } from '@config/env.config';

import { MetaCloudGraphError } from './meta-cloud.error';
import { MetaCloudIdentityResolver } from './meta-cloud-identity.resolver';
import { MetaCloudPolicyService, MetaPolicyMode } from './meta-cloud-policy.service';

export class MetaCloudController {
  constructor(
    private readonly prisma: PrismaRepository,
    private readonly identityResolver: MetaCloudIdentityResolver,
    private readonly policy: MetaCloudPolicyService,
  ) {}

  public async getCompatibility(instanceName: string) {
    const identity = await this.identityResolver.resolveByInstanceName(instanceName);
    const config = await this.prisma.metaCompatibility.findUnique({ where: { instanceId: identity.instanceId } });
    return this.serializeConfig(identity, config);
  }

  public async setCompatibility(
    instanceName: string,
    data: {
      enabled?: boolean;
      webhookUrl?: string | null;
      policyMode?: MetaPolicyMode;
      windowSeconds?: number;
      templateRequiredOutsideWindow?: boolean;
    },
  ) {
    const identity = await this.identityResolver.resolveByInstanceName(instanceName);
    if (data.webhookUrl && !/^https?:\/\//i.test(data.webhookUrl)) {
      throw new MetaCloudGraphError(400, 'webhookUrl must be an absolute HTTP(S) URL.');
    }

    const current = await this.prisma.metaCompatibility.findUnique({ where: { instanceId: identity.instanceId } });
    const policyMode = data.policyMode === undefined ? undefined : this.policy.normalizeMode(data.policyMode);
    const windowSeconds =
      data.windowSeconds === undefined ? undefined : this.policy.normalizeWindowSeconds(data.windowSeconds);
    const config = await this.prisma.metaCompatibility.upsert({
      where: { instanceId: identity.instanceId },
      create: {
        instanceId: identity.instanceId,
        enabled: true,
        webhookUrl: data.webhookUrl ?? null,
        policyMode: policyMode ?? 'PERMISSIVE',
        windowSeconds: windowSeconds ?? 86400,
        templateRequiredOutsideWindow: data.templateRequiredOutsideWindow ?? true,
      },
      update: {
        enabled: true,
        webhookUrl: data.webhookUrl === undefined ? (current?.webhookUrl ?? null) : data.webhookUrl,
        ...(policyMode === undefined ? {} : { policyMode }),
        ...(windowSeconds === undefined ? {} : { windowSeconds }),
        ...(data.templateRequiredOutsideWindow === undefined
          ? {}
          : { templateRequiredOutsideWindow: data.templateRequiredOutsideWindow }),
      },
    });
    return this.serializeConfig(identity, config);
  }

  public async inspectWindow(instanceName: string, recipient: string) {
    const identity = await this.identityResolver.resolveByInstanceName(instanceName);
    return this.policy.inspect(identity.instanceId, recipient);
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
      policy: {
        mode: this.policy.normalizeMode(config?.policyMode),
        windowSeconds: this.policy.normalizeWindowSeconds(config?.windowSeconds),
        templateRequiredOutsideWindow: config?.templateRequiredOutsideWindow !== false,
      },
    };
  }
}
