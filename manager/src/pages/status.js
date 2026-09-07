import { alertBox, button, card, el, spinner, toggle } from '../core/dom.js';
import { fetchProfilePicture, findStatusMessages } from '../api/chat.js';
import { getShowStatusInChat, setShowStatusInChat } from '../core/chat-preferences.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

function textOf(message) {
  const payload = message?.message || {};
  return (
    payload.conversation ||
    payload.extendedTextMessage?.text ||
    payload.imageMessage?.caption ||
    (payload.imageMessage ? '📷 Foto' : '') ||
    payload.videoMessage?.caption ||
    (payload.videoMessage ? '🎥 Vídeo' : '') ||
    (payload.audioMessage ? '🎤 Áudio' : '') ||
    ''
  );
}
function participantOf(message) {
  return message?.key?.participantAlt || message?.key?.participant || message?.participant || '';
}
function timeOf(message) {
  const value = Number(message?.messageTimestamp || 0);
  if (!value) return '';
  return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(new Date(value * 1000));
}

export function renderStatus(instance) {
  const session = loadSession();
  const page = el('div', { class: 'page status-page' });
  const content = el('div', { class: 'status-feed' }, spinner());

  async function reload() {
    content.replaceChildren(spinner());
    try {
      const messages = (await findStatusMessages(session, instance)).filter(
        (message) => message.messageType !== 'protocolMessage' && textOf(message),
      );
      content.replaceChildren();
      if (!messages.length) {
        content.append(
          el(
            'div',
            { class: 'empty' },
            el('strong', { text: 'Nenhum Status disponível' }),
            el('span', { text: 'As atualizações recebidas pelo WhatsApp aparecerão aqui.' }),
          ),
        );
        return;
      }
      for (const message of messages.sort((a, b) => Number(b.messageTimestamp || 0) - Number(a.messageTimestamp || 0))) {
        const participant = participantOf(message);
        const avatar = el('div', { class: 'avatar', text: (message.pushName || participant || 'S')[0].toUpperCase() });
        if (participant && !participant.endsWith('@lid')) {
          void fetchProfilePicture(session, instance, participant)
            .then((data) => {
              const url = data?.profilePictureUrl || data?.url;
              if (url && document.body.contains(avatar)) avatar.replaceChildren(el('img', { src: url, alt: '' }));
            })
            .catch(() => undefined);
        }
        content.append(
          card(
            el(
              'div',
              { class: 'status-feed-row' },
              avatar,
              el(
                'div',
                { class: 'status-feed-body' },
                el('strong', { text: message.pushName || participant.replace(/@.+$/, '') || 'Status' }),
                el('span', { text: textOf(message) }),
                el('small', { text: timeOf(message) }),
              ),
            ),
          ),
        );
      }
    } catch (error) {
      content.replaceChildren(alertBox(error.message || String(error)));
    }
  }

  page.append(
    pageHeader('Status', 'Atualizações do WhatsApp separadas das conversas.', [button('Atualizar', { onclick: reload })]),
    card(
      toggle('Mostrar Status também na lista do Chat', getShowStatusInChat(instance), (value) => {
        setShowStatusInChat(instance, value);
      }),
    ),
    content,
  );
  void reload();
  return instanceShell(instance, 'status', page);
}
