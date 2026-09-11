import { PrismaRepository } from '@api/repository/repository.service';
import { randomUUID } from 'crypto';

import {
  isLocalTemplateProvider,
  LOCAL_TEMPLATE_SOURCE,
  LocalTemplateError,
  renderLocalTemplate,
  templateIdentity,
  validateTemplateCreate,
  validateTemplateDelete,
  validateTemplateEdit,
} from './local-template.definition';

export class LocalTemplateService {
  constructor(private readonly prisma: PrismaRepository) {}

  private async instance(instanceName: string) {
    if (typeof instanceName !== 'string' || !instanceName) throw new LocalTemplateError('Instância não informada.');
    const instance = await this.prisma.instance.findUnique({
      where: { name: instanceName },
      select: { id: true, name: true, integration: true },
    });
    if (!instance) throw new LocalTemplateError('Instância não encontrada.', 404);
    if (!isLocalTemplateProvider(instance.integration)) {
      throw new LocalTemplateError('Modelos locais estão disponíveis somente para conexões ZAPO e Baileys.');
    }
    return instance;
  }

  public async list(instanceName: string, query: { after?: unknown; limit?: unknown } = {}) {
    const instance = await this.instance(instanceName);
    const limit = query.limit === undefined ? 100 : Number(query.limit);
    if (!Number.isInteger(limit) || limit < 1 || limit > 100 || Array.isArray(query.limit)) {
      throw new LocalTemplateError('limit deve estar entre 1 e 100.');
    }
    const after = query.after;
    if (after !== undefined && (typeof after !== 'string' || !/^lt_[a-f0-9-]{32,36}$/.test(after))) {
      throw new LocalTemplateError('Cursor inválido.');
    }
    const rows = await this.prisma.localTemplate.findMany({
      where: { instanceId: instance.id, deletedAt: null, ...(after ? { id: { gt: after as string } } : {}) },
      orderBy: { id: 'asc' },
      take: limit + 1,
    });
    const page = rows.slice(0, limit);
    const cursor = rows.length > limit ? page[page.length - 1].id : null;
    return {
      data: page.map((row) => this.serialize(row)),
      ...(cursor
        ? { paging: { cursors: { after: cursor }, next: `?after=${encodeURIComponent(cursor)}&limit=${limit}` } }
        : {}),
      connect_api: { source: LOCAL_TEMPLATE_SOURCE, execution: 'rendered_text', meta_approved: false },
    };
  }

  public async create(instanceName: string, payload: unknown) {
    const input = validateTemplateCreate(payload);
    const instance = await this.instance(instanceName);
    try {
      const row = await this.prisma.localTemplate.create({
        data: { ...input, enabled: input.enabled as boolean, id: `lt_${randomUUID()}`, instanceId: instance.id },
      });
      return this.serialize(row);
    } catch (error) {
      if (error?.code === 'P2002') {
        throw new LocalTemplateError(
          'Já existe um modelo com esse nome e idioma nesta instância, inclusive se arquivado.',
          409,
        );
      }
      throw error;
    }
  }

  public async edit(instanceName: string, payload: unknown) {
    const { name, language, version, ...data } = validateTemplateEdit(payload);
    const instance = await this.instance(instanceName);
    return this.prisma.$transaction(async (tx) => {
      const changed = await tx.localTemplate.updateMany({
        where: { instanceId: instance.id, name, language, version, deletedAt: null },
        data: { ...data, version: { increment: 1 } },
      });
      if (!changed.count) {
        throw new LocalTemplateError('Modelo alterado, arquivado ou não encontrado. Atualize a lista.', 409);
      }
      const row = await tx.localTemplate.findUnique({
        where: { instanceId_name_language: { instanceId: instance.id, name, language } },
      });
      return this.serialize(row);
    });
  }

  public async archive(instanceName: string, payload: unknown) {
    const { name, language, version } = validateTemplateDelete(payload);
    const instance = await this.instance(instanceName);
    const changed = await this.prisma.localTemplate.updateMany({
      where: { instanceId: instance.id, name, language, version, deletedAt: null },
      data: { deletedAt: new Date(), enabled: false, version: { increment: 1 } },
    });
    if (!changed.count) {
      throw new LocalTemplateError('Modelo alterado, arquivado ou não encontrado. Atualize a lista.', 409);
    }
    return { success: true };
  }

  public async render(
    instanceName: string,
    payload: { name?: unknown; language?: unknown; components?: unknown; version?: unknown },
  ) {
    const language =
      typeof payload?.language === 'object' && payload.language !== null
        ? (payload.language as { code?: unknown }).code
        : payload?.language;
    const identity = templateIdentity(payload?.name, language);
    const instance = await this.instance(instanceName);
    const row = await this.prisma.localTemplate.findUnique({
      where: { instanceId_name_language: { instanceId: instance.id, ...identity } },
    });
    if (!row || row.deletedAt) throw new LocalTemplateError('Modelo não encontrado nesta instância.', 404);
    if (!row.enabled) throw new LocalTemplateError('Modelo desabilitado nesta instância.', 409);
    if (payload.version !== undefined && payload.version !== row.version) {
      throw new LocalTemplateError('O modelo foi atualizado. Reconcilie os templates antes de enviar.', 409);
    }
    const text = renderLocalTemplate(row.components, payload.components ?? []);
    return {
      text,
      metadata: {
        id: row.id,
        name: row.name,
        language: row.language,
        version: row.version,
        source: LOCAL_TEMPLATE_SOURCE,
        execution: 'rendered_text',
        meta_approved: false,
      },
    };
  }

  private serialize(row: any) {
    return {
      id: row.id,
      name: row.name,
      language: row.language,
      category: 'UTILITY',
      components: row.components,
      status: row.enabled && !row.deletedAt ? 'LOCAL_READY' : 'LOCAL_DISABLED',
      source: LOCAL_TEMPLATE_SOURCE,
      execution: 'rendered_text',
      meta_approved: false,
      enabled: row.enabled && !row.deletedAt,
      available: row.enabled && !row.deletedAt,
      version: row.version,
      created_at: row.createdAt,
      updated_at: row.updatedAt,
    };
  }
}
