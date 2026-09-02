import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

const actionKey = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{1,149}$' } as const;

export const actionSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    actionKey,
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] },
    baseUrl: { type: 'string', minLength: 8 },
    path: { type: 'string' },
    credentialRef: { type: 'string', pattern: '^[A-Za-z0-9_-]{2,100}$' },
    headers: { type: 'object', additionalProperties: { type: 'string' } },
    requestTemplate: { type: 'object' },
    inputSchema: { type: 'object' },
    outputMapping: { type: 'object' },
    timeoutMs: { type: 'integer', minimum: 250, maximum: 60000 },
    confirmation: { type: 'string', enum: ['NONE', 'CONFIRM', 'STRONG'] },
    allowPrivateNetwork: { type: 'boolean' },
    enabled: { type: 'boolean' },
  },
  required: ['actionKey', 'name', 'method', 'baseUrl', 'path'],
  additionalProperties: false,
};

export const actionExecuteSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    actionKey,
    input: { type: 'object' },
    confirmed: { type: 'boolean' },
    dryRun: { type: 'boolean' },
  },
  required: ['actionKey'],
  additionalProperties: false,
};

export const actionDeleteSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: { actionKey },
  required: ['actionKey'],
  additionalProperties: false,
};
