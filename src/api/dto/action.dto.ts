export type ActionConfirmation = 'NONE' | 'CONFIRM' | 'STRONG';
export type ActionHttpMethod = 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';

export class IntegrationActionDto {
  actionKey: string;
  name: string;
  description?: string;
  method: ActionHttpMethod;
  baseUrl: string;
  path: string;
  credentialRef?: string;
  headers?: Record<string, string>;
  requestTemplate?: Record<string, unknown>;
  inputSchema?: Record<string, unknown>;
  outputMapping?: Record<string, unknown>;
  timeoutMs?: number;
  confirmation?: ActionConfirmation;
  allowPrivateNetwork?: boolean;
  enabled?: boolean;
}

export class ActionExecuteDto {
  actionKey: string;
  input?: Record<string, unknown>;
  confirmed?: boolean;
  dryRun?: boolean;
}

export class ActionDeleteDto {
  actionKey: string;
}
