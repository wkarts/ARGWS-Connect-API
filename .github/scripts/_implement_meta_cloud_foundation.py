from pathlib import Path
import json

ROOT = Path('.')

def write(path: str, content: str):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(content.strip() + '\n', encoding='utf-8')


def patch_once(path: str, old: str, new: str):
    p = ROOT / path
    text = p.read_text(encoding='utf-8')
    if new in text:
        return
    if old not in text:
        raise RuntimeError(f'Patch anchor not found in {path}: {old!r}')
    p.write_text(text.replace(old, new, 1), encoding='utf-8')

# Prisma: additive relation/model only. No provider enum changes.
for schema in ['prisma/postgresql-schema.prisma', 'prisma/psql_bouncer-schema.prisma', 'prisma/mysql-schema.prisma']:
    patch_once(schema, '  Webhook                 Webhook?\n', '  Webhook                 Webhook?\n  MetaCompatibility       MetaCompatibility?\n')
    p = ROOT / schema
    text = p.read_text(encoding='utf-8')
    if 'model MetaCompatibility {' not in text:
        timestamp_type = '@db.Timestamp' if 'provider = "mysql"' in text else '@db.Timestamp'
        model = f'''\nmodel MetaCompatibility {{
  id         String   @id @default(cuid())
  enabled    Boolean  @default(false) @db.Boolean
  webhookUrl String?  @db.VarChar(500)
  createdAt  DateTime @default(now()) {timestamp_type}
  updatedAt  DateTime @updatedAt {timestamp_type}
  instanceId String   @unique
  Instance   Instance @relation(fields: [instanceId], references: [id], onDelete: Cascade)

  @@index([instanceId])
}}
'''
        p.write_text(text.rstrip() + '\n' + model, encoding='utf-8')

write('prisma/postgresql-migrations/20260901070000_add_meta_compatibility/migration.sql', r'''
CREATE TABLE "MetaCompatibility" (
    "id" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "webhookUrl" VARCHAR(500),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "instanceId" TEXT NOT NULL,
    CONSTRAINT "MetaCompatibility_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "MetaCompatibility_instanceId_key" ON "MetaCompatibility"("instanceId");
CREATE INDEX "MetaCompatibility_instanceId_idx" ON "MetaCompatibility"("instanceId");
ALTER TABLE "MetaCompatibility" ADD CONSTRAINT "MetaCompatibility_instanceId_fkey"
FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
''')

write('prisma/mysql-migrations/20260901070000_add_meta_compatibility/migration.sql', r'''
CREATE TABLE `MetaCompatibility` (
    `id` VARCHAR(191) NOT NULL,
    `enabled` BOOLEAN NOT NULL DEFAULT false,
    `webhookUrl` VARCHAR(500) NULL,
    `createdAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    `updatedAt` TIMESTAMP(3) NOT NULL,
    `instanceId` VARCHAR(191) NOT NULL,
    UNIQUE INDEX `MetaCompatibility_instanceId_key`(`instanceId`),
    INDEX `MetaCompatibility_instanceId_idx`(`instanceId`),
    PRIMARY KEY (`id`),
    CONSTRAINT `MetaCompatibility_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
''')

write('src/api/compat/meta-cloud/types/meta-response.types.ts', r'''
export interface MetaCloudIdentity {
  instanceId: string;
  instanceName: string;
  provider: string;
  phoneNumberId: string;
  businessAccountId: string;
  displayPhoneNumber: string;
  token?: string;
  instance: any;
}

export interface MetaGraphErrorBody {
  error: {
    message: string;
    type: string;
    code: number;
  };
}
''')

write('src/api/compat/meta-cloud/meta-cloud.error.ts', r'''
import { MetaGraphErrorBody } from './types/meta-response.types';

export class MetaCloudGraphError extends Error {
  constructor(
    public readonly httpStatus: number,
    message: string,
    public readonly graphCode = 100,
    public readonly graphType = 'GraphMethodException',
  ) {
    super(message);
    this.name = 'MetaCloudGraphError';
  }

  public toBody(): MetaGraphErrorBody {
    return {
      error: {
        message: this.message,
        type: this.graphType,
        code: this.graphCode,
      },
    };
  }
}

export const invalidOAuthToken = () =>
  new MetaCloudGraphError(401, 'Invalid OAuth access token.', 190, 'OAuthException');
''')

