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
