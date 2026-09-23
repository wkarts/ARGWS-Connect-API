import { FindHubFcmCredentials } from '@api/integrations/channel/findhub/findhub.types';

export class FindHubAuthStartDto {
  email: string;
}

export class FindHubCredentialBundleDto {
  sessionId: string;
  bridgeToken: string;
  email: string;
  androidId: string;
  accountToken: string;
  sharedKey: string;
  fcm?: FindHubFcmCredentials;
}

export class FindHubTrackingDto {
  intervalSeconds?: number;
}

export class FindHubTraccarDto {
  enabled: boolean;
  url: string;
  deviceId: string;
}

export class FindHubBrowserProofDto {
  sessionId: string;
  bridgeToken: string;
}
export class FindHubBrowserExchangeDto extends FindHubBrowserProofDto {
  oauthToken: string;
}
export class FindHubBrowserCompleteDto extends FindHubBrowserProofDto {
  vaultKeys: string;
}

export class FindHubMonitoringDto {
  historyEnabled: boolean;
  historyRetentionDays: number;
  defaultIntervalSeconds: number;
  locationTimeoutMs: number;
  uiRefreshSeconds: number;
}
export class FindHubLocateDto {
  timeoutMs?: number;
}
export class FindHubDeviceSettingsDto {
  intervalSeconds: number;
  timeoutMs: number | null;
}
