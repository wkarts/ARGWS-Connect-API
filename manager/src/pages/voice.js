import { api } from '../api/manager.js';
import { alertBox, badge, button, card, el, emptyState, input, spinner } from '../core/dom.js';
import { hasPermission } from '../core/session.js';
import { appShell, pageHeader, sectionHeader } from '../components/shell.js';

export function renderVoice() {
  const page = el('div', { class: 'page' }, pageHeader('Chamadas & VoIP', 'Operações de voz disponíveis nas instâncias compatíveis.'));
  const body = el('div', { class: 'center' }, spinner()); page.append(body);
  const initialRef = new URL(location.href).searchParams.get('instance') || '';
  void load(initialRef);

  async function load(ref) {
    try {
      const instances = (await api.instances()).filter((item) => item.integration === 'WHATSAPP-ZAPO');
      if (!instances.length) { body.replaceChildren(emptyState('Nenhuma instância de voz', 'As chamadas estão disponíveis para instâncias compatíveis com voz.')); return; }
      const current = instances.find((item) => [item.id, item.instanceId, item.name].includes(ref)) || instances[0];
      const id = current.id || current.instanceId || current.name;
      const calls = await api.calls(id).catch(() => []);
      draw(instances, current, id, Array.isArray(calls) ? calls : []);
    } catch (error) { body.replaceChildren(alertBox(error.message || String(error))); }
  }

  function draw(instances, current, ref, calls) {
    const selector = el('select', { class: 'input compact-select' }, ...instances.map((item) => el('option', { value: item.id || item.instanceId || item.name, text: item.name || item.instanceName, selected: (item.id || item.instanceId || item.name) === ref })));
    selector.onchange = () => load(selector.value);
    const active = calls.filter((call) => !['ended', 'rejected', 'terminated'].includes(String(call.status || call.state || '').toLowerCase()));
    const list = el('div', { class: 'call-list' });
    if (!calls.length) list.append(emptyState('Sem chamadas', 'Não há chamadas registradas para esta instância.'));
    calls.slice(0, 200).forEach((call) => list.append(card(
      el('div', { class: 'call-row' },
        el('div', {}, el('strong', { text: call.number || call.remoteJid || call.peer || 'Chamada' }), el('span', { class: 'muted', text: call.id || call.callId || '' })),
        badge(call.status || call.state || 'unknown'),
        hasPermission('pbx.manage') ? el('div', { class: 'actions' }, button('Encerrar', { class: 'danger', onclick: async () => { await api.callAction(ref, 'end', { callId: call.id || call.callId }); await load(ref); } })) : null,
      ),
    )));
    const dial = input('', { type: 'tel', placeholder: '5575999999999' });
    const dialButton = button('Iniciar chamada', { class: 'primary', disabled: !hasPermission('pbx.manage'), onclick: async () => { if (!dial.value.trim()) return; try { await api.callAction(ref, 'offer', { number: dial.value.replace(/\D/g, ''), isVideo: false }); dial.value = ''; await load(ref); } catch (error) { list.prepend(alertBox(error.message || String(error))); } } });
    body.replaceChildren(
      el('div', { class: 'conversation-toolbar' }, selector),
      el('div', { class: 'metric-grid three' }, metricCard('Chamadas atuais', active.length, '☎'), metricCard('Chamadas registradas', calls.length, '☷'), metricCard('Canal', current.name || current.instanceName, '◉')),
      card(sectionHeader('Discagem', 'Inicie uma chamada pela instância selecionada.'), el('div', { class: 'inline-form' }, dial, dialButton)),
      el('div', { class: 'top-gap' }, sectionHeader('Chamadas', 'Histórico e chamadas em andamento.'), list),
    );
  }
  return appShell(page, { title: 'Chamadas & VoIP', subtitle: 'Voz' });
}
function metricCard(label, value, icon) { return card(el('div', { class: 'metric-top' }, el('span', { class: 'metric-icon', text: icon })), el('strong', { class: 'metric-value', text: String(value) }), el('span', { class: 'metric-label', text: label })); }
