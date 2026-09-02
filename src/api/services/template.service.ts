import { InstanceDto } from '@api/dto/instance.dto';
import { TemplateDto } from '@api/dto/template.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { ConfigService, WaBusiness } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException, NotFoundException } from '@exceptions';
import { createId } from '@paralleldrive/cuid2';
import axios from 'axios';

import { WAMonitoringService } from './monitor.service';

const DEFAULT_LOCAL_TEMPLATES = [
  {
    name: 'hello_world',
    category: 'UTILITY',
    language: 'pt_BR',
    components: [{ type: 'BODY', text: 'Olá {{1}}! Esta é uma mensagem de teste do Connect|API.' }],
  },
  {
    name: 'sample_utility',
    category: 'UTILITY',
    language: 'pt_BR',
    components: [
      { type: 'BODY', text: 'Olá {{1}}. Sua solicitação {{2}} está pronta para continuar.' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Confirmar', id: 'confirm' },
          { type: 'QUICK_REPLY', text: 'Cancelar', id: 'cancel' },
        ],
      },
    ],
  },
  {
    name: 'sample_marketing',
    category: 'MARKETING',
    language: 'pt_BR',
    components: [{ type: 'BODY', text: 'Olá {{1}}, temos uma novidade para você: {{2}}.' }],
  },
  {
    name: 'sample_authentication',
    category: 'AUTHENTICATION',
    language: 'pt_BR',
    components: [{ type: 'BODY', text: 'Seu código de verificação é {{1}}.' }],
  },
] as const;

type TemplateEditData = {
  templateId: string;
  name?: string;
  language?: string;
  category?: string;
  components?: any;
  allowCategoryChange?: boolean;
  ttl?: number;
  actions?: Record<string, unknown>;
  policy?: Record<string, unknown>;
  enabled?: boolean;
  webhookUrl?: string;
};

export class TemplateService {
  constructor(
    private readonly waMonitor: WAMonitoringService,
    public readonly prismaRepository: PrismaRepository,
    private readonly configService: ConfigService,
  ) {}

  private readonly logger = new Logger('TemplateService');

  private businessId: string;
  private token: string;