write('src/api/compat/meta-cloud/meta-cloud-identity.resolver.ts', r'''
import { PrismaRepository } from '@api/repository/repository.service';

import { MetaCloudGraphError } from './meta-cloud.error';
import { MetaCloudIdentity } from './types/meta-response.types';

export class MetaCloudIdentityResolver {
  constructor(private readonly prisma: PrismaRepository) {}

  public normalizePhone(value?: string | null): string | null {
    if (!value) return null;
    const withoutJid = String(value).split('@', 1)[0];
    const digits = withoutJid.replace(/\D/g, '');
    return digits.length >= 8 ? digits : null;
  }

  public identityFromInstance(instance: any): MetaCloudIdentity {
    const provider = String(instance?.integration || '');
    let phoneNumberId: string | null = null;
    let businessAccountId: string | null = null;
    let displayPhoneNumber: string | null = null;

    if (provider === 'WHATSAPP-BUSINESS') {
      phoneNumberId = this.normalizePhone(instance?.number) || String(instance?.number || '') || null;
      businessAccountId = instance?.businessId ? String(instance.businessId) : null;
      displayPhoneNumber = this.normalizePhone(instance?.number) || phoneNumberId;
    } else if (provider === 'WHATSAPP-BAILEYS' || provider === 'CONNECT') {
      const stablePhone = this.normalizePhone(instance?.number) || this.normalizePhone(instance?.ownerJid);
      phoneNumberId = stablePhone;
      businessAccountId = stablePhone;
      displayPhoneNumber = stablePhone;
    }

    if (!phoneNumberId || !businessAccountId || !displayPhoneNumber) {
      throw new MetaCloudGraphError(
        400,
        `Meta Cloud compatibility requires a stable phone identity for instance ${instance?.name || 'unknown'}.`,
      );
    }

    return {
      instanceId: String(instance.id),
      instanceName: String(instance.name),
      provider,
      phoneNumberId,
      businessAccountId,
      displayPhoneNumber,
      token: instance?.token || undefined,
      instance,
    };
  }

  public async resolveByInstanceName(instanceName: string): Promise<MetaCloudIdentity> {
    const instance = await this.prisma.instance.findUnique({ where: { name: instanceName } });
    if (!instance) throw new MetaCloudGraphError(404, `Instance ${instanceName} was not found.`);
    return this.identityFromInstance(instance);
  }

  public async resolveByPhoneNumberId(phoneNumberId: string): Promise<MetaCloudIdentity> {
    const target = this.normalizePhone(phoneNumberId);
    if (!target) throw new MetaCloudGraphError(404, 'phoneNumberId was not found.');

    const instances = await this.prisma.instance.findMany({
      where: { integration: { in: ['WHATSAPP-BUSINESS', 'WHATSAPP-BAILEYS', 'CONNECT'] } },
    });

    for (const instance of instances) {
      try {
        const identity = this.identityFromInstance(instance);
        if (identity.phoneNumberId === target || String(identity.phoneNumberId) === String(phoneNumberId)) return identity;
      } catch {
        // Instances without a stable identity are not Graph-addressable.
      }
    }
    throw new MetaCloudGraphError(404, `phoneNumberId ${phoneNumberId} was not found.`);
  }

  public async resolveByBusinessAccountId(businessAccountId: string): Promise<MetaCloudIdentity> {
    const instances = await this.prisma.instance.findMany({
      where: { integration: { in: ['WHATSAPP-BUSINESS', 'WHATSAPP-BAILEYS', 'CONNECT'] } },
    });
    for (const instance of instances) {
      try {
        const identity = this.identityFromInstance(instance);
        if (identity.businessAccountId === businessAccountId) return identity;
      } catch {
        // Ignore non-addressable instances.
      }
    }
    throw new MetaCloudGraphError(404, `businessAccountId ${businessAccountId} was not found.`);
  }
}
''')

write('src/api/compat/meta-cloud/meta-cloud-auth.service.ts', r'''
import { timingSafeEqual } from 'crypto';

import { invalidOAuthToken } from './meta-cloud.error';
import { MetaCloudIdentity } from './types/meta-response.types';

export class MetaCloudAuthService {
  public extractBearer(authorization?: string | string[]): string | null {
    const value = Array.isArray(authorization) ? authorization[0] : authorization;
    if (!value || !/^Bearer\s+/i.test(value)) return null;
    const token = value.replace(/^Bearer\s+/i, '').trim();
    return token || null;
  }

  public assertAuthorized(identity: MetaCloudIdentity, authorization?: string | string[]): void {
    const provided = this.extractBearer(authorization);
    const expected = identity.token;
    if (!provided || !expected || !this.safeEqual(provided, expected)) throw invalidOAuthToken();
  }

  private safeEqual(left: string, right: string): boolean {
    const a = Buffer.from(left);
    const b = Buffer.from(right);
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }
}
''')

