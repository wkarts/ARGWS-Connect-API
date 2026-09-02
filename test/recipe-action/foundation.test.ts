import assert from 'node:assert/strict';

import { resolveActionValue } from '../../src/api/services/action-value-resolver';

const context = {
  input: { appointmentId: 'apt-42', customer: { name: 'Wallace' } },
  steps: {
    lookup: {
      data: {
        id: 'apt-42',
        status: 'scheduled',
        total: 189.9,
      },
    },
  },
};

assert.equal(resolveActionValue('{{input.appointmentId}}', context), 'apt-42');
assert.equal(resolveActionValue('Olá {{input.customer.name}}', context), 'Olá Wallace');
assert.equal(resolveActionValue('{{steps.lookup.data.total}}', context), 189.9);
assert.deepEqual(
  resolveActionValue(
    {
      id: '{{steps.lookup.data.id}}',
      message: 'Status: {{steps.lookup.data.status}}',
    },
    context,
  ),
  { id: 'apt-42', message: 'Status: scheduled' },
);

console.log('recipe/action foundation: ok');
