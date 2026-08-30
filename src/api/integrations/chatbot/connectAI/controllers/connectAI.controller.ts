import { InstanceDto } from '@api/dto/instance.dto';
import { ConnectAIDto } from '@api/integrations/chatbot/connectAI/dto/connectAI.dto';
import { ConnectAIService } from '@api/integrations/chatbot/connectAI/services/connectAI.service';
import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { configService, ConnectAI } from '@config/env.config';
import { Logger } from '@config/logger.config';
import { BadRequestException } from '@exceptions';
import { ConnectAI as ConnectAIModel, IntegrationSession } from '@prisma/client';

import { BaseChatbotController } from '../../base-chatbot.controller';

export class ConnectAIController extends BaseChatbotController<ConnectAIModel, ConnectAIDto> {
  constructor(
    private readonly connectAIService: ConnectAIService,
    prismaRepository: PrismaRepository,
    waMonitor: WAMonitoringService,
  ) {
    super(prismaRepository, waMonitor);

    this.botRepository = this.prismaRepository.connectAI;
    this.settingsRepository = this.prismaRepository.connectAISetting;
    this.sessionRepository = this.prismaRepository.integrationSession;
  }

  public readonly logger = new Logger('ConnectAIController');
  protected readonly integrationName = 'ConnectAI';

  integrationEnabled = configService.get<ConnectAI>('CONNECT_AI').ENABLED;
  botRepository: any;
  settingsRepository: any;
  sessionRepository: any;
  userMessageDebounce: { [key: string]: { message: string; timeoutId: NodeJS.Timeout } } = {};

  protected getFallbackBotId(settings: any): string | undefined {
    return settings?.connectAIIdFallback;
  }

  protected getFallbackFieldName(): string {
    return 'connectAIIdFallback';
  }

  protected getIntegrationType(): string {
    return 'connectAI';
  }

  protected getAdditionalBotData(data: ConnectAIDto): Record<string, any> {
    return {
      agentUrl: data.agentUrl,
      apiKey: data.apiKey,
    };
  }

  // Implementation for bot-specific updates
  protected getAdditionalUpdateFields(data: ConnectAIDto): Record<string, any> {
    return {
      agentUrl: data.agentUrl,
      apiKey: data.apiKey,
    };
  }

  // Implementation for bot-specific duplicate validation on update
  protected async validateNoDuplicatesOnUpdate(botId: string, instanceId: string, data: ConnectAIDto): Promise<void> {
    const checkDuplicate = await this.botRepository.findFirst({
      where: {
        id: {
          not: botId,
        },
        instanceId: instanceId,
        agentUrl: data.agentUrl,
        apiKey: data.apiKey,
      },
    });

    if (checkDuplicate) {
      throw new Error('ConnectAI already exists');
    }
  }

  // Override createBot to add ConnectAI-specific validation
  public async createBot(instance: InstanceDto, data: ConnectAIDto) {
    if (!this.integrationEnabled) throw new BadRequestException('ConnectAI is disabled');

    const instanceId = await this.prismaRepository.instance
      .findFirst({
        where: {
          name: instance.instanceName,
        },
      })
      .then((instance) => instance.id);

    // ConnectAI-specific duplicate check
    const checkDuplicate = await this.botRepository.findFirst({
      where: {
        instanceId: instanceId,
        agentUrl: data.agentUrl,
        apiKey: data.apiKey,
      },
    });

    if (checkDuplicate) {
      throw new Error('ConnectAI already exists');
    }

    // Let the base class handle the rest
    return super.createBot(instance, data);
  }

  // Process ConnectAI-specific bot logic
  protected async processBot(
    instance: any,
    remoteJid: string,
    bot: ConnectAIModel,
    session: IntegrationSession,
    settings: any,
    content: string,
    pushName?: string,
    msg?: any,
  ) {
    await this.connectAIService.process(instance, remoteJid, bot, session, settings, content, pushName, msg);
  }
}
