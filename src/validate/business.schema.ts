import { JSONSchema7 } from 'json-schema';

export const catalogSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    number: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 100 },
    cursor: { type: 'string' },
    maxPages: { type: 'integer', minimum: 1, maximum: 20 },
  },
};

export const collectionsSchema: JSONSchema7 = {
  type: 'object',
  properties: {
    number: { type: 'string' },
    limit: { type: 'integer', minimum: 1, maximum: 51 },
  },
};
