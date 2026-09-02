export interface MetaCloudEventData {
  instanceName: string;
  origin?: string;
  event: string;
  data: any;
  serverUrl?: string;
  dateTime?: string;
  sender?: string;
  apiKey?: string;
  local?: boolean;
  integration?: string[];
  extra?: Record<string, any>;
}

export interface MetaCloudWebhookEnvelope {
  webhookUrl: string;
  payload: Record<string, any>;
  context: {
    instanceId: string;
    instanceName: string;
    provider: string;
    phoneNumberId: string;
    graphVersion?: string;
    messageId?: string;
  };
  attempt: number;
}
