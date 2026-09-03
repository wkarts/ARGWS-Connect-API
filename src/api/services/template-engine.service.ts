import { InstanceDto } from '@api/dto/instance.dto';
import type { MicroAppSessionDto } from '@api/dto/micro-app.dto';
import { SendTemplateDto } from '@api/dto/sendMessage.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { Logger } from '@config/logger.config';
import { BadRequestException, NotFoundException } from '@exceptions';

import {
  buildMicroAppRuntimeContext,
  candidateRemoteJids,
  mergeRuntimeVariables,
  normalizeWhatsappNumber,
  resolveMicroAppAutoLaunch,
} from './micro-app-auto-launch';
import { WAMonitoringService } from './monitor.service';
import {
  interactionTextFallback,
  RenderedTemplateInteraction,
  renderInteractionModelV2,
} from './template-interaction-model';
import { RenderedTemplate, renderTemplateDefinition } from './template-renderer';
import {
  getProviderTemplateCapabilities,
  planTemplateTransport,
  TemplateRenderEnvelope,
  TemplateTransportPlan,
} from './template-transport-planner';

export class TemplateEngineService {
  private readonly logger = new Logger('TemplateEngineService');

  private microAppSessionCreator?: (
    instance: InstanceDto,
    data: MicroAppSessionDto,
  ) => Promise<{ url: string; appKey: string; pageKey: string; expiresAt?: string; token?: string }>;

  public setMicroAppSessionCreator(
    creator: (
      instance: InstanceDto,
      data: MicroAppSessionDto,
    ) => Promise<{ url: string; appKey: string; pageKey: string; expiresAt?: string; token?: string }>,
  ) {
    this.microAppSessionCreator = creator;
  }

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
    let variables = (data.variables || {}) as Record<string, unknown>;
    const autoLaunch = await this.prepareMicroAppAutoLaunch(instance, instanceRow.id, template, data, variables);
    if (autoLaunch) variables = autoLaunch.variables;
    data.variables = variables;
    const interactions = renderInteractionModelV2(template?.policy, variables);

    let result: any;
    let rendered: TemplateRenderEnvelope;

    // Meta Business remains provider-native. Local records are metadata overlays
    // for Actions/Policy/Interaction Model v2 and never contaminate Meta components.
    if (provider === 'WHATSAPP-BUSINESS') {
      rendered = { text: '', buttons: [], interactions };
      const transport = planTemplateTransport(provider, rendered);
      result = await runtime.templateMessage(data);
      this.attachDiagnostics(result, {
        provider,
        templateName: data.name,
        language,
        category: template?.category || null,
        mode: 'PROVIDER_NATIVE',
        buttonCount: 0,
        interactionCount: interactions.length,
        fallback: false,
      });
      await this.registerInteractionSession(instanceRow.id, template, data, result, rendered);
      await this.sendRenderedInteractions(instanceRow.id, runtime, data, provider, template, rendered, transport);
      await this.sendMicroAppAutoLaunch(runtime, data, autoLaunch);
      return result;
    }

    if (!template) {
      throw new NotFoundException(`Template ${data.name} (${language}) not found for this instance`);
    }

    const definition: any = template.template || {};
    const baseRendered = renderTemplateDefinition(
      definition,
      Array.isArray(data.components) ? data.components : [],
      variables,
    );
    rendered = { ...baseRendered, interactions };

    if (!rendered.text && !rendered.title && !rendered.interactions.length) {
      throw new BadRequestException(`Template ${data.name} has no renderable content for provider ${provider}`);
    }

    const transport = planTemplateTransport(provider, rendered);

