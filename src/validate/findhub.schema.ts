import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

export const findHubAuthStartSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    email: { type: 'string', minLength: 3 },
  },
  required: ['email'],
  additionalProperties: false,
};

export const findHubCredentialBundleSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    sessionId: { type: 'string', minLength: 1 },
    bridgeToken: { type: 'string', minLength: 1 },
    email: { type: 'string', minLength: 3 },
    androidId: { type: 'string', minLength: 1 },
    accountToken: { type: 'string', minLength: 1 },
    sharedKey: { type: 'string', minLength: 1 },
    fcm: { type: 'object' },
  },
  required: ['sessionId', 'bridgeToken', 'email', 'androidId', 'accountToken', 'sharedKey'],
  additionalProperties: false,
};

export const findHubLocateSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  additionalProperties: false,
  properties: { timeoutMs: { type: 'integer', minimum: 1, maximum: 2147483647 } },
};

export const findHubTrackingSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    intervalSeconds: { type: 'integer', minimum: 0, maximum: 86400 },
    timeoutMs: { type: 'integer', minimum: 1, maximum: 2147483647 },
  },
  additionalProperties: false,
};

export const findHubTraccarSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    enabled: { type: 'boolean' },
    url: { type: 'string', minLength: 1 },
    deviceId: { type: 'string', minLength: 1 },
  },
  required: ['enabled', 'url', 'deviceId'],
  additionalProperties: false,
};

const browserProof = {
  sessionId: { type: 'string', minLength: 36, maxLength: 36, pattern: '^[0-9a-fA-F-]{36}$' },
  bridgeToken: { type: 'string', minLength: 32, maxLength: 128 },
} as const;
export const findHubBrowserStartSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  required: ['email'],
  additionalProperties: false,
  properties: { email: { type: 'string', minLength: 3, maxLength: 320, format: 'email' } },
};
export const findHubBrowserCancelSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  required: ['sessionId', 'bridgeToken'],
  additionalProperties: false,
  properties: browserProof,
};
export const findHubBrowserExchangeSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  required: ['sessionId', 'bridgeToken', 'oauthToken'],
  additionalProperties: false,
  properties: { ...browserProof, oauthToken: { type: 'string', minLength: 1, maxLength: 16384 } },
};
export const findHubBrowserCompleteSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  required: ['sessionId', 'bridgeToken', 'vaultKeys'],
  additionalProperties: false,
  properties: { ...browserProof, vaultKeys: { type: 'string', minLength: 1, maxLength: 65536 } },
};

export const findHubSettingsSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  additionalProperties: false,
  properties: {
    intervalSeconds: { type: 'integer', minimum: 0, maximum: 86400 },
    timeoutMs: { type: 'integer', minimum: 1, maximum: 2147483647 },
    staleAfterSeconds: { type: 'integer', minimum: 30, maximum: 604800 },
    historyEnabled: { type: 'boolean' },
    retentionDays: { type: 'integer', minimum: 0, maximum: 36500 },
    reconciliationEnabled: { type: 'boolean' },
    reconciliationMinGapSeconds: { type: 'integer', minimum: 30, maximum: 2592000 },
    reconciliationAttempts: { type: 'integer', minimum: 1, maximum: 10 },
  },
};

export const findHubReconciliationSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  additionalProperties: false,
  properties: {
    from: { type: 'string', format: 'date-time' },
    to: { type: 'string', format: 'date-time' },
    attempts: { type: 'integer', minimum: 1, maximum: 10 },
    timeoutMs: { type: 'integer', minimum: 1, maximum: 2147483647 },
  },
};
export const findHubTraccarConnectionSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  required: ['mode'],
  additionalProperties: false,
  properties: {
    mode: { type: 'string', enum: ['disabled', 'internal', 'external'] },
    url: { type: 'string', maxLength: 2048 },
    receiverUrl: { type: 'string', maxLength: 2048 },
    token: { type: 'string', maxLength: 8192 },
    timeoutMs: { type: 'integer', minimum: 1000, maximum: 60000 },
  },
};

export const findHubDeviceAvatarSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  additionalProperties: false,
  required: ['avatar'],
  properties: { avatar: { type: ['string', 'null'], maxLength: 174786 } },
};
