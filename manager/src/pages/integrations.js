import { api } from '../api/manager.js';
import { alertBox, button, card, el, emptyState, modal, spinner, textarea } from '../core/dom.js';
import { hasPermission } from '../core/session.js';
import { appShell, pageHeader, sectionHeader } from '../components/shell.js';

const kinds = [
  ['webhook', 'Webhook', 'Entrega de eventos HTTP'], ['websocket', 'WebSocket', 'Eventos em tempo real'], ['rabbitmq', 'RabbitMQ', 'Mensageria AMQP'], ['sqs', 'SQS', 'Filas AWS'], ['proxy', 'Proxy', 'Saída de rede'], ['chatwoot', 'Chatwoot', 'Atendimento integrado'], ['settings', 'Comportamento', 'Preferências da instância'],
];
export function renderIntegrations() {
  const page = el('div', { class: 'page' }, pageHeader('Integrações', 'Configure eventos, mensageria e serviços conectados.'));
  const body = el('div', { class: 'center' }, spinner()); page.append(body);
  const initialRef = new URL(location.href).searchParams.get('instance') || '';
  void load(initialRef);
  async function load(ref) {
    try {
      const instances = await api.instances();
      if (!instances.length) { body.replaceChildren(emptyState('Nenhuma instância', 'Crie uma instância antes de configurar integrações.')); return; }
      const current = instances.find((item) => [item.id, item.instanceId, item.name].includes(ref)) || instances[0];
      const id = current.id || current.instanceId || current.name;
      const values = await Promise.all(kinds.map(async ([kind, label, description]) => [kind, label, description, await api.config(id, kind).catch(() => null)]));
      const selector = el('select', { class: 'input compact-select' }, ...instances.map((item) => el('option', { value: item.id || item.instanceId || item.name, text: item.name || item.instanceName, selected: (item.id || item.instanceId || item.name) === id })));
      selector.onchange = () => load(selector.value);
      body.replaceChildren(el('div', { class: 'conversation-toolbar' }, selector), el('div', { class: 'integration-grid' }, ...values.map(([kind, label, description, value]) => card(sectionHeader(label, description), el('div', { class: 'integration-state' }, el('span', { class: `state-led ${value ? 'on' : ''}` }), el('span', { text: value ? 'Configurado' : 'Não configurado' })), hasPermission('instances.manage') ? button('Configurar', { class: 'primary ghost', onclick: () => edit(id, kind, label, value, load) }) : null))));
    } catch (error) { body.replaceChildren(alertBox(error.message || String(error))); }
  }
  return appShell(page, { title: 'Integrações', subtitle: 'Studio' });
}
function edit(ref, kind, label, value, reload) {
  const area = textarea(JSON.stringify(value || {}, null, 2), { rows: 18, spellcheck: false });
  const feedback = el('div');
  const body = el('form', { class: 'form-stack' }, feedback, area, button('Salvar configuração', { class: 'primary', type: 'submit' }));
  const dialog = modal(label, body, { wide: true });
  body.onsubmit = async (event) => { event.preventDefault(); try { const data = JSON.parse(area.value || '{}'); await api.saveConfig(ref, kind, data); dialog.close(); await reload(ref); } catch (error) { feedback.replaceChildren(alertBox(error.message || String(error))); } };
}
