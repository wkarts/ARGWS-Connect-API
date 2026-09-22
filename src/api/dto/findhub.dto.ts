export class FindHubAuthStartDto { email: string; }
export class FindHubAuthExchangeDto { sessionId: string; bridgeToken: string; email: string; oauthToken: string; }
export class FindHubAuthVaultDto { sessionId: string; bridgeToken: string; sharedKey?: string; vaultKeys?: any; }
export class FindHubTrackingDto { intervalSeconds?: number; }
export class FindHubTraccarDto { enabled: boolean; url: string; deviceId: string; }
