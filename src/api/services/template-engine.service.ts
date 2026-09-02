import { InstanceDto } from '@api/dto/instance.dto';
import { SendTemplateDto } from '@api/dto/sendMessage.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { Logger } from '@config/logger.config';
import { BadRequestException, NotFoundException } from '@exceptions';

import { WAMonitoringService } from './monitor.service';
import { RenderedTemplate, renderTemplateDefinition } from './template-renderer';

export class TemplateEngineService {
  private readonly logger = new Logger('TemplateEngineService');

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
      this.attachDiagnostics(result, {
        provider,
        templateName: data.name,
        language,
        category: template?.category || null,
        mode: 'PROVIDER_NATIVE',
        buttonCount: 0,
        fallback: false,
      });
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
      result =
        provider === 'WHATSAPP-BAILEYS'
          ? await this.sendBaileysCompatibleInteraction(runtime, data, rendered, template)
          : await this.sendInteractiveWithFallback(runtime, data, rendered, template);
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
      this.attachDiagnostics(result, {
        provider,
        templateName: data.name,
        language,
        category: template.category,
        mode: 'TEXT',
        buttonCount: 0,
        fallback: false,
      });
    }

    await this.registerInteractionSession(instanceRow.id, template, data, result, rendered);
    return result;
  }

  private async sendBaileysCompatibleInteraction(
    runtime: any,
    data: SendTemplateDto,
    rendered: RenderedTemplate,
    template: any,
  ) {
    const replyButtons = rendered.buttons.filter((button) => button.type === 'reply' && button.displayText);
    const replyOnly = replyButtons.length > 0 && replyButtons.length === rendered.buttons.length;

    if (replyOnly && typeof runtime.pollMessage === 'function') {
      try {
        const result = await runtime.pollMessage({
          number: data.number,
          name: this.pollPrompt(rendered),
          selectableCount: 1,
          values: replyButtons.map((button) => String(button.displayText)),
          delay: data.delay,
          quoted: data.quoted,
          linkPreview: data.linkPreview,
          mentionsEveryOne: data.mentionsEveryOne,
          mentioned: data.mentioned,
        });
        this.attachDiagnostics(result, {
          provider: 'WHATSAPP-BAILEYS',
          templateName: data.name,
          language: data.language || 'pt_BR',
          category: template.category,
          mode: 'POLL_COMPAT',
          buttonCount: rendered.buttons.length,
          fallback: false,
          compatibilityTransport: 'BAILEYS_OFFICIAL_POLL',
        });
        return result;
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Baileys poll compatibility for template ${data.name} failed; using text fallback: ${reason}`);
        return this.sendBaileysTextCompatibility(runtime, data, rendered, template, reason);
      }
    }

    return this.sendBaileysTextCompatibility(
      runtime,
      data,
      rendered,
      template,
      'Official Baileys does not reliably render nativeFlow interactive messages.',
    );
  }

  private async sendBaileysTextCompatibility(
    runtime: any,
    data: SendTemplateDto,
    rendered: RenderedTemplate,
    template: any,
    reason: string,
  ) {
    const result = await runtime.textMessage({
      number: data.number,
      text: this.textFallback(rendered),
      delay: data.delay,
      quoted: data.quoted,
      linkPreview: data.linkPreview,
      mentionsEveryOne: data.mentionsEveryOne,
      mentioned: data.mentioned,
    });
    this.attachDiagnostics(result, {
      provider: 'WHATSAPP-BAILEYS',
      templateName: data.name,
      language: data.language || 'pt_BR',
      category: template.category,
      mode: 'TEXT_COMPAT',
      buttonCount: rendered.buttons.length,
      fallback: true,
      fallbackReason: reason,
      compatibilityTransport: 'BAILEYS_TEXT',
    });
    return result;
  }

  private pollPrompt(rendered: RenderedTemplate) {
    return (
      ([rendered.title, rendered.text, rendered.footer].filter(Boolean) as string[]).join('\n\n').trim() ||
      'Escolha uma opção'
    );
  }

  private async sendInteractiveWithFallback(
    runtime: any,
    data: SendTemplateDto,
    rendered: RenderedTemplate,
    template: any,
  ) {
    const title = rendered.title || data.name;
    const description = rendered.text || undefined;

    try {
      const result = await runtime.buttonMessage({
        number: data.number,
        title,
        description,
        footer: rendered.footer,
        buttons: rendered.buttons,
        delay: data.delay,
        quoted: data.quoted,
        mentionsEveryOne: data.mentionsEveryOne,
        mentioned: data.mentioned,
      });
      this.attachDiagnostics(result, {
        provider: runtime.instance?.integration || 'WHATSAPP-BAILEYS',
        templateName: data.name,
        language: data.language || 'pt_BR',
        category: template.category,
        mode: 'INTERACTIVE',
        buttonCount: rendered.buttons.length,
        fallback: false,
      });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Interactive template ${data.name} failed; using text fallback: ${reason}`);

      const fallbackText = this.textFallback(rendered);
      const result = await runtime.textMessage({
        number: data.number,
        text: fallbackText,
        delay: data.delay,
        quoted: data.quoted,
        linkPreview: data.linkPreview,
        mentionsEveryOne: data.mentionsEveryOne,
        mentioned: data.mentioned,
      });
      this.attachDiagnostics(result, {
        provider: runtime.instance?.integration || 'WHATSAPP-BAILEYS',
        templateName: data.name,
        language: data.language || 'pt_BR',
        category: template.category,
        mode: 'TEXT_FALLBACK',
        buttonCount: rendered.buttons.length,
        fallback: true,
        fallbackReason: reason,
      });
      return result;
    }
  }

  private textFallback(rendered: RenderedTemplate) {
    const parts = [rendered.title, rendered.text, rendered.footer].filter(Boolean) as string[];
    const replyButtons = rendered.buttons.filter((button) => button.type === 'reply' && button.displayText);
    const otherButtons = rendered.buttons.filter((button) => button.type !== 'reply' && button.displayText);

    if (replyButtons.length) {
      parts.push(
        ['Responda com uma das opções:', ...replyButtons.map((button) => `• ${button.displayText}`)].join('\n'),
      );
    }
    if (otherButtons.length) {
      parts.push(
        otherButtons
          .map((button) => {
            if (button.type === 'url') return `${button.displayText}: ${button.url || ''}`.trim();
            if (button.type === 'call') return `${button.displayText}: ${button.phoneNumber || ''}`.trim();
            if (button.type === 'copy') return `${button.displayText}: ${button.copyCode || ''}`.trim();
            return String(button.displayText || '');
          })
          .filter(Boolean)
          .join('\n'),
      );
    }

    return parts.filter(Boolean).join('\n\n').trim();
  }

  private attachDiagnostics(result: any, diagnostics: Record<string, unknown>) {
    if (!result || typeof result !== 'object') return;
    result.templateExecution = {
      engine: 'CONNECT_TEMPLATE_ENGINE',
      ...diagnostics,
    };
  }

  private hasBindings(actions: unknown) {
    if (!actions || typeof actions !== 'object') return false;
    const value = actions as any;
    return (
      (Array.isArray(value.bindings) && value.bindings.length > 0) ||
      (value.interactions && typeof value.interactions === 'object' && Object.keys(value.interactions).length > 0)
    );
  }

  private actionsWithRenderedAliases(actions: unknown, rendered?: RenderedTemplate): unknown {
    if (!actions || typeof actions !== 'object' || !rendered?.buttons?.length) return actions;

    const labels = new Map(
      rendered.buttons
        .filter((button) => button.type === 'reply' && button.id && button.displayText)
        .map((button) => [String(button.id), String(button.displayText)]),
    );
    if (!labels.size) return actions;

    const source = actions as any;
    if (Array.isArray(source.bindings)) {
      return {
        ...source,
        bindings: source.bindings.map((binding: any) => ({
          ...binding,
          matchTitle: binding.matchTitle || labels.get(String(binding.id || '')) || undefined,
        })),
      };
    }

    if (source.interactions && typeof source.interactions === 'object') {
      return {
        ...source,
        interactions: Object.fromEntries(
          Object.entries(source.interactions).map(([id, binding]: [string, any]) => [
            id,
            { ...binding, matchTitle: binding?.matchTitle || labels.get(id) || undefined },
          ]),
        ),
      };
    }

    return actions;
  }

  private async registerInteractionSession(
    instanceId: string,
    template: any,
    data: SendTemplateDto,
    result: any,
    rendered?: RenderedTemplate,
  ) {
    const sessionActions = this.actionsWithRenderedAliases(template?.actions, rendered);
    if (!template || !this.hasBindings(sessionActions)) return;

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
        actions: sessionActions as any,
        status: 'OPEN',
        expiresAt,
      },
      update: {
        remoteJid,
        templateName: data.name,
        language: data.language || template.language || 'pt_BR',
        variables: (data.variables || {}) as any,
        actions: sessionActions as any,
        status: 'OPEN',
        inboundMessageId: null,
        lastError: null,
        expiresAt,
      },
    });
  }
}
