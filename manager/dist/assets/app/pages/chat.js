import { alertBox, button, el, input, spinner } from '../core/dom.js';
import { findChats, findMessages, sendMedia, sendText } from '../api/chat.js';
import { loadSession } from '../core/session.js';
import { instanceShell } from '../components/shell.js';

function chatJid(chat) {
  return chat.remoteJid || chat.id || chat.key?.remoteJid || '';
}

function chatName(chat) {
  const jid = chatJid(chat);
  return chat.pushName || chat.name || jid.split('@')[0] || 'Conversa';
}

function messageText(message) {
  const payload = message.message || {};
  return (
    payload.conversation ||
    payload.extendedTextMessage?.text ||
    payload.imageMessage?.caption ||
    payload.videoMessage?.caption ||
    payload.documentMessage?.fileName ||
    payload.audioMessage?.mimetype ||
    message.messageType ||
    '[mídia]'
  );
}

function messageTimestamp(message) {
  const value = Number(message.messageTimestamp || message.timestamp || 0);
  if (!value) return '';
  const date = new Date(value > 10_000_000_000 ? value : value * 1000);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function renderChat(instance, initialJid = '', { embedded = false } = {}) {
  const session = loadSession();
  const layout = el('div', { class: 'chat-layout' });
  const list = el('aside', { class: 'chat-list' });
  const conversation = el('section', { class: 'conversation' });
  let chats = [];
  let selected = initialJid;
  let polling = null;
  let loadingChats = false;
  let loadingMessages = false;

  async function loadChats({ silent = false } = {}) {
    if (loadingChats) return;
    loadingChats = true;
    if (!silent) {
      list.replaceChildren(
        el('div', { class: 'chat-list-head' }, el('strong', { text: 'Conversas' })),
        el('div', { class: 'center' }, spinner()),
      );
    }

    try {
      chats = await findChats(session, instance);
      drawChats();
    } catch (error) {
      if (!silent) list.append(alertBox(error.message || String(error)));
    } finally {
      loadingChats = false;
    }
  }

  function drawChats() {
    const search = input('', { placeholder: 'Buscar conversa' });
    const rows = el('div');
    const header = el(
      'div',
      { class: 'chat-list-toolbar' },
      el('strong', { text: 'Conversas' }),
      button('↻', { onclick: () => loadChats() }),
    );

    const drawRows = () => {
      const term = search.value.trim().toLowerCase();
      rows.replaceChildren();
      const visible = chats.filter((chat) => {
        const jid = chatJid(chat);
        return jid && `${chatName(chat)} ${jid}`.toLowerCase().includes(term);
      });

      if (!visible.length) {
        rows.append(el('div', { class: 'empty small' }, el('span', { text: 'Nenhuma conversa.' })));
        return;
      }

      visible.forEach((chat) => {
        const jid = chatJid(chat);
        const row = el(
          'button',
          {
            class: `chat-row ${selected === jid ? 'active' : ''}`,
            onclick: () => {
              selected = jid;
              history.replaceState(
                {},
                '',
                embedded
                  ? `/manager/embed-chat/${encodeURIComponent(jid)}`
                  : `/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/chat/${encodeURIComponent(jid)}`,
              );
              drawChats();
              void loadMessages();
            },
          },
          el('div', { class: 'avatar', text: chatName(chat)[0]?.toUpperCase() || '?' }),
          el(
            'div',
            {},
            el('strong', { text: chatName(chat) }),
            el('span', { text: jid.split('@')[0] }),
          ),
        );
        rows.append(row);
      });
    };

    search.addEventListener('input', drawRows);
    list.replaceChildren(header, el('div', { class: 'chat-search' }, search), rows);
    drawRows();
  }

  async function loadMessages({ silent = false } = {}) {
    if (loadingMessages || !selected) {
      if (!selected && !silent) {
        conversation.replaceChildren(
          el('div', { class: 'empty' }, el('strong', { text: 'Selecione uma conversa' })),
        );
      }
      return;
    }

    loadingMessages = true;
    const chat = chats.find((item) => chatJid(item) === selected);
    const header = el(
      'div',
      { class: 'conversation-head' },
      el('div', {}, el('strong', { text: chatName(chat || { remoteJid: selected }) }), el('small', { text: selected })),
      button('↻', { onclick: () => loadMessages() }),
    );
    const messages = el('div', { class: 'messages' }, silent ? null : spinner());
    const text = input('', { placeholder: 'Digite uma mensagem', autocomplete: 'off' });
    const file = el('input', { type: 'file', class: 'file-input' });
    const attach = button('＋', {
      class: 'icon-btn',
      onclick: () => file.click(),
    });
    const formFeedback = el('div', { class: 'composer-feedback' });
    const form = el(
      'form',
      { class: 'composer' },
      attach,
      file,
      text,
      button('Enviar', { class: 'primary', type: 'submit' }),
    );
    const composer = el('div', {}, formFeedback, form);

    form.onsubmit = async (event) => {
      event.preventDefault();
      const body = text.value.trim();
      const attachment = file.files?.[0];
      if (!body && !attachment) return;

      formFeedback.replaceChildren();
      try {
        if (attachment) {
          await sendMedia(session, instance, selected, attachment, body);
        } else {
          await sendText(session, instance, selected, body);
        }
        text.value = '';
        file.value = '';
        await loadMessages();
      } catch (error) {
        formFeedback.replaceChildren(alertBox(error.message || String(error)));
      }
    };

    if (!silent) conversation.replaceChildren(header, messages, composer);

    try {
      const rows = await findMessages(session, instance, selected);
      if (silent) {
        const currentMessages = conversation.querySelector('.messages');
        if (!currentMessages) return;
        renderMessageRows(currentMessages, rows);
      } else {
        renderMessageRows(messages, rows);
      }
    } catch (error) {
      if (!silent) messages.replaceChildren(alertBox(error.message || String(error)));
    } finally {
      loadingMessages = false;
    }
  }

  function renderMessageRows(target, rows) {
    target.replaceChildren();
    rows.forEach((message) => {
      target.append(
        el(
          'div',
          { class: `bubble ${message.key?.fromMe ? 'mine' : ''}` },
          el('span', { text: messageText(message) }),
          el('small', { text: messageTimestamp(message) }),
        ),
      );
    });
    target.scrollTop = target.scrollHeight;
  }

  layout.append(list, conversation);
  void loadChats().then(() => loadMessages());

  polling = setInterval(() => {
    if (!document.body.contains(layout)) {
      clearInterval(polling);
      return;
    }
    void loadChats({ silent: true });
    if (selected) void loadMessages({ silent: true });
  }, 5000);

  return embedded ? el('main', { class: 'embedded-chat' }, layout) : instanceShell(instance, 'chat', layout);
}
