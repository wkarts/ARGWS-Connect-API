import assert from 'node:assert/strict';
import fs from 'node:fs';

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
assert.equal(baileys.mode, 'INTERACTIVE');
assert.equal(baileys.compatibilityTransport, 'BAILEYS_NATIVE_INTERACTIVE');
assert.deepEqual(baileys.buttons.map((button) => button.transport), ['NATIVE_BUTTON', 'NATIVE_BUTTON']);
assert.equal(baileys.degraded, false);

const meta = planTemplateTransport('WHATSAPP-BUSINESS', utility);
assert.equal(meta.mode, 'PROVIDER_NATIVE');
assert.equal(meta.degraded, false);
assert.deepEqual(meta.buttons.map((button) => button.transport), ['NATIVE_BUTTON', 'NATIVE_BUTTON']);

const connect = planTemplateTransport('CONNECT', utility);
assert.equal(connect.mode, 'INTERACTIVE');
assert.equal(connect.degraded, false);
assert.deepEqual(connect.buttons.map((button) => button.transport), ['NATIVE_BUTTON', 'NATIVE_BUTTON']);

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
assert.equal(baileysUrl.mode, 'INTERACTIVE');
assert.equal(baileysUrl.compatibilityTransport, 'BAILEYS_NATIVE_INTERACTIVE');
assert.equal(baileysUrl.buttons[0]?.transport, 'NATIVE_BUTTON');
assert.equal(baileysUrl.degraded, false);

const mixed = renderTemplateDefinition(
  {
    components: [
      { type: 'BODY', text: 'Escolha ou acesse.' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Confirmar', id: 'confirm' },
          { type: 'URL', text: 'Abrir', url: 'https://example.com' },
        ],
      },
    ],
  },
  [],
  {},
);
const baileysMixed = planTemplateTransport('WHATSAPP-BAILEYS', mixed);
assert.equal(baileysMixed.mode, 'TEXT_COMPAT');
assert.deepEqual(baileysMixed.buttons.map((button) => button.transport), ['TEXT_OPTION', 'TEXT_LINK']);

const plain = renderTemplateDefinition({ components: [{ type: 'BODY', text: 'Somente texto.' }] }, [], {});
assert.equal(planTemplateTransport('WHATSAPP-BAILEYS', plain).mode, 'TEXT');
assert.equal(planTemplateTransport('CONNECT', plain).mode, 'TEXT');

const baileysCapabilities = getProviderTemplateCapabilities('WHATSAPP-BAILEYS');
assert.equal(baileysCapabilities.quickReply, 'NATIVE');
assert.equal(baileysCapabilities.urlButton, 'NATIVE');
assert.equal(baileysCapabilities.phoneButton, 'NATIVE');
assert.equal(baileysCapabilities.copyCodeButton, 'NATIVE');
assert.equal(baileysCapabilities.list, 'NATIVE');
assert.equal(baileysCapabilities.choice, 'NATIVE');
assert.equal(baileysCapabilities.microApp, 'NATIVE');
assert.equal(getProviderTemplateCapabilities('WHATSAPP-BUSINESS').quickReply, 'NATIVE');

const connectCapabilities = getProviderTemplateCapabilities('CONNECT');
assert.equal(connectCapabilities.quickReply, 'NATIVE');
assert.equal(connectCapabilities.list, 'UNSUPPORTED');

const unknownCapabilities = getProviderTemplateCapabilities('SOMETHING-ELSE');
assert.equal(unknownCapabilities.quickReply, 'UNSUPPORTED');
assert.equal(unknownCapabilities.urlButton, 'UNSUPPORTED');
assert.equal(unknownCapabilities.list, 'UNSUPPORTED');

const unknown = planTemplateTransport('SOMETHING-ELSE', utility);
assert.equal(unknown.mode, 'TEXT_COMPAT');
assert.equal(unknown.compatibilityTransport, 'GENERIC_TEXT');
assert.equal(unknown.degraded, true);
assert.deepEqual(unknown.buttons.map((button) => button.transport), ['TEXT_OPTION', 'TEXT_OPTION']);

const templateServiceSource = fs.readFileSync('src/api/services/template.service.ts', 'utf8');
const previewStart = templateServiceSource.indexOf('public async preview(');
const createStart = templateServiceSource.indexOf('public async create(', previewStart);
assert.ok(previewStart >= 0 && createStart > previewStart, 'TemplateService.preview must remain discoverable');
const previewSource = templateServiceSource.slice(previewStart, createStart);
assert.doesNotMatch(previewSource, /ensureDefaultTemplates/, 'preview must never seed local templates');
assert.match(
  previewSource,
  /else \{[\s\S]*?prismaRepository\.template\.findFirst/,
  'local persisted preview must read the requested template directly',
);

console.log('provider template capabilities: ok');

require('../phase6.test');
