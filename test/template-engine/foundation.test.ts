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

const standardTemplates = [
  {
    name: 'hello_world',
    definition: { components: [{ type: 'BODY', text: 'Olá {{1}}! Esta é uma mensagem de teste do Connect|API.' }] },
    parameters: [{ type: 'body', parameters: [{ type: 'text', text: 'Wallace' }] }],
    expectedButtons: 0,
  },
  {
    name: 'sample_utility',
    definition: {
      components: [
        { type: 'BODY', text: 'Olá {{1}}. Sua solicitação {{2}} está pronta para continuar.' },
        {
          type: 'BUTTONS',
          buttons: [
            { type: 'QUICK_REPLY', text: 'Confirmar', id: 'confirm' },
            { type: 'QUICK_REPLY', text: 'Cancelar', id: 'cancel' },
          ],
        },
      ],
    },
    parameters: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Wallace' },
          { type: 'text', text: 'Solicitação #123' },
        ],
      },
    ],
    expectedButtons: 2,
  },
  {
    name: 'sample_marketing',
    definition: { components: [{ type: 'BODY', text: 'Olá {{1}}, temos uma novidade para você: {{2}}.' }] },
    parameters: [
      {
        type: 'body',
        parameters: [
          { type: 'text', text: 'Wallace' },
          { type: 'text', text: 'uma condição especial para você' },
        ],
      },
    ],
    expectedButtons: 0,
  },
  {
    name: 'sample_authentication',
    definition: { components: [{ type: 'BODY', text: 'Seu código de verificação é {{1}}.' }] },
    parameters: [{ type: 'body', parameters: [{ type: 'text', text: '123456' }] }],
    expectedButtons: 0,
  },
];

for (const sample of standardTemplates) {
  const output = renderTemplateDefinition(sample.definition, sample.parameters);
  assert.ok(output.text.length > 0, `${sample.name} must render text`);
  assert.equal(output.buttons.length, sample.expectedButtons, `${sample.name} button count`);
  assert.equal(/\{\{.+\}\}/.test(output.text), false, `${sample.name} must resolve positional variables`);
}

console.log('template engine foundation: ok');