write('src/api/compat/meta-cloud/meta-cloud-status.mapper.ts', r'''
export type MetaCloudStatus = 'sent' | 'delivered' | 'read' | 'failed' | 'deleted';

export class MetaCloudStatusMapper {
  public map(status?: string | number | null): MetaCloudStatus | null {
    const value = String(status ?? '').toUpperCase();
    switch (value) {
      case '2':
      case 'SERVER_ACK':
        return 'sent';
      case '3':
      case 'DELIVERY_ACK':
        return 'delivered';
      case '4':
      case 'READ':
      case '5':
      case 'PLAYED':
        return 'read';
      case '0':
      case 'ERROR':
        return 'failed';
      case 'DELETED':
        return 'deleted';
      case '1':
      case 'PENDING':
      case '':
        return null;
      default:
        return null;
    }
  }
}
''')

write('src/api/compat/meta-cloud/meta-cloud.metrics.ts', r'''
type MetricName =
  | 'connect_meta_compat_requests_total'
  | 'connect_meta_compat_messages_sent_total'
  | 'connect_meta_compat_webhooks_total'
  | 'connect_meta_compat_webhook_failures_total'
  | 'connect_meta_compat_media_requests_total';

const names: MetricName[] = [
  'connect_meta_compat_requests_total',
  'connect_meta_compat_messages_sent_total',
  'connect_meta_compat_webhooks_total',
  'connect_meta_compat_webhook_failures_total',
  'connect_meta_compat_media_requests_total',
];

class MetaCloudMetrics {
  private readonly counters = new Map<MetricName, number>(names.map((name) => [name, 0]));

  public increment(name: MetricName, amount = 1): void {
    this.counters.set(name, (this.counters.get(name) || 0) + amount);
  }

  public prometheusLines(): string[] {
    return names.flatMap((name) => [
      `# TYPE ${name} counter`,
      `${name} ${this.counters.get(name) || 0}`,
    ]);
  }
}

export const metaCloudMetrics = new MetaCloudMetrics();
''')

write('src/api/compat/meta-cloud/meta-cloud.controller.ts', r'''
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
    if (data.enabled === true && !identity.phoneNumberId) {
      throw new MetaCloudGraphError(400, 'Meta Cloud compatibility cannot be enabled without a stable phone identity.');
    }
    if (data.webhookUrl && !/^https?:\/\//i.test(data.webhookUrl)) {
      throw new MetaCloudGraphError(400, 'webhookUrl must be an absolute HTTP(S) URL.');
    }

    const current = await this.prisma.metaCompatibility.findUnique({ where: { instanceId: identity.instanceId } });
    const config = await this.prisma.metaCompatibility.upsert({
      where: { instanceId: identity.instanceId },
      create: {
        instanceId: identity.instanceId,
        enabled: data.enabled ?? false,
        webhookUrl: data.webhookUrl ?? null,
      },
      update: {
        enabled: data.enabled ?? current?.enabled ?? false,
        webhookUrl: data.webhookUrl === undefined ? current?.webhookUrl ?? null : data.webhookUrl,
      },
    });
    return this.serializeConfig(identity, config);
  }

  private serializeConfig(identity: any, config: any) {
    const serverUrl = String(configService.get<any>('SERVER')?.URL || '').replace(/\/$/, '');
    return {
      enabled: Boolean(config?.enabled),
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
''')

write('src/api/compat/meta-cloud/meta-cloud.router.ts', r'''
import { authGuard } from '@api/guards/auth.guard';
import { instanceExistsGuard, instanceLoggedGuard } from '@api/guards/instance.guard';
import { metaCloudController } from '@api/server.module';
import { NextFunction, Request, Response, Router } from 'express';

import { MetaCloudGraphError } from './meta-cloud.error';

export class MetaCloudAdminRouter {
  public readonly router = Router();

  constructor() {
    const guards = [instanceExistsGuard, instanceLoggedGuard, authGuard['apikey']];
    this.router.get('/:instanceName', ...guards, this.wrap(async (req, res) => {
      res.json(await metaCloudController.getCompatibility(req.params.instanceName));
    }));
    this.router.put('/:instanceName', ...guards, this.wrap(async (req, res) => {
      res.json(await metaCloudController.setCompatibility(req.params.instanceName, req.body || {}));
    }));
  }

  private wrap(handler: (req: Request, res: Response) => Promise<void | Response>) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        await handler(req, res);
      } catch (error) {
        if (error instanceof MetaCloudGraphError) return res.status(error.httpStatus).json(error.toBody());
        return next(error);
      }
    };
  }
}
''')

