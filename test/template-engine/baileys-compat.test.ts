import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { extractBaileysPollInteraction } from '../../src/api/services/interaction-normalizer';
import { renderTemplateDefinition } from '../../src/api/services/template-renderer';
import { planTemplateTransport } from '../../src/api/services/template-transport-planner';

const engineSource = readFileSync('src/api/services/template-engine.service.ts', 'utf8');
const plannerSource = readFileSync('src/api/services/template-transport-planner.ts', 'utf8');

assert.match(engineSource, /planTemplateTransport\(provider, rendered\)/);
assert.match(engineSource, /transport\.mode === 'POLL_COMPAT'/);
assert.match(engineSource, /sendBaileysPollCompatibility/);
assert.match(engineSource, /runtime\.pollMessage/);
assert.match(plannerSource, /normalized === 'WHATSAPP-BAILEYS'/);
assert.match(plannerSource, /mode: 'POLL_COMPAT'/);
assert.match(plannerSource, /compatibilityTransport: 'BAILEYS_OFFICIAL_POLL'/);
assert.match(plannerSource, /mode: 'TEXT_COMPAT'/);

const rendered = renderTemplateDefinition(
  {
    components: [
      { type: 'BODY', text: 'Olá {{1}}, confirme sua solicitação.' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Confirmar', id: 'confirm' },
          { type: 'QUICK_REPLY', text: 'Cancelar', id: 'cancel' },
        ],
      },
    ],
  },
  [{ type: 'body', parameters: [{ type: 'text', text: 'Wallace' }] }],
);
assert.deepEqual(
  rendered.buttons.map((button) => ({ id: button.id, title: button.displayText })),
  [
    { id: 'confirm', title: 'Confirmar' },
    { id: 'cancel', title: 'Cancelar' },
  ],
);

const planned = planTemplateTransport('WHATSAPP-BAILEYS', rendered);
assert.equal(planned.mode, 'POLL_COMPAT');
assert.equal(planned.compatibilityTransport, 'BAILEYS_OFFICIAL_POLL');
assert.deepEqual(planned.buttons.map((button) => button.transport), ['POLL_OPTION', 'POLL_OPTION']);

const normalized = extractBaileysPollInteraction({
  message: { pollUpdateMessage: { pollCreationMessageKey: { id: 'poll-outbound-1' } } },
  pollUpdates: [
    { name: 'Confirmar', voters: ['557599999999@s.whatsapp.net'] },
    { name: 'Cancelar', voters: [] },
  ],
});
assert.equal(normalized?.type, 'poll_reply');
assert.equal(normalized?.id, 'Confirmar');
assert.equal(normalized?.title, 'Confirmar');
assert.equal(normalized?.contextMessageId, 'poll-outbound-1');
assert.deepEqual(normalized?.payload, { selectedOptions: ['Confirmar'] });

assert.equal(extractBaileysPollInteraction({ pollUpdates: [] }), null);

console.log('baileys template compatibility: ok');
