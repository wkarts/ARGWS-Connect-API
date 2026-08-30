import { BaseChatbotDto, BaseChatbotSettingDto } from '../../base-chatbot.dto';

export class ConnectAIDto extends BaseChatbotDto {
  agentUrl?: string;
  apiKey?: string;
}

export class ConnectAISettingDto extends BaseChatbotSettingDto {
  connectAIIdFallback?: string;
}
