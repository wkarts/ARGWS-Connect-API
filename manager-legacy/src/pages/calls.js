import { alertBox, badge, button, card, el, field, input, spinner } from '../core/dom.js';
import { acceptCall, endCall, listCalls, muteCall, offerCall, rejectCall } from '../api/calls.js';
import { navigate } from '../core/router.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

function peer(call) {
  const value = call?.displayPeerJid || call?.peerJidAlt || call?.callerPn || call?.peerJid || call?.peer || '';
  return String(value).replace(/@.+$/, '') || 'Desconhecido';
}
function stateLabel(state) {
  return {
    initiating: 'Iniciando',
    ringing: 'Chamando',
    incoming_ringing: 'Recebendo chamada',
    connecting: 'Conectando mídia',
    active: 'Em chamada',
    on_hold: 'Em espera',
    ended: 'Encerrada',
  }[String(state || '').toLowerCase()] || state || 'Desconhecido';
}

export function renderCalls(instance) {
  const session = loadSession();
  const page = el('div', { class: 'page calls-page' });
  const feedback = el('div');
  const list = el('div', { class: 'call-list' });
  const number = input('', { type: 'tel', inputmode: 'numeric', placeholder: '5575999999999' });
  let loading = false;
  let polling;

  async function act(action, callId, value) {
    try {
      if (action === 'accept') await acceptCall(session, instance, callId);
      if (action === 'reject') await rejectCall(session, instance, callId);
      if (action === 'end') await endCall(session, instance, callId);
      if (action === 'mute') await muteCall(session, instance, callId, value);
      await reload();
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  function draw(calls) {
    list.replaceChildren();
    if (!calls.length) {
      list.append(
        el(
          'div',
          { class: 'empty small' },
          el('strong', { text: 'Nenhuma chamada ativa' }),
          el('span', { text: 'As chamadas WhatsApp da instância aparecerão aqui.' }),
        ),
      );
      return;
    }
    calls.forEach((call) => {
      const callId = call.callId || call.id;
      const state = call.state || call.stateData?.state || 'unknown';
      const muted = Boolean(call.muted ?? call.stateData?.audioMuted);
      const actions = [];
      if (call.canAccept) actions.push(button('Atender', { class: 'primary', onclick: () => act('accept', callId) }));
      if (call.canReject) actions.push(button('Recusar', { class: 'danger', onclick: () => act('reject', callId) }));
      actions.push(button(muted ? 'Ativar áudio' : 'Silenciar', { onclick: () => act('mute', callId, !muted) }));
      actions.push(button('Encerrar', { class: 'danger', onclick: () => act('end', callId) }));
      list.append(
        card(
          el(
            'div',
            { class: 'call-row' },
            el(
              'div',
              { class: 'call-peer' },
              el('span', { class: 'call-icon', text: call.direction === 'incoming' ? '↙' : '↗' }),
              el(
                'div',
                {},
                el('strong', { text: peer(call) }),
                el('small', { text: call.direction === 'incoming' ? 'Recebida' : 'Efetuada' }),
              ),
            ),
            badge(stateLabel(state)),
            el('div', { class: 'actions' }, ...actions),
          ),
        ),
      );
    });
  }

  async function reload({ silent = false } = {}) {
    if (loading) return;
    loading = true;
    if (!silent) list.replaceChildren(el('div', { class: 'center' }, spinner()));
    try {
      const data = await listCalls(session, instance);
      draw(Array.isArray(data) ? data : data?.calls || []);
    } catch (error) {
      if (!silent) list.replaceChildren(alertBox(error.message || String(error)));
    } finally {
      loading = false;
    }
  }

  const callForm = el(
    'form',
    { class: 'call-dialer' },
    field('Número para chamada', number),
    button('Ligar', { class: 'primary', type: 'submit' }),
  );
  callForm.onsubmit = async (event) => {
    event.preventDefault();
    const target = number.value.replace(/\D/g, '');
    if (!target) return;
    feedback.replaceChildren();
    try {
      await offerCall(session, instance, target);
      number.value = '';
      await reload();
    } catch (error) {
      feedback.replaceChildren(alertBox(error.message || String(error)));
    }
  };

  page.append(
    pageHeader('Chamadas WhatsApp', 'Chamadas de voz da instância.', [
      button('Softphone', {
        onclick: () => navigate(`/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/voip`),
      }),
      button('Atualizar', { onclick: reload }),
    ]),
    feedback,
    card(callForm),
    list,
  );
  void reload();
  polling = setInterval(() => {
    if (!document.body.contains(page)) return clearInterval(polling);
    void reload({ silent: true });
  }, 2500);
  return instanceShell(instance, 'calls', page);
}
