import { PrismaRepository } from '@api/repository/repository.service';
import { WAMonitoringService } from '@api/services/monitor.service';
import { Logger } from '@config/logger.config';
import { ConnectBot, IntegrationSession } from '@prisma/client';

import { BaseChatbotController } from '../../base-chatbot.controller';
import { ConnectBotDto } from '../dto/connectBot.dto';
import { ConnectBotService } from '../services/connectBot.service';

export class ConnectBotController extends BaseChatbotController<ConnectBot, ConnectBotDto> {
  constructor(
    private readonly connectBotService: ConnectBotService,
    prismaRepository: PrismaRepository,
    waMonitor: WAMonitoringService,
  ) {
    super(prismaRepository, waMonitor);

    this.botRepository = this.prismaRepository.connectBot;
    this.settingsRepository = this.prismaRepository.connectBotSetting;
    this.sessionRepository = this.prismaRepository.integrationSession;
  }

  public readonly logger = new Logger('ConnectBotController');
  protected readonly integrationName = 'ConnectBot';

  integrationEnabled = true; // Set to true by default or use config value if available
  botRepository: any;
  settingsRepository: any;
  sessionRepository: any;
  userMessageDebounce: { [key: string]: { message: string; timeoutId: NodeJS.Timeout } } = {};

  // Implementation of abstract methods required by BaseChatbotController

  protected getFallbackBotId(settings: any): string | undefined {
    return settings?.botIdFallback;
  }

  protected getFallbackFieldName(): string {
    return 'botIdFallback';
  }

  protected getIntegrationType(): string {
    return 'connect';
  }

  protected getAdditionalBotData(data: ConnectBotDto): Record<string, any> {
    return {
      apiUrl: data.apiUrl,
      apiKey: data.apiKey,
    };
  }

  // Implementation for bot-specific updates
  protected getAdditionalUpdateFields(data: ConnectBotDto): Record<string, any> {
    return {
      apiUrl: data.apiUrl,
      apiKey: data.apiKey,
    };
  }

  // Implementation for bot-specific duplicate validation on update
  protected async validateNoDuplicatesOnUpdate(botId: string, instanceId: string, data: ConnectBotDto): Promise<void> {
    const checkDuplicate = await this.botRepository.findFirst({
      where: {
        id: {
          not: botId,
        },
        instanceId: instanceId,
        apiUrl: data.apiUrl,
        apiKey: data.apiKey,
      },
    });

    if (checkDuplicate) {
      throw new Error('Connect Bot already exists');
    }
  }

  // Process bot-specific logic
  protected async processBot(
    instance: any,
    remoteJid: string,
    bot: ConnectBot,
    session: IntegrationSession,
    settings: any,
    content: string,
    pushName?: string,
    msg?: any,
  ) {
    await this.connectBotService.process(instance, remoteJid, bot, session, settings, content, pushName, msg);
  }
}
