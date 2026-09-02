import { InstanceDto } from '@api/dto/instance.dto';
import { PrismaRepository } from '@api/repository/repository.service';
import { Events } from '@api/types/wa.types';
import { Logger } from '@config/logger.config';

import { ActionExecutionService } from './action-execution.service';
import { resolveActionValue } from './action-value-resolver';
import { WAMonitoringService } from './monitor.service';
import { RecipeService } from './recipe.service';
import { TemplateEngineService } from './template-engine.service';

type InteractionBinding = {
  id: string;
  matchTitle?: string;
  type: 'ACTION' | 'RECIPE' | 'NONE';
  key?: string;
  input?: Record<string, unknown>;
  confirmOnInteraction?: boolean;
  keepSessionOpen?: boolean;
  retryOnError?: boolean;
  response?: Record<string, unknown> | null;
  onError?: Record<string, unknown> | null;
};

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
    const interaction = message?.interaction;
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
    if (!binding || binding.type === 'NONE' || !binding.key) return;

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

    const baseContext = {
      session: {
        id: session.id,
        templateName: session.templateName,
        language: session.language,
        variables: (session.variables as any) || {},
        remoteJid: session.remoteJid,
      },
      interaction,
      message: {
        id: inboundMessageId,
        remoteJid: message?.key?.remoteJid,
        pushName: message?.pushName,
      },
      input: (session.variables as any) || {},
    };

    try {
      const input = resolveActionValue(binding.input || (session.variables as any) || {}, baseContext) as Record<
        string,
        unknown
      >;
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
          data: { status: 'WAITING_STRONG_CONFIRMATION' },
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
          lastError: null,
        },
      });
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      this.logger.error(`Interaction ${interaction.id} failed on ${eventData.instanceName}: ${messageText}`);

      if (binding.onError) {
        try {
          await this.sendConfiguredResponse(instance, session.remoteJid, binding.onError, {
            ...baseContext,
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
    return (
      this.bindings(actions).find((binding) => String(binding.id || '') === id) ||
      this.bindings(actions).find(
        (binding) => binding.matchTitle && String(binding.matchTitle).trim().toLowerCase() === title,
      ) ||
      null
    );
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
