import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

export const strongConfirmationDecisionSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    sessionId: { type: 'string', minLength: 1 },
    actor: { type: 'string', maxLength: 255 },
    reason: { type: 'string', maxLength: 1000 },
  },
  required: ['sessionId'],
};
