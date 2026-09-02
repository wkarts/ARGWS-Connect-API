import assert from 'node:assert/strict';

import { renderTemplateDefinition } from '../../src/api/services/template-renderer';

const rendered = renderTemplateDefinition(
  {
    components: [
      { type: 'HEADER', format: 'TEXT', text: 'Agendamento' },
      { type: 'BODY', text: 'Olá {{1}}, seu horário é {{2}}.' },
      { type: 'FOOTER', text: 'Scheduler Pro' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Confirmar', id: 'confirm' },
          { type: 'QUICK_REPLY', text: 'Reagendar', id: 'reschedule' },
        ],
      },
    ],
  },
  [
    {
      type: 'body',
      parameters: [
        { type: 'text', text: 'Wallace' },
        { type: 'text', text: '18:30' },
      ],
    },
  ],
);

assert.equal(rendered.title, 'Agendamento');
assert.equal(rendered.text, 'Olá Wallace, seu horário é 18:30.');
assert.equal(rendered.footer, 'Scheduler Pro');
assert.equal(rendered.buttons.length, 2);
assert.equal(rendered.buttons[0].type, 'reply');
assert.equal(rendered.buttons[0].id, 'confirm');

const named = renderTemplateDefinition(
  { components: [{ type: 'BODY', text: 'Pedido {{order.id}}: {{order.status}}' }] },
  [],
  { 'order.id': 4582, 'order.status': 'Em transporte' },
);
assert.equal(named.text, 'Pedido 4582: Em transporte');

const dynamicUrl = renderTemplateDefinition(
  {
    components: [
      { type: 'BODY', text: 'Acompanhe seu pedido.' },
      { type: 'BUTTONS', buttons: [{ type: 'URL', text: 'Rastrear', url: 'https://example.com/track/{{1}}' }] },
    ],
  },
  [{ type: 'button', sub_type: 'url', index: 0, parameters: [{ type: 'text', text: 'ABC 123' }] }],
);
assert.equal(dynamicUrl.buttons[0].type, 'url');
assert.equal(dynamicUrl.buttons[0].url, 'https://example.com/track/ABC%20123');

console.log('template engine foundation: ok');
