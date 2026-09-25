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

export class FindHubLocateDto {
  timeoutMs?: number;
}

export class FindHubTrackingDto {
  intervalSeconds?: number;
  timeoutMs?: number;
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

export class FindHubSettingsDto {
  intervalSeconds?: number;
  timeoutMs?: number;
  staleAfterSeconds?: number;
  historyEnabled?: boolean;
  retentionDays?: number;
  reconciliationEnabled?: boolean;
  reconciliationOnBoot?: boolean;
  reconciliationPeriodicEnabled?: boolean;
  reconciliationPeriodSeconds?: number;
  reconciliationMinGapSeconds?: number;
  reconciliationAttempts?: number;
}

export class FindHubReconciliationDto {
  from?: string;
  to?: string;
  attempts?: number;
  timeoutMs?: number;
}
export class FindHubTraccarConnectionDto {
  mode: 'disabled' | 'internal' | 'external';
  url?: string;
  receiverUrl?: string;
  token?: string;
  timeoutMs?: number;
}

export class FindHubDeviceAvatarDto {
  avatar: string | null;
}
