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

export const findHubTrackingSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    intervalSeconds: { type: 'integer', minimum: 15, maximum: 86400 },
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

export const findHubMonitoringSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  additionalProperties: false,
  required: [
    'historyEnabled',
    'historyRetentionDays',
    'defaultIntervalSeconds',
    'locationTimeoutMs',
    'uiRefreshSeconds',
  ],
  properties: {
    historyEnabled: { type: 'boolean' },
    historyRetentionDays: { type: 'integer', minimum: 0, maximum: 3650 },
    defaultIntervalSeconds: { type: 'integer', minimum: 15, maximum: 86400 },
    locationTimeoutMs: { type: 'integer', minimum: 5000, maximum: 180000 },
    uiRefreshSeconds: { type: 'integer', minimum: 1, maximum: 60 },
  },
};
export const findHubLocateSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  additionalProperties: false,
  properties: { timeoutMs: { type: 'integer', minimum: 5000, maximum: 180000 } },
};
export const findHubDeviceSettingsSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  additionalProperties: false,
  required: ['intervalSeconds', 'timeoutMs'],
  properties: {
    intervalSeconds: { type: 'integer', minimum: 15, maximum: 86400 },
    timeoutMs: { type: ['integer', 'null'], minimum: 5000, maximum: 180000 },
  },
};
