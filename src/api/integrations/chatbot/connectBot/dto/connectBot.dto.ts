import { BaseChatbotDto, BaseChatbotSettingDto } from '../../base-chatbot.dto';

export class ConnectBotDto extends BaseChatbotDto {
  apiUrl: string;
  apiKey: string;
}

export class ConnectBotSettingDto extends BaseChatbotSettingDto {
  botIdFallback?: string;
}
