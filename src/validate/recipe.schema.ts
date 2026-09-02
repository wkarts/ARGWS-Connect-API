import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

const recipeKey = { type: 'string', pattern: '^[A-Za-z0-9][A-Za-z0-9._:-]{1,149}$' } as const;

export const recipeSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    recipeKey,
    name: { type: 'string', minLength: 1 },
    description: { type: 'string' },
    version: { type: 'integer', minimum: 1 },
    steps: {
      type: 'array',
      minItems: 1,
      items: {
        type: 'object',
        properties: {
          id: recipeKey,
          action: recipeKey,
          input: {},
          continueOnError: { type: 'boolean' },
        },
        required: ['id', 'action'],
        additionalProperties: false,
      },
    },
    inputSchema: { type: 'object' },
    outputTemplate: {},
    confirmation: { type: 'string', enum: ['NONE', 'CONFIRM', 'STRONG'] },
    enabled: { type: 'boolean' },
  },
  required: ['recipeKey', 'name', 'steps'],
  additionalProperties: false,
};

export const recipeExecuteSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    recipeKey,
    input: { type: 'object' },
    confirmed: { type: 'boolean' },
    dryRun: { type: 'boolean' },
  },
  required: ['recipeKey'],
  additionalProperties: false,
};

export const recipeDeleteSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: { recipeKey },
  required: ['recipeKey'],
  additionalProperties: false,
};

export const recipeInstallSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    packageKey: { type: 'string', minLength: 1, maxLength: 100 },
    baseUrl: { type: 'string', minLength: 8 },
    credentialRef: { type: 'string', pattern: '^[A-Za-z0-9_-]{2,100}$' },
    allowPrivateNetwork: { type: 'boolean' },
  },
  required: ['packageKey', 'baseUrl'],
  additionalProperties: false,
};
