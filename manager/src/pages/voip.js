import { alertBox, badge, button, card, el, spinner } from '../core/dom.js';
import { listCalls } from '../api/calls.js';
import { navigate } from '../core/router.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

export function renderVoip(instance) {
  const session = loadSession();
  const page = el('div', { class: 'page softphone-page' });
  const status = el('div', { class: 'voip-status' }, spinner());
  const micState = el('span', { class: 'muted', text: 'Microfone não verificado' });

  async function testMicrophone() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.getTracks().forEach((track) => track.stop());
      micState.textContent = 'Microfone disponível';
      micState.className = 'success-text';
    } catch (error) {
      micState.textContent = 'Microfone indisponível ou sem permissão';
    }
  }

  async function reload() {
    try {
      const calls = await listCalls(session, instance);
      const active = Array.isArray(calls) ? calls.length : calls?.calls?.length || 0;
      status.replaceChildren(
        card(el('span', { class: 'muted', text: 'Canal de voz' }), el('strong', { text: 'WhatsApp / Zapo' })),
        card(el('span', { class: 'muted', text: 'Conexão' }), badge(instance.connectionStatus)),
        card(el('span', { class: 'muted', text: 'Chamadas ativas' }), el('strong', { text: String(active) })),
        card(el('span', { class: 'muted', text: 'Vídeo' }), el('strong', { text: 'Não habilitado' })),
      );
    } catch (error) {
      status.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  page.append(
    pageHeader('VoIP', 'Softphone PWA e acesso às chamadas da instância.', [button('Atualizar', { onclick: reload })]),
    el(
      'div',
      { class: 'voip-hero softphone-hero' },
      el(
        'div',
        {},
        el('h2', { text: 'Connect|API Softphone' }),
        el('p', {
          class: 'muted',
          text: 'A sinalização de chamadas já está ativa. O áudio no navegador será ligado pelo canal de mídia dedicado do Softphone PWA.',
        }),
        micState,
      ),
      el(
        'div',
        { class: 'actions' },
        button('Testar microfone', { onclick: testMicrophone }),
        button('Abrir chamadas', {
          class: 'primary',
          onclick: () => navigate(`/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/calls`),
        }),
      ),
    ),
    status,
  );
  void reload();
  return instanceShell(instance, 'voip', page);
}