# Wire foundation into module/routes/metrics.
patch_once(
    'src/api/server.module.ts',
    "import { BusinessController } from './controllers/business.controller';\n",
    "import { MetaCloudController } from './compat/meta-cloud/meta-cloud.controller';\nimport { MetaCloudAuthService } from './compat/meta-cloud/meta-cloud-auth.service';\nimport { MetaCloudIdentityResolver } from './compat/meta-cloud/meta-cloud-identity.resolver';\nimport { BusinessController } from './controllers/business.controller';\n",
)
patch_once(
    'src/api/server.module.ts',
    'export const prismaRepository = new PrismaRepository(configService);\n',
    'export const prismaRepository = new PrismaRepository(configService);\nexport const metaCloudIdentityResolver = new MetaCloudIdentityResolver(prismaRepository);\nexport const metaCloudAuthService = new MetaCloudAuthService();\nexport const metaCloudController = new MetaCloudController(prismaRepository, metaCloudIdentityResolver);\n',
)
patch_once(
    'src/api/routes/index.router.ts',
    "import { authGuard } from '@api/guards/auth.guard';\n",
    "import { MetaCloudAdminRouter } from '@api/compat/meta-cloud/meta-cloud.router';\nimport { metaCloudMetrics } from '@api/compat/meta-cloud/meta-cloud.metrics';\nimport { authGuard } from '@api/guards/auth.guard';\n",
)
patch_once(
    'src/api/routes/index.router.ts',
    "    res.send(lines.join('\\n') + '\\n');\n",
    "    lines.push(...metaCloudMetrics.prometheusLines());\n    res.send(lines.join('\\n') + '\\n');\n",
)
patch_once(
    'src/api/routes/index.router.ts',
    "  .use('/instance', new InstanceRouter(configService, ...guards).router)\n",
    "  .use('/compat/meta', new MetaCloudAdminRouter().router)\n  .use('/instance', new InstanceRouter(configService, ...guards).router)\n",
)

write('test/meta-cloud/foundation.test.ts', r'''
import assert from 'node:assert/strict';

import { MetaCloudAuthService } from '../../src/api/compat/meta-cloud/meta-cloud-auth.service';
import { MetaCloudIdentityResolver } from '../../src/api/compat/meta-cloud/meta-cloud-identity.resolver';
import { MetaCloudStatusMapper } from '../../src/api/compat/meta-cloud/meta-cloud-status.mapper';

const resolver = new MetaCloudIdentityResolver({} as any);
const baileys = resolver.identityFromInstance({
  id: 'i1', name: 'cliente01', integration: 'WHATSAPP-BAILEYS', number: '55 (75) 99999-9999', token: 'secret',
});
assert.equal(baileys.phoneNumberId, '5575999999999');
assert.equal(baileys.businessAccountId, '5575999999999');

const fallback = resolver.identityFromInstance({
  id: 'i2', name: 'cliente02', integration: 'WHATSAPP-BAILEYS', ownerJid: '5575888888888@s.whatsapp.net', token: 'secret',
});
assert.equal(fallback.phoneNumberId, '5575888888888');

const business = resolver.identityFromInstance({
  id: 'i3', name: 'business', integration: 'WHATSAPP-BUSINESS', number: '123456789', businessId: 'waba-1', token: 'secret',
});
assert.equal(business.phoneNumberId, '123456789');
assert.equal(business.businessAccountId, 'waba-1');

const auth = new MetaCloudAuthService();
auth.assertAuthorized(baileys, 'Bearer secret');
assert.throws(() => auth.assertAuthorized(baileys, 'Bearer wrong'));

const mapper = new MetaCloudStatusMapper();
assert.equal(mapper.map('SERVER_ACK'), 'sent');
assert.equal(mapper.map('DELIVERY_ACK'), 'delivered');
assert.equal(mapper.map('READ'), 'read');
assert.equal(mapper.map('PLAYED'), 'read');
assert.equal(mapper.map('ERROR'), 'failed');
assert.equal(mapper.map('DELETED'), 'deleted');
assert.equal(mapper.map('PENDING'), null);
console.log('meta-cloud foundation compatibility: ok');
''')

# Preserve existing compatibility test and add the new suite after it.
pkg = ROOT / 'package.json'
data = json.loads(pkg.read_text(encoding='utf-8'))
old = data['scripts']['test:compat']
if 'test/meta-cloud/foundation.test.ts' not in old:
    data['scripts']['test:compat'] = old + ' && tsx ./test/meta-cloud/foundation.test.ts'
pkg.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
