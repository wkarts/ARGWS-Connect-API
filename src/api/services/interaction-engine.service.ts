import { InstanceDto } from '@api/dto/instance.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { Events } from '@api/types/wa.types';
import { Logger } from '@config/logger.config';

import { ActionExecutionService } from './action-execution.service';
import { resolveActionValue } from './action-value-resolver';
import { CapturedLocation, evaluateLocationPolicy, LocationPolicy } from './geolocation-policy';
import { extractBaileysPollInteraction } from './interaction-normalizer';
import { WAMonitoringService } from './monitor.service';
import { RecipeService } from './recipe.service';
import { TemplateEngineService } from './template-engine.service';

type InteractionCapture = {
  path: string;
  value?: unknown;
  includePayload?: boolean;
};

type InteractionBinding = {
  id: string;
  matchTitle?: string;
  interactionType?: string;
  type: 'ACTION' | 'RECIPE' | 'NONE';
  key?: string;
  input?: Record<string, unknown>;
  capture?: InteractionCapture;
  locationPolicy?: LocationPolicy;
  confirmOnInteraction?: boolean;
  keepSessionOpen?: boolean;
  retryOnError?: boolean;
  response?: Record<string, unknown> | null;
  onError?: Record<string, unknown> | null;
};

const CAPTURE_PATH = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

export class InteractionEngineService {
  private readonly logger = new Logger('InteractionEngineService');

  constructor(
    private readonly prisma: PrismaRepository,
    private readonly actionExecution: ActionExecutionService,
    private readonly recipeService: RecipeService,
    private readonly templateEngine: TemplateEngineService,
    private readonly waMonitor: WAMonitoringService,
  ) {}

