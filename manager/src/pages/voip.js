import { alertBox, badge, button, card, el, spinner } from '../core/dom.js';
import { listCalls } from '../api/calls.js';
import { navigate } from '../core/router.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

export function renderVoip(instance) {
  const session = loadSession();
  const page = el('div', { class: 'page' });
  const status = el('div', { class: 'voip-status' }, spinner());

  async function reload() {
    try {
      const calls = await listCalls(session, instance);
      const active = Array.isArray(calls) ? calls.length : calls?.calls?.length || 0;
      status.replaceChildren(
        card(el('span', { class: 'muted', text: 'Provider' }), el('strong', { text: 'Zapo' })),
        card(
          el('span', { class: 'muted', text: 'Voz WhatsApp' }),
          badge(instance.connectionStatus === 'open' ? 'open' : 'close'),
        ),
        card(el('span', { class: 'muted', text: 'Chamadas ativas' }), el('strong', { text: String(active) })),
        card(el('span', { class: 'muted', text: 'Vídeo' }), el('strong', { text: 'Ainda não habilitado' })),
      );
    } catch (error) {
      status.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  page.append(
    pageHeader(
      'VoIP',
      'Camada de voz WhatsApp da instância. O áudio permanece no plano de mídia e não é enviado pelo EventManager.',
      [button('Atualizar', { onclick: reload })],
    ),
    el(
      'div',
      { class: 'voip-hero' },
      el(
        'div',
        {},
        el('h2', { text: 'Zapo VoIP' }),
        el('p', {
          class: 'muted',
          text: 'Chamadas de voz nativas do WhatsApp, prontas para integração com o Voice Core/PBX.',
        }),
      ),
      button('Abrir chamadas', {
        class: 'primary',
        onclick: () =>
          navigate(`/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/calls`),
      }),
    ),
    status,
  );
  void reload();
  return instanceShell(instance, 'voip', page);
}
