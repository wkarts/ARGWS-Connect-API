import { alertBox, button, el, input, spinner } from '../core/dom.js';
import { fetchProfilePicture, findChats, findMessages, findStatusMessages, sendMedia, sendText } from '../api/chat.js';
import { getShowStatusInChat } from '../core/chat-preferences.js';
import { loadSession } from '../core/session.js';
import { instanceShell } from '../components/shell.js';

function rawChatJid(chat) {
  return chat?.remoteJid || chat?.id || chat?.key?.remoteJid || '';
}
function chatAltJid(chat) {
  return chat?.remoteJidAlt || chat?.lastMessage?.key?.remoteJidAlt || chat?.key?.remoteJidAlt || '';
}
function canonicalJid(chat) {
  const raw = rawChatJid(chat);
  const alt = chatAltJid(chat);
  return raw.endsWith('@lid') && alt && !alt.endsWith('@lid') ? alt : raw;
}
function isStatusJid(jid) {
  return String(jid || '') === 'status@broadcast';
}
function isProtocolMessage(message) {
  const payload = message?.message || {};
  const type = String(message?.messageType || '');
  return type === 'protocolMessage' || type === 'senderKeyDistributionMessage' || Boolean(payload.protocolMessage);
}
function chatName(chat) {
  const jid = canonicalJid(chat);
  if (isStatusJid(jid)) return 'Status do WhatsApp';
  return chat?.pushName || chat?.name || jid.split('@')[0] || 'Conversa';
}
function messageText(message) {
  if (!message || isProtocolMessage(message)) return '';
  const payload = message?.message || {};
  return (
    payload.conversation ||
    payload.extendedTextMessage?.text ||
    payload.imageMessage?.caption ||
    (payload.imageMessage ? '📷 Imagem' : '') ||
    payload.videoMessage?.caption ||
    (payload.videoMessage ? '🎥 Vídeo' : '') ||
    payload.documentMessage?.fileName ||
    (payload.documentMessage ? '📄 Documento' : '') ||
    (payload.audioMessage ? '🎤 Áudio' : '') ||
    (payload.stickerMessage ? 'Sticker' : '') ||
    payload.contactMessage?.displayName ||
    (payload.locationMessage ? '📍 Localização' : '') ||
    (payload.pollCreationMessage ? '📊 Enquete' : '') ||
    ''
  );
}
function messageTimestamp(message) {
  const value = Number(message?.messageTimestamp || message?.timestamp || 0);
  if (!value) return '';
  const date = new Date(value > 10_000_000_000 ? value : value * 1000);
  return Number.isNaN(date.getTime())
    ? ''
    : new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' }).format(date);
}

