import { api } from '../api/manager.js';
import { alertBox, button, card, el, emptyState, input, spinner, textarea } from '../core/dom.js';
import { hasPermission } from '../core/session.js';
import { appShell, pageHeader } from '../components/shell.js';

export function renderConversations() {
  const page = el('div', { class: 'page' }, pageHeader('Conversas', 'Consulte chats e envie mensagens sem expor credenciais do Engine.'));
  const body = el('div', { class: 'center' }, spinner()); page.append(body);
  const url = new URL(location.href); const initialRef = url.searchParams.get('instance') || '';
  void load(initialRef);

  async function load(selectedRef) {
    try {
      const instances = await api.instances();
      if (!instances.length) { body.replaceChildren(emptyState('Nenhuma instância', 'Crie uma instância antes de acessar conversas.')); return; }
      const current = instances.find((item) => [item.id, item.instanceId, item.name].includes(selectedRef)) || instances[0];
      const ref = current.id || current.instanceId || current.name;
      const chats = await api.chats(ref).catch(() => []);
      draw(instances, current, ref, chats);
    } catch (error) { body.replaceChildren(alertBox(error.message || String(error))); }
  }

  function draw(instances, current, ref, chats) {
    const selector = el('select', { class: 'input compact-select' }, ...instances.map((item) => el('option', { value: item.id || item.instanceId || item.name, text: item.name || item.instanceName, selected: (item.id || item.instanceId || item.name) === ref })));
    selector.onchange = () => load(selector.value);
    const chatList = el('div', { class: 'chat-list' });
    const chatPane = el('div', { class: 'chat-pane' }, emptyState('Selecione uma conversa', 'As mensagens serão exibidas aqui.'));
    const search = input('', { placeholder: 'Buscar conversa' });
    const filteredDraw = () => {
      const term = search.value.toLowerCase(); chatList.replaceChildren();
      chats.filter((chat) => JSON.stringify(chat).toLowerCase().includes(term)).slice(0, 300).forEach((chat) => {
        const jid = chat.remoteJid || chat.id || chat?.key?.remoteJid || '';
        const title = chat.name || chat.pushName || chat.contact?.pushName || jid || 'Conversa';
        chatList.append(button(title, { class: 'chat-list-item', onclick: () => openChat(ref, jid, title, chatPane) }));
      });
      if (!chatList.children.length) chatList.append(emptyState('Nenhuma conversa', 'Não há chats para os filtros atuais.'));
    };
    search.addEventListener('input', filteredDraw); filteredDraw();
    body.replaceChildren(el('div', { class: 'conversation-toolbar' }, selector), card(el('div', { class: 'chat-layout' }, el('aside', { class: 'chat-sidebar' }, search, chatList), chatPane)));
  }
}

async function openChat(ref, jid, title, pane) {
  pane.replaceChildren(el('div', { class: 'center' }, spinner()));
  try {
    const messages = await api.messages(ref, jid);
    const list = el('div', { class: 'message-list' }, el('header', { class: 'chat-header' }, el('strong', { text: title }), el('span', { text: jid })));
    messages.slice(-200).forEach((message) => list.append(renderMessage(message)));
    const composer = el('form', { class: 'composer' });
    const text = textarea('', { rows: 2, placeholder: 'Digite uma mensagem...' });
    composer.append(text, button('Enviar', { class: 'primary', type: 'submit', disabled: !hasPermission('messages.send') }));
    composer.onsubmit = async (event) => { event.preventDefault(); if (!text.value.trim()) return; const send = composer.querySelector('button'); send.disabled = true; try { await api.sendText(ref, jid, text.value.trim()); text.value = ''; const fresh = await api.messages(ref, jid); list.querySelectorAll('.message-item').forEach((node) => node.remove()); fresh.slice(-200).forEach((message) => list.append(renderMessage(message))); } catch (error) { list.append(alertBox(error.message || String(error))); } finally { send.disabled = false; } };
    pane.replaceChildren(list, composer); list.scrollTop = list.scrollHeight;
  } catch (error) { pane.replaceChildren(alertBox(error.message || String(error))); }
}
function renderMessage(message) {
  const fromMe = Boolean(message?.key?.fromMe || message?.fromMe);
  const content = message?.message?.conversation || message?.message?.extendedTextMessage?.text || message?.text || message?.body || '[Mensagem]';
  return el('div', { class: `message-item ${fromMe ? 'from-me' : ''}` }, el('div', { class: 'message-bubble', text: String(content) }));
}
