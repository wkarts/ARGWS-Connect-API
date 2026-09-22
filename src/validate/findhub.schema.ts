import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

export const findHubAuthStartSchema: JSONSchema7 = {
  $id: v4(), type: 'object', properties: { email: { type: 'string', minLength: 3 } }, required: ['email'], additionalProperties: false,
};
export const findHubAuthExchangeSchema: JSONSchema7 = {
  $id: v4(), type: 'object', properties: {
    sessionId: { type: 'string', minLength: 1 }, bridgeToken: { type: 'string', minLength: 1 },
    email: { type: 'string', minLength: 3 }, oauthToken: { type: 'string', minLength: 1 },
  }, required: ['sessionId', 'bridgeToken', 'email', 'oauthToken'], additionalProperties: false,
};
export const findHubAuthVaultSchema: JSONSchema7 = {
  $id: v4(), type: 'object', properties: {
    sessionId: { type: 'string', minLength: 1 }, bridgeToken: { type: 'string', minLength: 1 },
    sharedKey: { type: 'string' }, vaultKeys: {},
  }, required: ['sessionId', 'bridgeToken'], anyOf: [{ required: ['sharedKey'] }, { required: ['vaultKeys'] }], additionalProperties: false,
};
export const findHubTrackingSchema: JSONSchema7 = {
  $id: v4(), type: 'object', properties: { intervalSeconds: { type: 'integer', minimum: 15, maximum: 3600 } }, additionalProperties: false,
};
export const findHubTraccarSchema: JSONSchema7 = {
  $id: v4(), type: 'object', properties: {
    enabled: { type: 'boolean' }, url: { type: 'string', minLength: 1 }, deviceId: { type: 'string', minLength: 1 },
  }, required: ['enabled', 'url', 'deviceId'], additionalProperties: false,
};
