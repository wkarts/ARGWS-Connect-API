export type FindHubAuthState =
  | 'WAITING_AUTH'
  | 'WAITING_OAUTH_TOKEN'
  | 'WAITING_VAULT_KEY'
  | 'READY'
  | 'AUTH_REQUIRED'
  | 'ERROR';

export type FindHubRuntimeState = 'close' | 'connecting' | 'open';

export type FindHubDeviceType =
  | 'PHONE'
  | 'TABLET'
  | 'WATCH'
  | 'HEADPHONES'
  | 'EARBUDS'
  | 'TRACKER'
  | 'UNKNOWN';

export interface FindHubDevice {
  id: string;
  googleDeviceId: string;
  name: string;
  identifierType: 'ANDROID' | 'SPOT' | 'UNKNOWN';
  deviceType: FindHubDeviceType;
  manufacturer?: string;
  model?: string;
  imageUrl?: string;
  encryptedIdentityKey?: string;
  ownerKeyVersion?: number;
  trackingEnabled?: boolean;
  trackingIntervalSeconds?: number;
  lastLocationAt?: string | null;
}

export interface FindHubPosition {
  deviceId: string;
  googleDeviceId: string;
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracy?: number;
  timestamp: string;
  source: 'RECENT' | 'NETWORK' | 'LAST_KNOWN' | 'CROWDSOURCED' | 'AGGREGATED' | 'UNKNOWN';
  semanticLocation?: string;
  ownReport: boolean;
}

export interface FindHubAasCredentials {
  email: string;
  androidId: string;
  aasToken: string;
}

export interface FindHubFcmCredentials {
  gcm: {
    androidId: string;
    securityToken: string;
    token: string;
    appId: string;
  };
  keys: {
    privateKey: string;
    publicKey: string;
    authSecret: string;
  };
  installation: {
    fid: string;
    authToken: string;
    refreshToken?: string;
  };
  registration: {
    token: string;
  };
  persistentIds: string[];
}

export interface FindHubStoredCredentials {
  aas: FindHubAasCredentials;
  fcm?: FindHubFcmCredentials;
  ownerKey?: string;
}

export interface FindHubAuthSession {
  id: string;
  instanceName: string;
  email: string;
  state: FindHubAuthState;
  bridgeTokenHash: string;
  expiresAt: number;
  unlockUrl?: string;
}

export interface FindHubTraccarConfig {
  enabled: boolean;
  url: string;
  deviceId: string;
}