export function renderChat(instance, initialJid = '', { embedded = false } = {}) {
  const session = loadSession();
  const layout = el('div', { class: 'chat-layout whatsapp-like' });
  const list = el('aside', { class: 'chat-list' });
  const conversation = el('section', { class: 'conversation' });
  const aliases = new Map();
  const avatarCache = new Map();
  let chats = [];
  let selected = initialJid;
  let polling;
  let loadingChats = false;
  let loadingMessages = false;

  function registerAliases(chat) {
    const canonical = canonicalJid(chat);
    if (!canonical) return;
    const set = aliases.get(canonical) || new Set();
    [rawChatJid(chat), chatAltJid(chat), canonical].filter(Boolean).forEach((jid) => set.add(jid));
    aliases.set(canonical, set);
  }

  function dedupeChats(rows) {
    const map = new Map();
    rows.forEach((chat) => {
      registerAliases(chat);
      const jid = canonicalJid(chat);
      if (!jid || jid.endsWith('@broadcast')) return;
      const current = map.get(jid);
      if (!current || new Date(chat.updatedAt || 0) > new Date(current.updatedAt || 0)) map.set(jid, chat);
    });
    if (getShowStatusInChat(instance)) {
      map.set('status@broadcast', { remoteJid: 'status@broadcast', name: 'Status do WhatsApp', syntheticStatus: true });
      aliases.set('status@broadcast', new Set(['status@broadcast']));
    }
    return [...map.values()];
  }

  function avatar(chat, size = '') {
    const jid = canonicalJid(chat);
    const name = chatName(chat);
    const node = el('div', { class: `avatar ${size}`.trim(), text: name[0]?.toUpperCase() || '?' });
    if (!jid || jid.endsWith('@g.us') || jid.endsWith('@lid') || isStatusJid(jid)) return node;
    if (instance.connectionStatus !== 'open') return node;
    const cached = avatarCache.get(jid);
    if (cached) {
      node.replaceChildren(el('img', { src: cached, alt: '' }));
      return node;
    }
    void fetchProfilePicture(session, instance, jid)
      .then((data) => {
        const url = data?.profilePictureUrl || data?.url || data?.profilePicture?.url;
        if (url && document.body.contains(node)) {
          avatarCache.set(jid, url);
          node.replaceChildren(el('img', { src: url, alt: '' }));
        }
      })
      .catch(() => undefined);
    return node;
  }

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
      chats = dedupeChats(await findChats(session, instance));
      drawChats();
    } catch (error) {
      if (!silent) list.append(alertBox(error.message || String(error)));
    } finally {
      loadingChats = false;
    }
  }

  function drawChats() {
    const search = input('', { placeholder: 'Pesquisar ou iniciar nova conversa' });
    const rows = el('div', { class: 'chat-rows' });
    const header = el(
      'div',
      { class: 'chat-list-toolbar' },
      el('strong', { text: 'Conversas' }),
      button('↻', { class: 'icon-btn', onclick: () => loadChats() }),
    );
    const drawRows = () => {
      const term = search.value.trim().toLowerCase();
      rows.replaceChildren();
      const visible = chats.filter((chat) => `${chatName(chat)} ${canonicalJid(chat)}`.toLowerCase().includes(term));
      if (!visible.length) {
        rows.append(el('div', { class: 'empty small' }, el('span', { text: 'Nenhuma conversa.' })));
        return;
      }
      visible.forEach((chat) => {
        const jid = canonicalJid(chat);
        const preview = messageText(chat.lastMessage || {});
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
          avatar(chat),
          el(
            'div',
            { class: 'chat-row-body' },
            el(
              'div',
              { class: 'chat-row-top' },
              el('strong', { text: chatName(chat) }),
              el('small', { text: messageTimestamp(chat.lastMessage) }),
            ),
            el(
              'div',
              { class: 'chat-row-bottom' },
              el('span', { text: preview || (isStatusJid(jid) ? 'Atualizações de Status' : jid.split('@')[0]) }),
              Number(chat.unreadCount || 0) > 0
                ? el('b', { class: 'unread-badge', text: String(chat.unreadCount) })
                : null,
            ),
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
          el(
            'div',
            { class: 'empty conversation-empty' },
            el('strong', { text: 'Connect|API Chat' }),
            el('span', { text: 'Selecione uma conversa para começar.' }),
          ),
        );
      }
      return;
    }

    loadingMessages = true;
    const chat = chats.find((item) => canonicalJid(item) === selected) || { remoteJid: selected };
    const header = el(
      'div',
      { class: 'conversation-head' },
      el(
        'div',
        { class: 'conversation-person' },
        avatar(chat, 'large'),
        el(
          'div',
          {},
          el('strong', { text: chatName(chat) }),
          el('small', { text: isStatusJid(selected) ? 'Status do WhatsApp' : selected.replace(/@.+$/, '') }),
        ),
      ),
      el(
        'div',
        { class: 'actions' },
        instance.integration === 'WHATSAPP-ZAPO' && !isStatusJid(selected)
          ? button('☎', {
              class: 'icon-btn',
              onclick: () =>
                (location.href = `/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/calls`),
            })
          : null,
        button('↻', { class: 'icon-btn', onclick: () => loadMessages() }),
      ),
    );
    const messages = el('div', { class: 'messages' }, silent ? null : spinner());

    let composer = null;
    if (!isStatusJid(selected)) {
      const text = input('', { placeholder: 'Digite uma mensagem', autocomplete: 'off' });
      const file = el('input', { type: 'file', class: 'file-input' });
      const attach = button('＋', { class: 'icon-btn', onclick: () => file.click() });
      const formFeedback = el('div', { class: 'composer-feedback' });
      const form = el(
        'form',
        { class: 'composer' },
        attach,
        file,
        text,
        button('➤', { class: 'primary send-btn', type: 'submit' }),
      );
      composer = el('div', { class: 'composer-wrap' }, formFeedback, form);
      form.onsubmit = async (event) => {
        event.preventDefault();
        const body = text.value.trim();
        const attachment = file.files?.[0];
        if (!body && !attachment) return;
        formFeedback.replaceChildren();
        try {
          if (attachment) await sendMedia(session, instance, selected, attachment, body);
          else await sendText(session, instance, selected, body);
          text.value = '';
          file.value = '';
          await loadMessages();
        } catch (error) {
          formFeedback.replaceChildren(alertBox(error.message || String(error)));
        }
      };
    }

    if (!silent) conversation.replaceChildren(header, messages, composer);
    try {
      const batches = isStatusJid(selected)
        ? [await findStatusMessages(session, instance).catch(() => [])]
        : await Promise.all(
            [...(aliases.get(selected) || new Set([selected]))].map((jid) =>
              findMessages(session, instance, jid).catch(() => []),
            ),
          );
      const unique = new Map();
      batches.flat().forEach((message) => {
        if (isProtocolMessage(message)) return;
        unique.set(message.id || message.key?.id || JSON.stringify(message.key), message);
      });
      const rows = [...unique.values()].sort(
        (a, b) => Number(a.messageTimestamp || 0) - Number(b.messageTimestamp || 0),
      );
      const target = silent ? conversation.querySelector('.messages') : messages;
      if (target) renderMessageRows(target, rows);
    } catch (error) {
      if (!silent) messages.replaceChildren(alertBox(error.message || String(error)));
    } finally {
      loadingMessages = false;
    }
  }

  function renderMessageRows(target, rows) {
    target.replaceChildren();
    const visible = rows.filter((message) => messageText(message));
    if (!visible.length) {
      target.append(el('div', { class: 'conversation-no-messages', text: 'Nenhuma mensagem visível nesta conversa.' }));
      return;
    }
    visible.forEach((message) =>
      target.append(
        el(
          'div',
          { class: `bubble ${message.key?.fromMe ? 'mine' : ''}` },
          el('span', { text: messageText(message) }),
          el('small', { text: messageTimestamp(message) }),
        ),
      ),
    );
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
  }, 4000);
  return embedded ? el('main', { class: 'embedded-chat' }, layout) : instanceShell(instance, 'chat', layout);
}
