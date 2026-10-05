import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

import { EventController } from '../event.controller';

export const webhookSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    webhook: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        url: { type: 'string', maxLength: 500 },
        headers: { type: 'object' },
        byEvents: { type: 'boolean' },
        base64: { type: 'boolean' },
        events: {
          type: 'array',
          minItems: 0,
          items: {
            type: 'string',
            enum: EventController.events,
          },
        },
        additionalTargets: {
          type: 'array',
          maxItems: 10,
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', maxLength: 80 },
              enabled: { type: 'boolean' },
              url: { type: 'string', maxLength: 500 },
              headers: { type: 'object', additionalProperties: { type: 'string' } },
              byEvents: { type: 'boolean' },
              events: { type: 'array', items: { type: 'string', enum: EventController.events } },
            },
            required: ['enabled', 'url'],
            allOf: [
              {
                if: { properties: { enabled: { const: true } } },
                then: { properties: { url: { pattern: '^https?://' } } },
              },
            ],
          },
        },
      },
      required: ['enabled', 'url'],
      allOf: [
        { if: { properties: { enabled: { const: true } } }, then: { properties: { url: { pattern: '^https?://' } } } },
      ],
    },
  },
  required: ['webhook'],
};
