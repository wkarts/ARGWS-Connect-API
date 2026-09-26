export type FindHubAuthState =
  | 'WAITING_AUTH'
  | 'WAITING_OAUTH_TOKEN'
  | 'WAITING_VAULT_KEY'
  | 'READY'
  | 'AUTH_REQUIRED'
  | 'ERROR';

export type FindHubRuntimeState = 'close' | 'connecting' | 'open';

export type FindHubDeviceType =
  | 'BEACON'
  | 'HEADPHONES'
  | 'KEYS'
  | 'WATCH'
  | 'WALLET'
  | 'BAG'
  | 'LAPTOP'
  | 'CAR'
  | 'REMOTE_CONTROL'
  | 'BADGE'
  | 'BIKE'
  | 'CAMERA'
  | 'CAT'
  | 'CHARGER'
  | 'CLOTHING'
  | 'DOG'
  | 'NOTEBOOK'
  | 'PASSPORT'
  | 'PHONE'
  | 'SPEAKER'
  | 'TABLET'
  | 'TOY'
  | 'UMBRELLA'
  | 'STYLUS'
  | 'EARBUDS'
  | 'TRACKER'
  | 'UNKNOWN';

export type FindHubSoundComponent = 'UNSPECIFIED' | 'RIGHT' | 'LEFT' | 'CASE';

export interface FindHubAccessInformation {
  email?: string;
  hasAccess: boolean;
  isOwner: boolean;
  thisAccount: boolean;
}

export interface FindHubDevice {
  id: string;
  googleDeviceId: string;
  canonicalIds?: string[];
  name: string;
  identifierType: 'ANDROID' | 'SPOT' | 'SUPERVISED_ANDROID' | 'UNKNOWN';
  deviceType: FindHubDeviceType;
  manufacturer?: string;
  model?: string;
  deviceCodename?: string;
  productName?: string;
  carrier?: string;
  imei?: string;
  androidDeviceNumericId?: string;
  providerOpaqueId?: string;
  providerRegisteredAt?: string | null;
  providerStatusAt?: string | null;
  providerResponseAt?: string | null;
  gmsCoreVersionCode?: number;
  androidSdkVersion?: number;
  familyLinkManaged?: boolean;
  familyLinkMemberName?: string;
  familyLinkUrl?: string;
  providerCapabilities?: Array<{ actionField: number; state: number }>;
  providerFlags?: Record<string, number>;
  locateSupported?: boolean;
  fastPairModelId?: string;
  pairedAt?: string | null;
  accessInformation?: FindHubAccessInformation[];
  imageUrl?: string;
  avatarData?: string | null;
  ownerKeyVersion?: number;
  identityKeyFingerprint?: string;
  accountKeyFingerprint?: string;
  publicAddressFingerprint?: string;
  secretsCreatedAt?: string | null;
  networkAggregationMinReports?: number;
  providerRequestCount?: number;
  providerReportCount?: number;
  providerRepeatedReportCount?: number;
  lastProviderRequestAt?: string | null;
  lastProviderReportAt?: string | null;
  trackingEnabled?: boolean;
  trackingIntervalSeconds?: number;
  lastLocationAt?: string | null;
  latestPosition?: FindHubPosition | null;
  lastReceivedAt?: string | null;
  lastAttemptAt?: string | null;
  lastErrorCode?: string | null;
  providerStatus?: string | null;
  locationTimeoutMs?: number | null;
  availability?: string;
}

export interface FindHubPosition {
  deviceId: string;
  googleDeviceId: string;
  latitude: number;
  longitude: number;
  altitude?: number;
  accuracy?: number;
  timestamp: string;
  source: 'RECENT' | 'NETWORK' | 'LAST_KNOWN' | 'CROWDSOURCED' | 'AGGREGATED' | 'TRACCAR' | 'UNKNOWN';
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
