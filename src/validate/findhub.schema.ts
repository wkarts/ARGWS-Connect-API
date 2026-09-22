import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

export const findHubAuthStartSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: { email: { type: 'string', minLength: 3 } },
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
  properties: { intervalSeconds: { type: 'integer', minimum: 15, maximum: 3600 } },
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
