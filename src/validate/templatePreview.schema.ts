import { JSONSchema7 } from 'json-schema';
import { v4 } from 'uuid';

export const templatePreviewSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    name: { type: 'string' },
    language: { type: 'string' },
    category: { type: 'string', enum: ['AUTHENTICATION', 'MARKETING', 'UTILITY'] },
    components: { type: 'array' },
    variables: { type: 'object' },
  },
  anyOf: [{ required: ['components'] }, { required: ['name'] }],
};