  public async find(instance: InstanceDto) {
    const runtimeInstance = await this.getRuntimeInstance(instance);

    if (this.isMetaBusiness(runtimeInstance.integration)) {
      this.setMetaCredentials(runtimeInstance);
      const response = await this.requestTemplate({}, 'GET');
      if (!response) throw new Error('Error to find templates');

      const remoteTemplates = Array.isArray(response.data) ? response.data : [];
      const overlays = await this.prismaRepository.template.findMany({
        where: { instanceId: runtimeInstance.id },
      });

      return remoteTemplates.map((remote) => {
        const overlay = overlays.find(
          (local) =>
            String(local.externalTemplateId || '') === String(remote.id || '') ||
            (local.name === remote.name && local.language === (remote.language || 'pt_BR')),
        );
        return {
          ...remote,
          origin: overlay?.origin || 'META',
          enabled: overlay?.enabled ?? true,
          isDefault: overlay?.isDefault ?? false,
          actions: overlay?.actions || null,
          policy: overlay?.policy || null,
          webhookUrl: overlay?.webhookUrl || null,
          localId: overlay?.id || null,
        };
      });
    }

    await this.ensureDefaultTemplates(runtimeInstance.id);
    const templates = await this.prismaRepository.template.findMany({
      where: { instanceId: runtimeInstance.id },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }, { language: 'asc' }],
    });
    return templates.map((template) => this.toMetaShape(template));
  }

  public async create(instance: InstanceDto, data: TemplateDto) {
    try {
      const runtimeInstance = await this.getRuntimeInstance(instance);

      if (!this.isMetaBusiness(runtimeInstance.integration)) {
        return await this.createLocal(runtimeInstance.id, data);
      }

      this.setMetaCredentials(runtimeInstance);
      const postData = {
        name: data.name,
        category: data.category,
        allow_category_change: data.allowCategoryChange,
        language: data.language,
        components: data.components,
      };

      const response = await this.requestTemplate(postData, 'POST');
      if (!response || response.error) this.throwMetaError(response, 'Error to create template');

      const created = await this.prismaRepository.template.create({
        data: {
          templateId: String(response.id),
          externalTemplateId: String(response.id),
          name: data.name,
          language: data.language,
          category: data.category,
          status: response.status || 'PENDING',
          origin: 'META',
          enabled: data.enabled ?? true,
          isDefault: false,
          template: { ...postData, ...response },
          actions: data.actions as any,
          policy: data.policy as any,
          webhookUrl: data.webhookUrl,
          instanceId: runtimeInstance.id,
        },
      });

      return this.toMetaShape(created);
    } catch (error) {
      this.logger.error('Error in create template: ' + error);
      throw error;
    }
  }

  public async edit(instance: InstanceDto, data: TemplateEditData) {
    const runtimeInstance = await this.getRuntimeInstance(instance);

    if (!this.isMetaBusiness(runtimeInstance.integration)) {
      const current = await this.prismaRepository.template.findFirst({
        where: {
          instanceId: runtimeInstance.id,
          OR: [{ templateId: data.templateId }, { externalTemplateId: data.templateId }],
        },
      });
      if (!current) throw new NotFoundException(`Template ${data.templateId} not found`);

      const currentTemplate: any = current.template || {};
      const nextTemplate = {
        ...currentTemplate,
        ...(typeof data.name === 'string' ? { name: data.name } : {}),
        ...(typeof data.language === 'string' ? { language: data.language } : {}),
        ...(typeof data.category === 'string' ? { category: data.category } : {}),
        ...(data.components ? { components: data.components } : {}),
        ...(typeof data.allowCategoryChange === 'boolean' ? { allow_category_change: data.allowCategoryChange } : {}),
      };

      let nextPolicy: any = data.policy !== undefined ? { ...(data.policy || {}) } : { ...((current.policy as any) || {}) };
      if (typeof data.ttl === 'number') nextPolicy = { ...nextPolicy, ttl: data.ttl };

      const updated = await this.prismaRepository.template.update({
        where: { id: current.id },
        data: {
          ...(typeof data.name === 'string' ? { name: data.name } : {}),
          ...(typeof data.language === 'string' ? { language: data.language } : {}),
          ...(typeof data.category === 'string' ? { category: data.category } : {}),
          ...(typeof data.enabled === 'boolean' ? { enabled: data.enabled } : {}),
          ...(data.actions !== undefined ? { actions: data.actions as any } : {}),
          ...(data.webhookUrl !== undefined ? { webhookUrl: data.webhookUrl || null } : {}),
          template: nextTemplate,
          policy: nextPolicy,
        },
      });
      return this.toMetaShape(updated);
    }

    this.setMetaCredentials(runtimeInstance);
    const payload: Record<string, unknown> = {};
    if (typeof data.category === 'string') payload.category = data.category;
    if (typeof data.allowCategoryChange === 'boolean') payload.allow_category_change = data.allowCategoryChange;
    if (typeof data.ttl === 'number') payload.time_to_live = data.ttl;
    if (data.components) payload.components = data.components;

    let response: any = { success: true };
    if (Object.keys(payload).length > 0) {
      response = await this.requestEditTemplate(data.templateId, payload);
      if (!response || response.error) this.throwMetaError(response, 'Error to edit template');
    }

    let overlay = await this.prismaRepository.template.findFirst({
      where: {
        instanceId: runtimeInstance.id,
        OR: [{ templateId: data.templateId }, { externalTemplateId: data.templateId }],
      },
    });

    if (overlay) {
      const currentTemplate: any = overlay.template || {};
      const policy: any = data.policy !== undefined ? data.policy || {} : overlay.policy || {};
      overlay = await this.prismaRepository.template.update({
        where: { id: overlay.id },
        data: {
          ...(data.name ? { name: data.name } : {}),
          ...(data.language ? { language: data.language } : {}),
          ...(data.category ? { category: data.category } : {}),
          ...(typeof data.enabled === 'boolean' ? { enabled: data.enabled } : {}),
          ...(data.actions !== undefined ? { actions: data.actions as any } : {}),
          ...(data.webhookUrl !== undefined ? { webhookUrl: data.webhookUrl || null } : {}),
          policy: { ...policy, ...(typeof data.ttl === 'number' ? { ttl: data.ttl } : {}) },
          template: {
            ...currentTemplate,
            ...(data.name ? { name: data.name } : {}),
            ...(data.language ? { language: data.language } : {}),
            ...(data.category ? { category: data.category } : {}),
            ...(data.components ? { components: data.components } : {}),
          },
        },
      });
    } else if (data.name) {
      const language = data.language || 'pt_BR';
      overlay = await this.prismaRepository.template.create({
        data: {
          templateId: data.templateId,
          externalTemplateId: data.templateId,
          name: data.name,
          language,
          category: data.category || 'UTILITY',
          status: 'APPROVED',
          origin: 'META',
          enabled: data.enabled ?? true,
          isDefault: false,
          template: {
            id: data.templateId,
            name: data.name,
            language,
            category: data.category || 'UTILITY',
            components: data.components || [],
          },
          actions: data.actions as any,
          policy: ({ ...(data.policy || {}), ...(typeof data.ttl === 'number' ? { ttl: data.ttl } : {}) } as any),
          webhookUrl: data.webhookUrl,
          instanceId: runtimeInstance.id,
        },
      });
    }

    return { ...response, ...(overlay ? { editor: this.toMetaShape(overlay) } : {}) };
  }

  public async delete(instance: InstanceDto, data: { name: string; hsmId?: string }) {
    const runtimeInstance = await this.getRuntimeInstance(instance);

    if (!this.isMetaBusiness(runtimeInstance.integration)) {
      const deleted = await this.prismaRepository.template.deleteMany({
        where: {
          instanceId: runtimeInstance.id,
          OR: [{ name: data.name }, ...(data.hsmId ? [{ templateId: data.hsmId }] : [])],
        },
      });
      return { success: true, deleted: deleted.count, name: data.name };
    }

    this.setMetaCredentials(runtimeInstance);
    const response = await this.requestDeleteTemplate({ name: data.name, hsm_id: data.hsmId });
    if (!response || response.error) this.throwMetaError(response, 'Error to delete template');

    try {
      await this.prismaRepository.template.deleteMany({
        where: {
          instanceId: runtimeInstance.id,
          OR: [{ name: data.name }, ...(data.hsmId ? [{ templateId: data.hsmId }] : [])],
        },
      });
    } catch (err) {
      this.logger.warn(
        `Failed to cleanup local template records after delete: ${(err as Error)?.message || String(err)}`,
      );
    }
    return response;
  }

  private async createLocal(instanceId: string, data: TemplateDto) {
    const existing = await this.prismaRepository.template.findFirst({
      where: { instanceId, name: data.name, language: data.language },
    });
    if (existing)
      throw new BadRequestException(`Template ${data.name} (${data.language}) already exists for this instance`);

    const templateId = `sim_tpl_${createId()}`;
    const definition = {
      id: templateId,
      name: data.name,
      status: 'APPROVED',
      category: data.category,
      language: data.language,
      components: data.components,
    };
    const created = await this.prismaRepository.template.create({
      data: {
        templateId,
        name: data.name,
        language: data.language,
        category: data.category,
        status: 'APPROVED',
        origin: 'LOCAL',
        enabled: data.enabled ?? true,
        isDefault: false,
        template: definition,
        actions: data.actions as any,
        policy: data.policy as any,
        webhookUrl: data.webhookUrl,
        instanceId,
      },
    });
    return this.toMetaShape(created);
  }

  private async ensureDefaultTemplates(instanceId: string) {
    for (const definition of DEFAULT_LOCAL_TEMPLATES) {
      const exists = await this.prismaRepository.template.findFirst({
        where: { instanceId, name: definition.name, language: definition.language },
      });
      if (exists) continue;

      const templateId = `sys_tpl_${createId()}`;
      await this.prismaRepository.template.create({
        data: {
          templateId,
          name: definition.name,
          language: definition.language,
          category: definition.category,
          status: 'APPROVED',
          origin: 'SYSTEM',
          enabled: true,
          isDefault: true,
          template: { id: templateId, status: 'APPROVED', ...definition },
          instanceId,
        },
      });
    }
  }

  private toMetaShape(template: any) {
    const definition = template.template || {};
    return {
      id: template.externalTemplateId || template.templateId,
      localId: template.id,
      name: template.name,
      status: template.status || definition.status || 'APPROVED',
      category: template.category || definition.category || 'UTILITY',
      language: template.language || definition.language || 'pt_BR',
      components: definition.components || [],
      origin: template.origin || 'LOCAL',
      enabled: template.enabled !== false,
      isDefault: Boolean(template.isDefault),
      actions: template.actions || null,
      policy: template.policy || null,
      webhookUrl: template.webhookUrl || null,
      createdAt: template.createdAt,
      updatedAt: template.updatedAt,
    };
  }

  private async getRuntimeInstance(instance: InstanceDto): Promise<any> {
    const runtime = this.waMonitor.waInstances[instance.instanceName];
    if (!runtime?.instance) throw new NotFoundException(`Instance ${instance.instanceName} not found`);
    return await runtime.instance;
  }

  private isMetaBusiness(provider?: string) {
    return provider === 'WHATSAPP-BUSINESS';
  }

  private setMetaCredentials(runtimeInstance: any) {
    this.businessId = runtimeInstance.businessId;
    this.token = runtimeInstance.token;
  }

  private throwMetaError(response: any, fallback: string): never {
    if (response?.error) {
      const metaError = new Error(response.error.message || fallback);
      (metaError as any).template = response.error;
      throw metaError;
    }
    throw new Error(fallback);
  }

  private async requestTemplate(data: any, method: string) {
    try {
      let urlServer = this.configService.get<WaBusiness>('WA_BUSINESS').URL;
      const version = this.configService.get<WaBusiness>('WA_BUSINESS').VERSION;
      urlServer = `${urlServer}/${version}/${this.businessId}/message_templates`;
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };

      if (method === 'GET') {
        const result = await axios.get(urlServer, { headers });
        return result.data;
      }
      if (method === 'POST') {
        const result = await axios.post(urlServer, data, { headers });
        return result.data;
      }
    } catch (e) {
      this.logger.error(
        'WhatsApp API request error: ' + (e.response?.data ? JSON.stringify(e.response?.data) : e.message),
      );
      if (e.response?.data) return e.response.data;
      throw new Error(`Connection error: ${e.message}`);
    }
  }

  private async requestEditTemplate(templateId: string, data: any) {
    try {
      let urlServer = this.configService.get<WaBusiness>('WA_BUSINESS').URL;
      const version = this.configService.get<WaBusiness>('WA_BUSINESS').VERSION;
      urlServer = `${urlServer}/${version}/${templateId}`;
      const headers = { 'Content-Type': 'application/json', Authorization: `Bearer ${this.token}` };
      const result = await axios.post(urlServer, data, { headers });
      return result.data;
    } catch (e) {
      this.logger.error(
        'WhatsApp API request error: ' + (e.response?.data ? JSON.stringify(e.response?.data) : e.message),
      );
      if (e.response?.data) return e.response.data;
      throw new Error(`Connection error: ${e.message}`);
    }
  }

  private async requestDeleteTemplate(params: { name: string; hsm_id?: string }) {
    try {
      let urlServer = this.configService.get<WaBusiness>('WA_BUSINESS').URL;
      const version = this.configService.get<WaBusiness>('WA_BUSINESS').VERSION;
      urlServer = `${urlServer}/${version}/${this.businessId}/message_templates`;
      const headers = { Authorization: `Bearer ${this.token}` };
      const result = await axios.delete(urlServer, { headers, params });
      return result.data;
    } catch (e) {
      this.logger.error(
        'WhatsApp API request error: ' + (e.response?.data ? JSON.stringify(e.response?.data) : e.message),
      );
      if (e.response?.data) return e.response.data;
      throw new Error(`Connection error: ${e.message}`);
    }
  }
}
