import { PrismaRepository } from '@api/repository/repository.service';
import { managerFramePolicy, normalizeManagerFrameOrigins, type ManagerEmbeddingOverride } from '@utils/managerFramePolicy';

export type ManagerEmbeddingSettings = {
  version: number;
  configured: boolean;
  enabled: boolean;
  allowedOrigins: string[];
  effectiveFrameAncestors: string;
  source: 'database' | 'environment';
  allowAnyOrigin: boolean;
  updatedAt: string | null;
};

export class ManagerEmbeddingError extends Error {
  constructor(
    message: string,
    public readonly status = 400,
  ) {
    super(message);
    this.name = 'ManagerEmbeddingError';
  }
}

export class ManagerEmbeddingService {
  private cache?: { expiresAt: number; value: ManagerEmbeddingOverride | null; version: number; updatedAt: string | null };
  private lastKnown?: { value: ManagerEmbeddingOverride | null; version: number; updatedAt: string | null };

  constructor(private readonly prisma: PrismaRepository) {}

  private async persisted(force = false) {
    if (!force && this.cache && this.cache.expiresAt > Date.now()) return this.cache;

    const row = await (this.prisma as any).managerEmbeddingSetting.findUnique({ where: { id: 1 } });
    const value: ManagerEmbeddingOverride | null = row
      ? {
          configured: Boolean(row.configured),
          enabled: Boolean(row.enabled),
          allowedOrigins: Array.isArray(row.allowedOrigins)
            ? row.allowedOrigins.filter((item: unknown) => typeof item === 'string')
            : [],
        }
      : null;
    const result = {
      expiresAt: Date.now() + 5000,
      value,
      version: Number(row?.version || 1),
      updatedAt: row?.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    };
    this.cache = result;
    this.lastKnown = result;
    return result;
  }

  public async policy() {
    try {
      const row = await this.persisted();
      return managerFramePolicy(process.env, row.value);
    } catch {
      // Preserve the last known database decision during a transient DB failure.
      // Without a known database state, fail closed instead of widening access from ENV.
      if (this.lastKnown) return managerFramePolicy(process.env, this.lastKnown.value);
      return managerFramePolicy(process.env, { configured: true, enabled: false, allowedOrigins: [] });
    }
  }

  public async settings(): Promise<ManagerEmbeddingSettings> {
    const row = await this.persisted(true);
    const policy = managerFramePolicy(process.env, row.value);
    const configured = Boolean(row.value?.configured);

    if (configured) {
      return {
        version: row.version,
        configured: true,
        enabled: policy.enabled,
        allowedOrigins: row.value?.allowedOrigins || [],
        effectiveFrameAncestors: policy.frameAncestors,
        source: 'database',
        allowAnyOrigin: false,
        updatedAt: row.updatedAt,
      };
    }

    const allowedOrigins = policy.frameAncestors
      .split(/\s+/)
      .filter((value) => /^https?:\/\//i.test(value) && !value.includes('*'));

    return {
      version: row.version,
      configured: false,
      enabled: policy.enabled,
      allowedOrigins,
      effectiveFrameAncestors: policy.frameAncestors,
      source: 'environment',
      allowAnyOrigin: policy.frameAncestors === '*',
      updatedAt: row.updatedAt,
    };
  }

  public async save(input: { version: number; enabled: boolean; allowedOrigins: string[] }): Promise<ManagerEmbeddingSettings> {
    if (!Number.isInteger(input.version) || input.version < 1) {
      throw new ManagerEmbeddingError('Versão de configuração inválida.');
    }
    if (typeof input.enabled !== 'boolean' || !Array.isArray(input.allowedOrigins)) {
      throw new ManagerEmbeddingError('Configuração de iframe inválida.');
    }

    let allowedOrigins: string[];
    try {
      allowedOrigins = normalizeManagerFrameOrigins(input.allowedOrigins);
    } catch (error) {
      throw new ManagerEmbeddingError(error instanceof Error ? error.message : 'Origem de iframe inválida.');
    }
    if (input.enabled && !allowedOrigins.length) {
      throw new ManagerEmbeddingError('Cadastre pelo menos uma origem antes de habilitar a incorporação.');
    }

    const delegate = (this.prisma as any).managerEmbeddingSetting;
    const current = await delegate.findUnique({ where: { id: 1 } });
    let row: any;

    if (current) {
      if (Number(current.version) !== input.version) {
        throw new ManagerEmbeddingError('A configuração foi alterada por outra sessão. Recarregue e tente novamente.', 409);
      }
      const updated = await delegate.updateMany({
        where: { id: 1, version: input.version },
        data: {
          configured: true,
          enabled: input.enabled,
          allowedOrigins,
          version: { increment: 1 },
        },
      });
      if (Number(updated?.count || 0) !== 1) {
        throw new ManagerEmbeddingError('A configuração foi alterada por outra sessão. Recarregue e tente novamente.', 409);
      }
      row = await delegate.findUnique({ where: { id: 1 } });
    } else {
      if (input.version !== 1) {
        throw new ManagerEmbeddingError('A configuração foi alterada. Recarregue e tente novamente.', 409);
      }
      try {
        row = await delegate.create({
          data: {
            id: 1,
            configured: true,
            enabled: input.enabled,
            allowedOrigins,
            version: 2,
          },
        });
      } catch {
        // A concurrent first save can win between findUnique and create.
        throw new ManagerEmbeddingError('A configuração foi alterada por outra sessão. Recarregue e tente novamente.', 409);
      }
    }

    if (!row) throw new ManagerEmbeddingError('Configuração de iframe temporariamente indisponível.', 503);

    const value: ManagerEmbeddingOverride = {
      configured: true,
      enabled: Boolean(row.enabled),
      allowedOrigins,
    };
    this.cache = {
      expiresAt: Date.now() + 5000,
      value,
      version: Number(row.version),
      updatedAt: row.updatedAt ? new Date(row.updatedAt).toISOString() : null,
    };
    this.lastKnown = this.cache;
    return this.settings();
  }
}
