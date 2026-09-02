import assert from 'node:assert/strict';

import { renderTemplateDefinition } from '../../src/api/services/template-renderer';
import {
  getProviderTemplateCapabilities,
  planTemplateTransport,
} from '../../src/api/services/template-transport-planner';

const utility = renderTemplateDefinition(
  {
    components: [
      { type: 'BODY', text: 'Olá {{1}}. Confirme.' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Confirmar', id: 'confirm' },
          { type: 'QUICK_REPLY', text: 'Cancelar', id: 'cancel' },
        ],
      },
    ],
  },
  [],
  { '1': 'Wallace' },
);

const baileys = planTemplateTransport('WHATSAPP-BAILEYS', utility);
assert.equal(baileys.mode, 'POLL_COMPAT');
assert.equal(baileys.compatibilityTransport, 'BAILEYS_OFFICIAL_POLL');
assert.deepEqual(baileys.buttons.map((button) => button.transport), ['POLL_OPTION', 'POLL_OPTION']);
assert.equal(baileys.degraded, true);

const meta = planTemplateTransport('WHATSAPP-BUSINESS', utility);
assert.equal(meta.mode, 'PROVIDER_NATIVE');
assert.equal(meta.degraded, false);
assert.deepEqual(meta.buttons.map((button) => button.transport), ['NATIVE_BUTTON', 'NATIVE_BUTTON']);

const withUrl = renderTemplateDefinition(
  {
    components: [
      { type: 'BODY', text: 'Acesse.' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Abrir', url: 'https://example.com' }] },
    ],
  },
  [],
  {},
);
const baileysUrl = planTemplateTransport('WHATSAPP-BAILEYS', withUrl);
assert.equal(baileysUrl.mode, 'TEXT_COMPAT');
assert.equal(baileysUrl.buttons[0]?.transport, 'TEXT_LINK');

const plain = renderTemplateDefinition({ components: [{ type: 'BODY', text: 'Somente texto.' }] }, [], {});
assert.equal(planTemplateTransport('WHATSAPP-BAILEYS', plain).mode, 'TEXT');

const capabilities = getProviderTemplateCapabilities('WHATSAPP-BAILEYS');
assert.equal(capabilities.quickReply, 'POLL_COMPAT');
assert.equal(capabilities.urlButton, 'TEXT_COMPAT');
assert.equal(getProviderTemplateCapabilities('WHATSAPP-BUSINESS').quickReply, 'NATIVE');

console.log('provider template capabilities: ok');
