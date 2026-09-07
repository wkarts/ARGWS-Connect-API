import { api } from '../api/manager.js';
import { alertBox, button, card, el, emptyState, field, input, modal, select, spinner, textarea } from '../core/dom.js';
import { hasPermission } from '../core/session.js';
import { appShell, pageHeader, sectionHeader } from '../components/shell.js';

const integrations = [
  ['typebot', 'Typebot'], ['openai', 'OpenAI'], ['dify', 'Dify'], ['n8n', 'n8n'], ['connectAI', 'ConnectAI'], ['connectBot', 'ConnectBot'], ['flowise', 'Flowise'],
];

export function renderStudio() {
  const page = el('div', { class: 'page' }, pageHeader('Automações', 'Organize bots, gatilhos e integrações por instância.'));
  const body = el('div', { class: 'center' }, spinner()); page.append(body);
  const initialRef = new URL(location.href).searchParams.get('instance') || '';
  void load(initialRef);
  async function load(ref) {
    try {
      const instances = await api.instances();
      if (!instances.length) { body.replaceChildren(emptyState('Nenhuma instância', 'Crie uma instância para configurar automações.')); return; }
      const current = instances.find((item) => [item.id, item.instanceId, item.name].includes(ref)) || instances[0];
      const id = current.id || current.instanceId || current.name;
      const results = await Promise.all(integrations.map(async ([key, label]) => [key, label, await api.integrations(id, key).catch(() => [])]));
      draw(instances, id, results);
    } catch (error) { body.replaceChildren(alertBox(error.message || String(error))); }
  }
  function draw(instances, ref, results) {
    const selector = el('select', { class: 'input compact-select' }, ...instances.map((item) => el('option', { value: item.id || item.instanceId || item.name, text: item.name || item.instanceName, selected: (item.id || item.instanceId || item.name) === ref })));
    selector.onchange = () => load(selector.value);
    const grid = el('div', { class: 'studio-grid' });
    results.forEach(([key, label, items]) => grid.append(card(
      el('div', { class: 'studio-card-head' }, el('div', {}, el('h3', { text: label }), el('span', { class: 'muted', text: `${items.length} configuração(ões)` })), hasPermission('studio.manage') ? button('Adicionar', { class: 'ghost', onclick: () => openEditor(ref, key, label, null, load) }) : null),
      items.length ? el('div', { class: 'automation-list' }, ...items.slice(0, 50).map((item) => automationRow(ref, key, label, item, load))) : emptyState('Nenhuma automação', `Nenhuma configuração ${label} nesta instância.`),
    )));
    body.replaceChildren(el('div', { class: 'conversation-toolbar' }, selector), el('div', { class: 'notice' }, el('strong', { text: 'Studio' }), el('span', { text: 'As automações utilizam os recursos já existentes no Engine. Nenhum serviço externo é administrado fora deste ambiente.' })), grid);
  }
  return appShell(page, { title: 'Automações', subtitle: 'Studio' });
}
function automationRow(ref, key, label, item, reload) {
  const id = item.id || item.openaiBotId || item.typebotId || item.difyId || item.n8nId || item.connectAIId || item.connectBotId || item.flowiseId || '';
  return el('div', { class: 'automation-row' }, el('div', {}, el('strong', { text: item.description || item.name || id || label }), el('span', { text: item.triggerType ? `Gatilho: ${item.triggerType}` : 'Configuração ativa' })), hasPermission('studio.manage') ? el('div', { class: 'actions' }, button('Editar', { class: 'ghost', onclick: () => openEditor(ref, key, label, item, reload) }), id ? button('Excluir', { class: 'danger ghost', onclick: async () => { if (!confirm(`Excluir esta configuração ${label}?`)) return; await api.deleteIntegration(ref, key, id); await reload(ref); } }) : null) : null);
}
function openEditor(ref, key, label, item, reload) {
  const description = input(item?.description || item?.name || '', { placeholder: `Nome da automação ${label}` });
  const enabled = select(String(item?.enabled ?? true), [{ value: 'true', label: 'Ativa' }, { value: 'false', label: 'Inativa' }]);
  const triggerType = select(item?.triggerType || 'all', ['all', 'keyword', 'none', 'advanced']);
  const triggerValue = input(item?.triggerValue || '', { placeholder: 'Valor do gatilho' });
  const advanced = textarea(JSON.stringify(item || {}, null, 2), { rows: 12, spellcheck: false });
  const feedback = el('div');
  const form = el('form', { class: 'form-stack' }, feedback, field('Descrição', description), field('Estado', enabled), field('Gatilho', triggerType), field('Valor do gatilho', triggerValue), field('Configuração avançada (JSON)', advanced, 'Os campos específicos do provedor podem ser ajustados aqui.'), button(item ? 'Salvar alterações' : 'Criar automação', { class: 'primary', type: 'submit' }));
  const dialog = modal(item ? `Editar ${label}` : `Nova automação ${label}`, form, { wide: true });
  form.onsubmit = async (event) => {
    event.preventDefault();
    try {
      let payload = {}; try { payload = JSON.parse(advanced.value || '{}'); } catch { throw new Error('JSON avançado inválido.'); }
      payload.description = description.value.trim(); payload.enabled = enabled.value === 'true'; payload.triggerType = triggerType.value; payload.triggerValue = triggerValue.value;
      const id = item?.id || item?.openaiBotId || item?.typebotId || item?.difyId || item?.n8nId || item?.connectAIId || item?.connectBotId || item?.flowiseId;
      if (item && id) await api.updateIntegration(ref, key, id, payload); else await api.createIntegration(ref, key, payload);
      dialog.close(); await reload(ref);
    } catch (error) { feedback.replaceChildren(alertBox(error.message || String(error))); }
  };
}