    if (rendered.text || rendered.title || rendered.buttons.length) {
      if (transport.mode === 'POLL_COMPAT') {
        result = await this.sendBaileysPollCompatibility(runtime, data, rendered, template, transport);
      } else if (transport.mode === 'TEXT_COMPAT') {
        result = await this.sendTextCompatibility(
          runtime,
          data,
          rendered,
          template,
          transport.provider,
          transport.compatibilityTransport || 'GENERIC_TEXT',
          transport.warnings.join(' ') || 'Provider requires textual compatibility transport.',
        );
      } else if (transport.mode === 'INTERACTIVE') {
        result = await this.sendInteractiveWithFallback(transport.provider, runtime, data, rendered, template);
      } else if (transport.mode === 'TEXT') {
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
          provider: transport.provider,
          templateName: data.name,
          language,
          category: template.category,
          mode: transport.mode,
          buttonCount: 0,
          interactionCount: interactions.length,
          fallback: false,
        });
      } else {
        throw new BadRequestException(
          `Template transport ${transport.mode} cannot be executed locally for provider ${transport.provider}`,
        );
      }

      await this.registerInteractionSession(instanceRow.id, template, data, result, rendered);
    } else {
      result = { templateExecution: { engine: 'CONNECT_TEMPLATE_ENGINE', mode: 'INTERACTION_ONLY' } };
    }

    await this.sendRenderedInteractions(instanceRow.id, runtime, data, provider, template, rendered, transport);
    await this.sendMicroAppAutoLaunch(runtime, data, autoLaunch);
    return result;
  }

  private async prepareMicroAppAutoLaunch(
    instance: InstanceDto,
    instanceId: string,
    template: any,
    data: SendTemplateDto,
    baseVariables: Record<string, unknown>,
  ) {
    const policy = resolveMicroAppAutoLaunch(template?.policy);
    if (!policy || !this.microAppSessionCreator || !template) return null;

    const contact = await this.resolveWhatsappContact(instanceId, data.number);
    const initialContext = buildMicroAppRuntimeContext({
      appKey: policy.appKey,
      url: '',
      number: data.number,
      contactName: contact.name,
      remoteJid: contact.remoteJid,
    });
    const sessionVariables = mergeRuntimeVariables(baseVariables, initialContext);
    const session = await this.microAppSessionCreator(instance, {
      templateName: data.name,
      language: data.language || 'pt_BR',
      appKey: policy.appKey,
      number: data.number,
      variables: sessionVariables,
      ttlSeconds: policy.ttlSeconds,
    });
    const runtimeContext = buildMicroAppRuntimeContext({
      appKey: policy.appKey,
      url: session.url,
      expiresAt: session.expiresAt,
      number: data.number,
      contactName: contact.name,
      remoteJid: contact.remoteJid,
    });
    return {
      policy,
      session,
      variables: mergeRuntimeVariables(sessionVariables, runtimeContext),
    };
  }

  private async resolveWhatsappContact(instanceId: string, number: string) {
    const normalized = normalizeWhatsappNumber(number);
    if (!normalized) return { name: 'Contato WhatsApp', remoteJid: undefined as string | undefined };
    const candidates = candidateRemoteJids(number);
    const contact = await this.prisma.contact.findFirst({
      where: {
        instanceId,
        OR: [{ remoteJid: { in: candidates } }, { remoteJid: { startsWith: normalized } }],
      },
      select: { pushName: true, remoteJid: true },
    });
    const chat = await this.prisma.chat.findFirst({
      where: {
        instanceId,
        OR: [{ remoteJid: { in: candidates } }, { remoteJid: { startsWith: normalized } }],
      },
      select: { name: true, remoteJid: true },
    });
    return {
      name: contact?.pushName || chat?.name || normalized,
      remoteJid: contact?.remoteJid || chat?.remoteJid || candidates[0],
    };
  }

  private async sendMicroAppAutoLaunch(runtime: any, data: SendTemplateDto, autoLaunch: any) {
    if (!autoLaunch?.session?.url) return;

    if (autoLaunch.policy.launchMode !== 'LINK' && typeof runtime.buttonMessage === 'function') {
      try {
        return await runtime.buttonMessage({
          number: data.number,
          title: autoLaunch.policy.messageText || 'Mini App disponível',
          description: 'Abra a experiência segura do Connect|API.',
          footer: 'Connect|API',
          buttons: [
            {
              type: 'url',
              displayText: autoLaunch.policy.buttonText || 'Abrir Mini App',
              url: autoLaunch.session.url,
            },
          ],
          delay: data.delay,
          quoted: data.quoted,
          mentionsEveryOne: data.mentionsEveryOne,
          mentioned: data.mentioned,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        this.logger.warn(`MICRO_APP_CTA_FALLBACK: ${reason}`);
      }
    }

    return runtime.textMessage({
      number: data.number,
      text: `${autoLaunch.policy.messageText}
${autoLaunch.session.url}`,
      delay: data.delay,
      quoted: data.quoted,
      linkPreview: autoLaunch.policy.linkPreview,
      mentionsEveryOne: data.mentionsEveryOne,
      mentioned: data.mentioned,
    });
  }

  public async preview(instance: InstanceDto, data: any) {
    const runtime = this.waMonitor.waInstances[instance.instanceName];
    if (!runtime) throw new NotFoundException(`Instance ${instance.instanceName} not found`);

    const instanceRow = await this.prisma.instance.findUnique({
      where: { name: instance.instanceName },
      select: { id: true, integration: true },
    });
    if (!instanceRow) throw new NotFoundException(`Instance ${instance.instanceName} not found`);

    const provider = instance.integration || instanceRow.integration || runtime.instance?.integration;
    const language = data.language || 'pt_BR';
    const variables = (data.variables || {}) as Record<string, unknown>;
    let persisted = false;
    let template: any = null;
    let definition: any;
    let policy: any = data.policy || {};

    if (Array.isArray(data.components)) {
      definition = { components: data.components };
    } else {
      template = await this.prisma.template.findFirst({
        where: { instanceId: instanceRow.id, name: data.name, language },
      });
      if (!template) throw new NotFoundException(`Template ${data.name} (${language}) not found for this instance`);
      definition = template.template || {};
      policy = template.policy || {};
      persisted = true;
    }

    const baseRendered = renderTemplateDefinition(definition, [], variables);
    const rendered: TemplateRenderEnvelope = {
      ...baseRendered,
      interactions: renderInteractionModelV2(policy, variables),
    };
    const transport = planTemplateTransport(provider, rendered);

    return {
      provider: transport.provider,
      persisted,
      capabilities: this.capabilities(provider),
      transport,
      plan: transport,
      rendered,
      sideEffectFree: true,
    };
  }

  public capabilities(provider?: string) {
    return getProviderTemplateCapabilities(provider);
  }

  private async sendBaileysPollCompatibility(
    runtime: any,
    data: SendTemplateDto,
    rendered: RenderedTemplate,
    template: any,
    transport: TemplateTransportPlan,
  ) {
    if (typeof runtime.pollMessage !== 'function') {
      return this.sendTextCompatibility(
        runtime,
        data,
        rendered,
        template,
        transport.provider,
        'BAILEYS_TEXT',
        'Baileys runtime does not expose pollMessage; using textual compatibility transport.',
      );
    }

    try {
      const result = await runtime.pollMessage({
        number: data.number,
        name: this.pollPrompt(rendered),
        selectableCount: 1,
        values: rendered.buttons.map((button) => String(button.displayText)),
        delay: data.delay,
        quoted: data.quoted,
        linkPreview: data.linkPreview,
        mentionsEveryOne: data.mentionsEveryOne,
        mentioned: data.mentioned,
      });
      this.attachDiagnostics(result, {
        provider: transport.provider,
        templateName: data.name,
        language: data.language || 'pt_BR',
        category: template.category,
        mode: transport.mode,
        buttonCount: rendered.buttons.length,
        fallback: false,
        compatibilityTransport: transport.compatibilityTransport,
      });
      return result;
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Baileys poll compatibility for template ${data.name} failed; using text fallback: ${reason}`);
      return this.sendTextCompatibility(runtime, data, rendered, template, transport.provider, 'BAILEYS_TEXT', reason);
    }
  }

  private async sendTextCompatibility(
    runtime: any,
    data: SendTemplateDto,
    rendered: RenderedTemplate,
    template: any,
    provider: string,
    compatibilityTransport: string,
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
      provider,
      templateName: data.name,
      language: data.language || 'pt_BR',
      category: template.category,
      mode: 'TEXT_COMPAT',
      buttonCount: rendered.buttons.length,
      fallback: true,
      fallbackReason: reason,
      compatibilityTransport,
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
    provider: string,
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
        provider,
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
        provider,
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

  private async sendRenderedInteractions(
    instanceId: string,
    runtime: any,
    data: SendTemplateDto,
    provider: string,
    template: any,
    rendered: TemplateRenderEnvelope,
    transport: TemplateTransportPlan,
  ) {
    const interactions = rendered.interactions || [];
    for (const interaction of interactions) {
      const planned = transport.interactions.find((item) => item.id === interaction.id);
      if (!planned) continue;

      let result: any;
      let fallback = false;
      let fallbackReason: string | undefined;
      try {
        if (
          (planned.compatibilityTransport === 'META_LIST' || planned.compatibilityTransport === 'BAILEYS_LIST') &&
          interaction.type === 'list'
        ) {
          result = await runtime.listMessage(this.listPayload(data, interaction));
        } else if (
          (planned.compatibilityTransport === 'META_INTERACTIVE_CHOICE' ||
            planned.compatibilityTransport === 'BAILEYS_LIST') &&
          interaction.type === 'choice' &&
          interaction.options.length > 3 &&
          typeof runtime.listMessage === 'function'
        ) {
          result = await runtime.listMessage(this.choiceAsListPayload(data, interaction));
        } else if (
          (planned.compatibilityTransport === 'META_INTERACTIVE_CHOICE' ||
            planned.compatibilityTransport === 'CONNECT_BUTTONS' ||
            planned.compatibilityTransport === 'BAILEYS_BUTTONS') &&
          interaction.type === 'choice' &&
          typeof runtime.buttonMessage === 'function'
        ) {
          result = await runtime.buttonMessage(this.choiceButtonPayload(data, interaction));
        } else if (
          planned.compatibilityTransport === 'BAILEYS_OFFICIAL_POLL' &&
          interaction.type === 'choice' &&
          typeof runtime.pollMessage === 'function'
        ) {
          result = await runtime.pollMessage({
            number: data.number,
            name: this.interactionPrompt(interaction),
            selectableCount: interaction.mode === 'MULTIPLE' ? interaction.options.length : 1,
            values: interaction.options.map((option) => option.title),
            delay: data.delay,
            quoted: data.quoted,
          });
        } else {
          fallback = true;
          result = await runtime.textMessage({
            number: data.number,
            text: interactionTextFallback(interaction),
            delay: data.delay,
            quoted: data.quoted,
            linkPreview: data.linkPreview,
          });
        }
      } catch (error) {
        fallback = true;
        fallbackReason = error instanceof Error ? error.message : String(error);
        this.logger.warn(
          `Interaction ${interaction.id} for template ${data.name} failed; using text fallback: ${fallbackReason}`,
        );
        result = await runtime.textMessage({
          number: data.number,
          text: interactionTextFallback(interaction),
          delay: data.delay,
          quoted: data.quoted,
          linkPreview: data.linkPreview,
        });
      }

      this.attachInteractionDiagnostics(result, {
        provider,
        templateName: data.name,
        interactionId: interaction.id,
        interactionType: interaction.type,
        mode: fallback ? 'TEXT_COMPAT' : planned.mode,
        compatibilityTransport: fallback ? 'TEXT_FALLBACK' : planned.compatibilityTransport,
        fallback,
        fallbackReason,
      });
      await this.registerInteractionSession(instanceId, template, data, result, {
        text: '',
        buttons: [],
        interactions: [interaction],
      });
    }
  }

  private listPayload(data: SendTemplateDto, interaction: Extract<RenderedTemplateInteraction, { type: 'list' }>) {
    return {
      number: data.number,
      title: interaction.title || data.name,
      description: interaction.body,
      footerText: interaction.footer,
      buttonText: interaction.buttonText,
      sections: interaction.sections.map((section) => ({
        title: section.title || 'Opções',
        rows: section.rows.map((row) => ({
          rowId: row.id,
          title: row.title,
          description: row.description || '',
        })),
      })),
      delay: data.delay,
      quoted: data.quoted,
    };
  }

  private choiceAsListPayload(
    data: SendTemplateDto,
    interaction: Extract<RenderedTemplateInteraction, { type: 'choice' }>,
  ) {
    return {
      number: data.number,
      title: interaction.title || data.name,
      description: interaction.body,
      footerText: interaction.footer,
      buttonText: 'Ver opções',
      sections: [
        {
          title: 'Opções',
          rows: interaction.options.map((option) => ({
            rowId: option.id,
            title: option.title,
            description: option.description || '',
          })),
        },
      ],
      delay: data.delay,
      quoted: data.quoted,
    };
  }

  private choiceButtonPayload(
    data: SendTemplateDto,
    interaction: Extract<RenderedTemplateInteraction, { type: 'choice' }>,
  ) {
    return {
      number: data.number,
      title: interaction.title || data.name,
      description: interaction.body,
      footer: interaction.footer,
      buttons: interaction.options.slice(0, 3).map((option) => ({
        type: 'reply',
        id: option.id,
        displayText: option.title,
      })),
      delay: data.delay,
      quoted: data.quoted,
    };
  }

  private interactionPrompt(interaction: RenderedTemplateInteraction) {
    return (
      ([interaction.title, interaction.body, interaction.footer].filter(Boolean) as string[]).join('\n\n').trim() ||
      'Escolha uma opção'
    );
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

  private attachInteractionDiagnostics(result: any, diagnostics: Record<string, unknown>) {
    if (!result || typeof result !== 'object') return;
    result.interactionExecution = {
      engine: 'CONNECT_INTERACTION_MODEL_V2',
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

  private actionsWithRenderedAliases(actions: unknown, rendered?: TemplateRenderEnvelope): unknown {
    if (!actions || typeof actions !== 'object') return actions;

    const labels = new Map<string, string>();
    for (const button of rendered?.buttons || []) {
      if (button.type === 'reply' && button.id && button.displayText) {
        labels.set(String(button.id), String(button.displayText));
      }
    }
    for (const interaction of rendered?.interactions || []) {
      const rows =
        interaction.type === 'list' ? interaction.sections.flatMap((section) => section.rows) : interaction.options;
      for (const row of rows) {
        if (row.id && row.title) labels.set(String(row.id), String(row.title));
      }
    }
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
    rendered?: TemplateRenderEnvelope,
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