  public async handleEvent(eventData: { instanceName: string; event: string; data: object }): Promise<void> {
    if (eventData.event !== Events.MESSAGES_UPSERT) return;

    const message = eventData.data as any;
    const interaction = message?.interaction || extractBaileysPollInteraction(message);
    if (!interaction?.id || message?.key?.fromMe) return;

    const instanceRow = await this.prisma.instance.findUnique({
      where: { name: eventData.instanceName },
      select: { id: true, name: true, integration: true },
    });
    if (!instanceRow) return;

    const session = await this.findSession(instanceRow.id, message, interaction);
    if (!session) return;

    if (session.expiresAt && session.expiresAt.getTime() <= Date.now()) {
      await this.prisma.templateInteractionSession.update({
        where: { id: session.id },
        data: { status: 'EXPIRED' },
      });
      return;
    }

    const binding = this.findBinding(session.actions, interaction);
    if (!binding) return;
    const isExecutable = binding.type !== 'NONE' && Boolean(binding.key);
    if (!isExecutable && !binding.capture && !binding.locationPolicy) return;

    const inboundMessageId = String(message?.key?.id || '');
    const claimed = await this.prisma.templateInteractionSession.updateMany({
      where: { id: session.id, status: 'OPEN' },
      data: {
        status: 'PROCESSING',
        inboundMessageId: inboundMessageId || null,
        lastError: null,
      },
    });
    if (claimed.count === 0) return;

    const instance: InstanceDto = {
      instanceName: instanceRow.name,
      instanceId: instanceRow.id,
      integration: instanceRow.integration,
    };

    try {
      const previousVariables = ((session.variables as any) || {}) as Record<string, unknown>;
      const variables = this.captureInteraction(previousVariables, binding, interaction);
      const locationValidation = this.validateLocation(binding, interaction);
      if (locationValidation) {
        interaction.payload = { ...(interaction.payload || {}), locationValidation };
      }

      if (binding.capture || locationValidation) {
        await this.prisma.templateInteractionSession.update({
          where: { id: session.id },
          data: { variables: variables as any },
        });
      }

      const baseContext = {
        session: {
          id: session.id,
          templateName: session.templateName,
          language: session.language,
          variables,
          remoteJid: session.remoteJid,
        },
        interaction,
        message: {
          id: inboundMessageId,
          remoteJid: message?.key?.remoteJid,
          pushName: message?.pushName,
        },
        input: variables,
      };

      if (!isExecutable) {
        if (binding.response) {
          await this.sendConfiguredResponse(instance, session.remoteJid, binding.response, baseContext);
        }
        await this.prisma.templateInteractionSession.update({
          where: { id: session.id },
          data: {
            status: binding.keepSessionOpen === false ? 'COMPLETED' : 'OPEN',
            variables: variables as any,
            lastError: null,
          },
        });
        return;
      }

      const input = resolveActionValue(binding.input || variables, baseContext) as Record<string, unknown>;
      const confirmation = await this.resolveConfirmation(instanceRow.id, binding);

      if (confirmation === 'STRONG') {
        await this.sendConfiguredResponse(
          instance,
          session.remoteJid,
          {
            type: 'TEXT',
            text: 'Esta operação exige confirmação reforçada no painel antes de ser executada.',
          },
          baseContext,
        );
        await this.prisma.templateInteractionSession.update({
          where: { id: session.id },
          data: {
            status: 'WAITING_STRONG_CONFIRMATION',
            variables: variables as any,
            strongBindingId: binding.id,
            strongInput: input as any,
            strongRequestedAt: new Date(),
            strongDecisionAt: null,
            strongDecisionBy: null,
            strongDecisionReason: null,
          },
        });
        return;
      }

      const confirmed = confirmation === 'CONFIRM' ? binding.confirmOnInteraction !== false : false;
      let result: any;

      if (binding.type === 'RECIPE') {
        result = await this.recipeService.execute(instance, {
          recipeKey: binding.key,
          input,
          confirmed,
          dryRun: false,
        });
      } else {
        result = await this.actionExecution.execute(instance, {
          actionKey: binding.key,
          input,
          confirmed,
          dryRun: false,
        });
      }

      const resultContext = { ...baseContext, result };
      if (binding.response) {
        await this.sendConfiguredResponse(instance, session.remoteJid, binding.response, resultContext);
      }

      await this.prisma.templateInteractionSession.update({
        where: { id: session.id },
        data: {
          status: binding.keepSessionOpen ? 'OPEN' : 'COMPLETED',
          variables: variables as any,
          lastError: null,
        },
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.logger.error(`Interaction ${interaction.id} failed on ${eventData.instanceName}: ${messageText}`);

      if (binding.onError) {
        try {
          await this.sendConfiguredResponse(instance, session.remoteJid, binding.onError, {
            session: {
              id: session.id,
              templateName: session.templateName,
              language: session.language,
              variables: (session.variables as any) || {},
              remoteJid: session.remoteJid,
            },
            interaction,
            error: { message: messageText },
          });
        } catch (responseError) {
          this.logger.error(`Interaction error response failed: ${String(responseError)}`);
        }
      }

      await this.prisma.templateInteractionSession.update({
        where: { id: session.id },
        data: {
          status: binding.retryOnError ? 'OPEN' : 'FAILED',
          lastError: messageText.slice(0, 4000),
        },
      });
    }
  }

  public async listStrongConfirmations(instanceName: string) {
    const instance = await this.prisma.instance.findUnique({ where: { name: instanceName }, select: { id: true } });
    if (!instance) return [];
    return this.prisma.templateInteractionSession.findMany({
      where: { instanceId: instance.id, status: 'WAITING_STRONG_CONFIRMATION' },
      orderBy: { strongRequestedAt: 'asc' },
      select: {
        id: true,
        remoteJid: true,
        templateName: true,
        language: true,
        strongBindingId: true,
        strongInput: true,
        strongRequestedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }

  public async approveStrongConfirmation(instanceName: string, sessionId: string, actor: string, reason?: string) {
    return this.decideStrongConfirmation(instanceName, sessionId, 'APPROVE', actor, reason);
  }

  public async rejectStrongConfirmation(instanceName: string, sessionId: string, actor: string, reason?: string) {
    return this.decideStrongConfirmation(instanceName, sessionId, 'REJECT', actor, reason);
  }

  private async decideStrongConfirmation(
    instanceName: string,
    sessionId: string,
    decision: 'APPROVE' | 'REJECT',
    actor: string,
    reason?: string,
  ) {
    const instanceRow = await this.prisma.instance.findUnique({
      where: { name: instanceName },
      select: { id: true, name: true, integration: true },
    });
    if (!instanceRow) throw new Error(`Instance ${instanceName} was not found.`);

    const session = await this.prisma.templateInteractionSession.findFirst({
      where: { id: sessionId, instanceId: instanceRow.id },
    });
    if (!session || session.status !== 'WAITING_STRONG_CONFIRMATION') {
      throw new Error('Strong confirmation is no longer pending.');
    }

    if (decision === 'REJECT') {
      const changed = await this.prisma.templateInteractionSession.updateMany({
        where: { id: session.id, status: 'WAITING_STRONG_CONFIRMATION' },
        data: {
          status: 'REJECTED',
          strongDecisionAt: new Date(),
          strongDecisionBy: actor,
          strongDecisionReason: reason || null,
        },
      });
      if (!changed.count) throw new Error('Strong confirmation was already decided.');
      const instance: InstanceDto = {
        instanceName: instanceRow.name,
        instanceId: instanceRow.id,
        integration: instanceRow.integration,
      };
      await this.sendConfiguredResponse(
        instance,
        session.remoteJid,
        { type: 'TEXT', text: 'Operação não autorizada pelo responsável.' },
        { session: { id: session.id } },
      );
      return { sessionId: session.id, status: 'REJECTED', actor, reason: reason || null };
    }

    const claimed = await this.prisma.templateInteractionSession.updateMany({
      where: { id: session.id, status: 'WAITING_STRONG_CONFIRMATION' },
      data: {
        status: 'PROCESSING_STRONG_CONFIRMATION',
        strongDecisionAt: new Date(),
        strongDecisionBy: actor,
        strongDecisionReason: reason || null,
        lastError: null,
      },
    });
    if (!claimed.count) throw new Error('Strong confirmation was already decided.');

    const binding = this.bindings(session.actions).find((item) => item.id === session.strongBindingId);
    if (!binding || binding.type === 'NONE' || !binding.key) {
      await this.prisma.templateInteractionSession.update({
        where: { id: session.id },
        data: { status: 'FAILED', lastError: 'Strong binding is unavailable.' },
      });
      throw new Error('Strong binding is unavailable.');
    }

    const instance: InstanceDto = {
      instanceName: instanceRow.name,
      instanceId: instanceRow.id,
      integration: instanceRow.integration,
    };
    const input = ((session.strongInput as any) || {}) as Record<string, unknown>;
    try {
      let result: any;
      if (binding.type === 'RECIPE') {
        result = await this.recipeService.execute(instance, {
          recipeKey: binding.key,
          input,
          confirmed: true,
          dryRun: false,
        });
      } else {
        result = await this.actionExecution.execute(instance, {
          actionKey: binding.key,
          input,
          confirmed: true,
          dryRun: false,
        });
      }
      if (binding.response) {
        await this.sendConfiguredResponse(instance, session.remoteJid, binding.response, {
          session: { id: session.id, variables: (session.variables as any) || {} },
          result,
        });
      }
      await this.prisma.templateInteractionSession.update({
        where: { id: session.id },
        data: { status: 'COMPLETED', lastError: null },
      });
      return { sessionId: session.id, status: 'COMPLETED', actor, reason: reason || null, result };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await this.prisma.templateInteractionSession.update({
        where: { id: session.id },
        data: { status: 'FAILED', lastError: messageText.slice(0, 4000) },
      });
      throw error;
    }
  }

  private async findSession(instanceId: string, message: any, interaction: any) {
    const contextMessageId = interaction.contextMessageId ? String(interaction.contextMessageId) : '';
    if (contextMessageId) {
      const direct = await this.prisma.templateInteractionSession.findUnique({
        where: {
          instanceId_outboundMessageId: {
            instanceId,
            outboundMessageId: contextMessageId,
          },
        },
      });
      if (direct) return direct;
    }

    const remoteJid = String(message?.key?.remoteJid || '');
    if (!remoteJid) return null;

    const candidates = await this.prisma.templateInteractionSession.findMany({
      where: { instanceId, remoteJid, status: 'OPEN' },
      orderBy: { createdAt: 'desc' },
      take: 8,
    });

    return candidates.find((candidate) => this.findBinding(candidate.actions, interaction)) || null;
  }

  private bindings(actions: unknown): InteractionBinding[] {
    if (!actions || typeof actions !== 'object') return [];
    const raw = actions as any;
    if (Array.isArray(raw.bindings)) return raw.bindings as InteractionBinding[];
    if (raw.interactions && typeof raw.interactions === 'object') {
      return Object.entries(raw.interactions).map(([id, binding]: [string, any]) => ({ id, ...binding }));
    }
    return [];
  }

  private findBinding(actions: unknown, interaction: any): InteractionBinding | null {
    const id = String(interaction?.id || '');
    const title = String(interaction?.title || '')
      .trim()
      .toLowerCase();
    const type = String(interaction?.type || '')
      .trim()
      .toLowerCase();
    const bindings = this.bindings(actions);
    return (
      bindings.find((binding) => String(binding.id || '') === id) ||
      bindings.find((binding) => binding.matchTitle && String(binding.matchTitle).trim().toLowerCase() === title) ||
      bindings.find(
        (binding) => binding.interactionType && String(binding.interactionType).trim().toLowerCase() === type,
      ) ||
      null
    );
  }

  private captureInteraction(
    previousVariables: Record<string, unknown>,
    binding: InteractionBinding,
    interaction: any,
  ): Record<string, unknown> {
    const variables = this.cloneObject(previousVariables);
    if (!binding.capture?.path) return variables;
    if (!CAPTURE_PATH.test(binding.capture.path)) throw new Error('Invalid interaction capture path.');

    const context = { interaction, input: variables, session: { variables } };
    let value: unknown;
    if (binding.capture.value !== undefined) {
      value = resolveActionValue(binding.capture.value, context);
    } else if (binding.capture.includePayload) {
      value = interaction?.payload || null;
    } else if (interaction?.payload && interaction.type === 'location') {
      value = interaction.payload;
    } else {
      value = { id: interaction?.id, title: interaction?.title, payload: interaction?.payload };
    }

    this.setPath(variables, binding.capture.path, value);
    return variables;
  }

  private validateLocation(binding: InteractionBinding, interaction: any) {
    if (!binding.locationPolicy) return null;
    if (interaction?.type !== 'location' && interaction?.type !== 'live_location') {
      throw new Error('LOCATION_REQUIRED');
    }

    const payload = interaction?.payload || {};
    const location: CapturedLocation = {
      source: 'WHATSAPP',
      latitude: Number(payload.latitude),
      longitude: Number(payload.longitude),
      address: payload.address ? String(payload.address) : undefined,
      name: payload.name ? String(payload.name) : undefined,
      capturedAt: new Date().toISOString(),
    };
    const validation = evaluateLocationPolicy(location, binding.locationPolicy);
    if (!validation.accepted) throw new Error(validation.reason);
    return validation;
  }

  private cloneObject(value: Record<string, unknown>) {
    try {
      return JSON.parse(JSON.stringify(value || {})) as Record<string, unknown>;
    } catch {
      return { ...value };
    }
  }

  private setPath(target: Record<string, unknown>, path: string, value: unknown) {
    const parts = path.split('.').filter(Boolean);
    let current: any = target;
    for (let index = 0; index < parts.length; index += 1) {
      const part = parts[index];
      if (index === parts.length - 1) {
        current[part] = value;
      } else {
        if (!current[part] || typeof current[part] !== 'object' || Array.isArray(current[part])) current[part] = {};
        current = current[part];
      }
    }
  }

  private async resolveConfirmation(instanceId: string, binding: InteractionBinding): Promise<string> {
    if (!binding.key) return 'NONE';
    if (binding.type === 'RECIPE') {
      const recipe = await this.prisma.recipe.findUnique({
        where: { instanceId_recipeKey: { instanceId, recipeKey: binding.key } },
        select: { confirmation: true },
      });
      return recipe?.confirmation || 'NONE';
    }
    if (binding.type === 'ACTION') {
      const action = await this.prisma.integrationAction.findUnique({
        where: { instanceId_actionKey: { instanceId, actionKey: binding.key } },
        select: { confirmation: true },
      });
      return action?.confirmation || 'NONE';
    }
    return 'NONE';
  }

  private async sendConfiguredResponse(
    instance: InstanceDto,
    remoteJid: string,
    response: Record<string, unknown>,
    context: Record<string, unknown>,
  ) {
    const type = String(response.type || 'TEXT').toUpperCase();
    if (type === 'NONE') return;

    if (type === 'TEMPLATE') {
      const name = String(resolveActionValue(response.name || '', context) || '');
      if (!name) return;
      const language = String(resolveActionValue(response.language || 'pt_BR', context) || 'pt_BR');
      const variables = resolveActionValue((response.variables as any) || {}, context) as Record<string, any>;
      await this.templateEngine.send(instance, {
        number: remoteJid,
        name,
        language,
        components: [],
        variables,
      });
      return;
    }

    const text = String(resolveActionValue(response.text || '', context) || '');
    if (!text) return;
    const runtime = this.waMonitor.waInstances[instance.instanceName];
    if (!runtime) return;
    await runtime.textMessage({ number: remoteJid, text }, true);
  }
}
