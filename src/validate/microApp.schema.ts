import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

export const microAppSessionSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    templateName: { type: 'string', minLength: 1 },
    language: { type: 'string', minLength: 2 },
    appKey: { type: 'string', minLength: 1 },
    number: { type: 'string', minLength: 8 },
    variables: { type: 'object' },
    ttlSeconds: { type: 'integer', minimum: 60, maximum: 86400 },
  },
  required: ['templateName', 'appKey', 'number'],
  additionalProperties: false,
};

export const microAppSubmitSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    direction: { type: 'string', enum: ['NEXT', 'BACK'] },
    values: { type: 'object' },
    location: {
      type: 'object',
      properties: {
        latitude: { type: 'number', minimum: -90, maximum: 90 },
        longitude: { type: 'number', minimum: -180, maximum: 180 },
        accuracy: { type: 'number', minimum: 0 },
        capturedAt: { type: 'string' },
      },
      required: ['latitude', 'longitude'],
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};
