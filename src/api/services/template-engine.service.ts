import { InstanceDto } from '@api/dto/instance.dto';
import { SendTemplateDto } from '@api/dto/sendMessage.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { BadRequestException, NotFoundException } from '@exceptions';

import { WAMonitoringService } from './monitor.service';
import { renderTemplateDefinition } from './template-renderer';

export class TemplateEngineService {
  constructor(
    private readonly waMonitor: WAMonitoringService,
    private readonly prisma: PrismaRepository,
  ) {}

  public async send(instance: InstanceDto, data: SendTemplateDto) {
    const runtime = this.waMonitor.waInstances[instance.instanceName];
    if (!runtime) throw new NotFoundException(`Instance ${instance.instanceName} not found`);

    const instanceRow = await this.prisma.instance.findUnique({
      where: { name: instance.instanceName },
      select: { id: true, integration: true },
    });
    if (!instanceRow) throw new NotFoundException(`Instance ${instance.instanceName} not found`);

    const provider = instance.integration || instanceRow.integration || runtime.instance?.integration;
    const language = data.language || 'pt_BR';
    const template = await this.prisma.template.findFirst({
      where: {
        instanceId: instanceRow.id,
        name: data.name,
        language,
        enabled: true,
      },
    });

    let result: any;

    // Meta Business remains provider-native. A local template record acts only as
    // Connect|API metadata overlay (actions/policy/editor state) when available.
    if (provider === 'WHATSAPP-BUSINESS') {
      result = await runtime.templateMessage(data);
      await this.registerInteractionSession(instanceRow.id, template, data, result);
      return result;
    }

    if (!template) {
      throw new NotFoundException(`Template ${data.name} (${language}) not found for this instance`);
    }

    const definition: any = template.template || {};
    const rendered = renderTemplateDefinition(
      definition,
      Array.isArray(data.components) ? data.components : [],
      data.variables || {},
    );

    if (!rendered.text && !rendered.title) {
      throw new BadRequestException(`Template ${data.name} has no renderable text content for provider ${provider}`);
    }

    if (rendered.buttons.length) {
      result = await runtime.buttonMessage({
        number: data.number,
        title: rendered.title || rendered.text || data.name,
        description: rendered.text || undefined,
        footer: rendered.footer,
        buttons: rendered.buttons,
        delay: data.delay,
        quoted: data.quoted,
        mentionsEveryOne: data.mentionsEveryOne,
        mentioned: data.mentioned,
      });
    } else {
      result = await runtime.textMessage({
        number: data.number,
        text: rendered.text || rendered.title,
        delay: data.delay,
        quoted: data.quoted,
        linkPreview: data.linkPreview,
        mentionsEveryOne: data.mentionsEveryOne,
        mentioned: data.mentioned,
      });
    }

    await this.registerInteractionSession(instanceRow.id, template, data, result);
    return result;
  }

  private hasBindings(actions: unknown) {
    if (!actions || typeof actions !== 'object') return false;
    const value = actions as any;
    return (
      (Array.isArray(value.bindings) && value.bindings.length > 0) ||
      (value.interactions && typeof value.interactions === 'object' && Object.keys(value.interactions).length > 0)
    );
  }

  private async registerInteractionSession(instanceId: string, template: any, data: SendTemplateDto, result: any) {
    if (!template || !this.hasBindings(template.actions)) return;

    const outboundMessageId = result?.key?.id || result?.messages?.[0]?.id;
    if (!outboundMessageId) return;

    const remoteJid = String(result?.key?.remoteJid || data.number || '');
    if (!remoteJid) return;

    const policy: any = template.policy || {};
    const configuredTtl = Number(policy.interactionTtlSeconds || 86400);
    const ttlSeconds = Math.min(Math.max(Number.isFinite(configuredTtl) ? configuredTtl : 86400, 60), 30 * 86400);
    const expiresAt = new Date(Date.now() + ttlSeconds * 1000);

    await this.prisma.templateInteractionSession.upsert({
      where: {
        instanceId_outboundMessageId: {
          instanceId,
          outboundMessageId: String(outboundMessageId),
        },
      },
      create: {
        instanceId,
        outboundMessageId: String(outboundMessageId),
        remoteJid,
        templateName: data.name,
        language: data.language || template.language || 'pt_BR',
        variables: (data.variables || {}) as any,
        actions: template.actions as any,
        status: 'OPEN',
        expiresAt,
      },
      update: {
        remoteJid,
        templateName: data.name,
        language: data.language || template.language || 'pt_BR',
        variables: (data.variables || {}) as any,
        actions: template.actions as any,
        status: 'OPEN',
        inboundMessageId: null,
        lastError: null,
        expiresAt,
      },
    });
  }
}
