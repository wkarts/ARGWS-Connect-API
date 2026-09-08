import { Integration } from '@api/types/wa.types';
import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

export const providerMigrationSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  additionalProperties: false,
  properties: {
    targetProvider: {
      type: 'string',
      enum: [Integration.WHATSAPP_BAILEYS, Integration.WHATSAPP_ZAPO],
    },
    dryRun: { type: 'boolean' },
  },
  required: ['targetProvider'],
};
