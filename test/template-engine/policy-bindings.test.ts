import assert from 'node:assert/strict';

import { mergePolicyInteractionBindings } from '../../src/api/services/template-policy-bindings';

const manual = {
  bindings: [
    { id: 'legacy', matchTitle: 'Legado', type: 'ACTION', key: 'legacy.action' },
    { id: 'stale', type: 'NONE', phase6Generated: true },
  ],
  metadata: { source: 'test' },
};

const policy = {
  interactionsV2: {
    version: 2,
    items: [
      {
        type: 'CHOICE',
        id: 'decision',
        options: [
          {
            id: 'yes',
            title: 'Sim',
            capture: { path: 'decision.accepted', value: true },
            binding: {
              type: 'ACTION',
              key: 'appointment.confirm',
              input: { id: '{{session.variables.appointmentId}}' },
              keepSessionOpen: false,
            },
          },
        ],
      },
      {
        type: 'LIST',
        id: 'dynamic_list',
        source: {
          path: 'api.items',
          id: '{{item.id}}',
          title: '{{item.title}}',
          capture: { path: 'selection' },
          binding: { type: 'RECIPE', key: 'selection.process' },
        },
      },
    ],
  },
};

const merged: any = mergePolicyInteractionBindings(manual, policy);
assert.equal(merged.metadata.source, 'test');
assert.ok(merged.bindings.some((binding: any) => binding.id === 'legacy' && binding.key === 'legacy.action'));
assert.ok(!merged.bindings.some((binding: any) => binding.id === 'stale'));

const yes = merged.bindings.find((binding: any) => binding.id === 'yes');
assert.equal(yes.type, 'ACTION');
assert.equal(yes.key, 'appointment.confirm');
assert.equal(yes.capture.path, 'decision.accepted');
assert.equal(yes.matchTitle, 'Sim');
assert.equal(yes.phase6Generated, true);

const dynamic = merged.bindings.filter((binding: any) => String(binding.id).startsWith('__phase6_dynamic_list_'));
assert.equal(dynamic.length, 2);
assert.deepEqual(
  dynamic.map((binding: any) => binding.interactionType).sort(),
  ['list_reply', 'text_reply'],
);
assert.ok(dynamic.every((binding: any) => binding.type === 'RECIPE' && binding.key === 'selection.process'));
assert.ok(dynamic.every((binding: any) => binding.capture.path === 'selection'));

console.log('phase6 policy bindings: ok');
