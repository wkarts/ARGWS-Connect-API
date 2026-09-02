import assert from 'node:assert/strict';

import {
  interactionTextFallback,
  renderInteractionModelV2,
  resolveDataPath,
} from '../../src/api/services/template-interaction-model';
import { planTemplateTransport } from '../../src/api/services/template-transport-planner';

const variables = {
  customer: { name: 'Wallace' },
  api: {
    appointments: [
      { id: 'apt-1', date: '02/09', service: 'Implantação' },
      { id: 'apt-2', date: '03/09', service: 'Suporte' },
    ],
  },
};

assert.equal(resolveDataPath(variables, 'api.appointments[0].id'), 'apt-1');
assert.equal(resolveDataPath(variables, '$.customer.name'), 'Wallace');
assert.equal(resolveDataPath(variables, '__proto__.polluted'), undefined);

const policy = {
  interactionsV2: {
    version: 2,
    items: [
      {
        type: 'LIST',
        id: 'appointment_list',
        title: 'Agendamentos de {{customer.name}}',
        body: 'Escolha um atendimento',
        buttonText: 'Ver agenda',
        source: {
          path: 'api.appointments',
          id: '{{item.id}}',
          title: '{{item.date}} · {{item.service}}',
          description: 'Código {{item.id}}',
          sectionTitle: 'Disponíveis',
        },
      },
      {
        type: 'CHOICE',
        id: 'confirm_choice',
        title: 'Confirmar?',
        mode: 'SINGLE',
        options: [
          { id: 'yes', title: 'Sim', capture: { path: 'decision', value: true } },
          { id: 'no', title: 'Não', capture: { path: 'decision', value: false } },
        ],
      },
    ],
  },
};

const rendered = renderInteractionModelV2(policy, variables);
assert.equal(rendered.length, 2);
assert.equal(rendered[0]?.type, 'list');
if (rendered[0]?.type === 'list') {
  assert.equal(rendered[0].title, 'Agendamentos de {{customer.name}}');
  assert.deepEqual(
    rendered[0].sections[0]?.rows.map((row) => [row.id, row.title]),
    [
      ['apt-1', '02/09 · Implantação'],
      ['apt-2', '03/09 · Suporte'],
    ],
  );
  assert.match(interactionTextFallback(rendered[0]), /02\/09 · Implantação/);
}

assert.equal(rendered[1]?.type, 'choice');
if (rendered[1]?.type === 'choice') {
  assert.equal(rendered[1].options[0]?.capture?.path, 'decision');
}

const envelope = { text: 'Selecione', buttons: [], interactions: rendered };
const meta = planTemplateTransport('WHATSAPP-BUSINESS', envelope);
assert.equal(meta.mode, 'PROVIDER_NATIVE');
assert.equal(meta.interactions[0]?.mode, 'INTERACTIVE');
assert.equal(meta.interactions[0]?.compatibilityTransport, 'META_LIST');
assert.equal(meta.interactions[1]?.compatibilityTransport, 'META_INTERACTIVE_CHOICE');

const baileys = planTemplateTransport('WHATSAPP-BAILEYS', envelope);
assert.equal(baileys.interactions[0]?.mode, 'TEXT_COMPAT');
assert.equal(baileys.interactions[1]?.mode, 'POLL_COMPAT');
assert.equal(baileys.interactions[1]?.compatibilityTransport, 'BAILEYS_OFFICIAL_POLL');

const connect = planTemplateTransport('CONNECT', envelope);
assert.equal(connect.interactions[0]?.mode, 'TEXT_COMPAT');
assert.equal(connect.interactions[1]?.mode, 'INTERACTIVE');
assert.equal(connect.interactions[1]?.compatibilityTransport, 'CONNECT_BUTTONS');

console.log('interaction model v2: ok');
