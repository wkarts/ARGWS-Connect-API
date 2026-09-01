/*
 * ARGWS Connect API - Manager runtime compatibility fixes
 *
 * Isolated compatibility layer for the bundled Manager distribution.
 * Keep this file small and removable when the Manager source is rebuilt
 * with the same fixes natively.
 */
(() => {
  'use strict';

  if (window.__ARGWS_RUNTIME_FIXES_LOADED__) return;
  window.__ARGWS_RUNTIME_FIXES_LOADED__ = true;

  const VERSION = '2026.09.01.2';
  const WEBHOOK_DISABLED_SENTINEL = 'https://disabled.invalid/';
  const nativeJsonParse = JSON.parse.bind(JSON);
  const runtimeState = {
    apiKey: null,
    instanceName: null,
  };

  window.__ARGWS_RUNTIME_FIXES__ = {
    version: VERSION,
    state: runtimeState,
  };

  const getUrl = (value) => {
    if (typeof value === 'string') return value;
    if (value instanceof URL) return value.toString();
    if (value && typeof value.url === 'string') return value.url;
    return '';
  };

  const captureInstanceName = (url) => {
    const match = String(url || '').match(/\/chat\/(?:findChats|findContacts|findMessages)\/([^/?#]+)/i);
    if (!match) return;

    try {
      runtimeState.instanceName = decodeURIComponent(match[1]);
    } catch {
      runtimeState.instanceName = match[1];
    }
  };

  const findInteractiveText = (message) => {
    if (!message || typeof message !== 'object') return '';

    const directCandidates = [
      message?.interactiveMessage?.body?.text,
      message?.viewOnceMessage?.message?.interactiveMessage?.body?.text,
      message?.viewOnceMessageV2?.message?.interactiveMessage?.body?.text,
      message?.viewOnceMessageV2Extension?.message?.interactiveMessage?.body?.text,
      message?.ephemeralMessage?.message?.interactiveMessage?.body?.text,
    ];

    const direct = directCandidates.find((value) => typeof value === 'string' && value.trim());
    if (direct) return direct;

    for (const value of Object.values(message)) {
      if (!value || typeof value !== 'object') continue;
      const nested = findInteractiveText(value);
      if (nested) return nested;
    }

    return '';
  };

  const normalizeInteractiveMessages = (node) => {
    if (Array.isArray(node)) {
      node.forEach(normalizeInteractiveMessages);
      return node;
    }

    if (!node || typeof node !== 'object') return node;

    if (node.message && typeof node.message === 'object') {
      const text = findInteractiveText(node.message);
      const interactiveType = [
        'interactiveMessage',
        'viewOnceMessage',
        'viewOnceMessageV2',
        'viewOnceMessageV2Extension',
        'ephemeralMessage',
      ].includes(node.messageType);

      if (text && interactiveType) {
        node.messageType = 'extendedTextMessage';
        node.message.extendedTextMessage = {
          ...(node.message.extendedTextMessage || {}),
          text,
        };
      }
    }

    Object.values(node).forEach((value) => {
      if (value && typeof value === 'object') normalizeInteractiveMessages(value);
    });

    return node;
  };

  const patchJsonParse = () => {
    JSON.parse = function argwsJsonParse(text, reviver) {
      const parsed = nativeJsonParse(text, reviver);

      if (typeof text === 'string' && text.includes('interactiveMessage')) {
        try {
          normalizeInteractiveMessages(parsed);
        } catch (error) {
          console.warn('[ARGWS Manager] Falha ao normalizar interactiveMessage em tempo real:', error);
        }
      }

      return parsed;
    };
  };

  const rewriteJsonRequestBody = (url, body) => {
    if (typeof body !== 'string' || !body.trim()) return body;

    const isSendMedia = /\/message\/sendMedia\//i.test(url);
    const isWebhookSet = /\/webhook\/set\//i.test(url);
    if (!isSendMedia && !isWebhookSet) return body;

    try {
      const data = nativeJsonParse(body);
      let changed = false;

      if (isSendMedia) {
        const media = data?.mediaMessage && typeof data.mediaMessage === 'object' ? data.mediaMessage : data;
        const mimeType = String(media?.mimetype || '').toLowerCase();
        const mediaType = String(media?.mediatype || '').toLowerCase();

        if (mediaType === 'text' || mimeType.startsWith('text/')) {
          media.mediatype = 'document';
          changed = true;
        }
      }

      if (isWebhookSet) {
        const webhook = data?.webhook && typeof data.webhook === 'object' ? data.webhook : data;
        if (webhook?.url === WEBHOOK_DISABLED_SENTINEL) {
          webhook.url = '';
          changed = true;
        }
      }

      return changed ? JSON.stringify(data) : body;
    } catch {
      return body;
    }
  };

  const normalizeMessagesResponseText = (url, text) => {
    if (!/\/chat\/findMessages\//i.test(url) || typeof text !== 'string' || !text.trim()) return text;

    try {
      const parsed = nativeJsonParse(text);
      normalizeInteractiveMessages(parsed);
      return JSON.stringify(parsed);
    } catch {
      return text;
    }
  };

  const patchXmlHttpRequest = () => {
    if (!window.XMLHttpRequest) return;

    const proto = window.XMLHttpRequest.prototype;
    const nativeOpen = proto.open;
    const nativeSend = proto.send;
    const nativeSetRequestHeader = proto.setRequestHeader;
    const responseTextDescriptor = Object.getOwnPropertyDescriptor(proto, 'responseText');

    proto.open = function patchedOpen(method, url, ...rest) {
      this.__argwsRequestUrl = getUrl(url);
      this.__argwsNormalizedResponseText = undefined;
      captureInstanceName(this.__argwsRequestUrl);
      return nativeOpen.call(this, method, url, ...rest);
    };

    proto.setRequestHeader = function patchedSetRequestHeader(name, value) {
      const normalizedName = String(name || '').toLowerCase();
      if (normalizedName === 'apikey' || normalizedName === 'api-key') {
        runtimeState.apiKey = String(value || '');
      }
      return nativeSetRequestHeader.call(this, name, value);
    };

    proto.send = function patchedSend(body) {
      const url = this.__argwsRequestUrl || '';
      const rewrittenBody = rewriteJsonRequestBody(url, body);
      return nativeSend.call(this, rewrittenBody);
    };

    if (responseTextDescriptor?.get && responseTextDescriptor.configurable) {
      Object.defineProperty(proto, 'responseText', {
        configurable: responseTextDescriptor.configurable,
        enumerable: responseTextDescriptor.enumerable,
        get() {
          const nativeText = responseTextDescriptor.get.call(this);
          const url = this.__argwsRequestUrl || '';

          if (this.readyState !== 4 || !/\/chat\/findMessages\//i.test(url)) {
            return nativeText;
          }

          if (this.__argwsNormalizedResponseSource === nativeText && this.__argwsNormalizedResponseText !== undefined) {
            return this.__argwsNormalizedResponseText;
          }

          this.__argwsNormalizedResponseSource = nativeText;
          this.__argwsNormalizedResponseText = normalizeMessagesResponseText(url, nativeText);
          return this.__argwsNormalizedResponseText;
        },
      });
    }
  };

  const patchFetch = () => {
    if (!window.fetch) return;

    const nativeFetch = window.fetch.bind(window);

    window.fetch = async (input, init) => {
      const url = getUrl(input);
      captureInstanceName(url);

      let nextInit = init;
      if (init && typeof init.body === 'string') {
        const rewrittenBody = rewriteJsonRequestBody(url, init.body);
        if (rewrittenBody !== init.body) nextInit = { ...init, body: rewrittenBody };
      }

      const response = await nativeFetch(input, nextInit);
      if (!/\/chat\/findMessages\//i.test(url)) return response;

      try {
        const originalText = await response.clone().text();
        const normalizedText = normalizeMessagesResponseText(url, originalText);
        if (normalizedText === originalText) return response;

        return new Response(normalizedText, {
          status: response.status,
          statusText: response.statusText,
          headers: response.headers,
        });
      } catch {
        return response;
      }
    };
  };

  const setNativeInputValue = (input, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
    descriptor?.set?.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const patchDisabledWebhookValidation = () => {
    document.addEventListener(
      'submit',
      (event) => {
        if (!/\/manager\/instance\/[^/]+\/webhook\/?$/i.test(window.location.pathname)) return;

        const form = event.target;
        if (!(form instanceof HTMLFormElement)) return;

        if (form.dataset.argwsWebhookResubmitting === '1') {
          delete form.dataset.argwsWebhookResubmitting;
          return;
        }

        const enabledSwitch = form.querySelector('[role="switch"]');
        const urlInput = form.querySelector('input[type="text"], input:not([type])');
        const isEnabled = enabledSwitch?.getAttribute('aria-checked') === 'true';

        if (isEnabled || !urlInput || urlInput.value.trim() !== '') return;

        event.preventDefault();
        event.stopImmediatePropagation();

        form.dataset.argwsWebhookResubmitting = '1';
        setNativeInputValue(urlInput, WEBHOOK_DISABLED_SENTINEL);

        window.setTimeout(() => {
          form.requestSubmit();
          window.setTimeout(() => setNativeInputValue(urlInput, ''), 800);
        }, 0);
      },
      true,
    );
  };

  const injectStyles = () => {
    if (document.getElementById('argws-runtime-fixes-style')) return;

    const style = document.createElement('style');
    style.id = 'argws-runtime-fixes-style';
    style.textContent = `
      .bubble-right .bubble {
        background: #dff8ef !important;
        color: #111827 !important;
        border: 1px solid #b9eadc !important;
        border-radius: 0.85rem !important;
        padding: 0.55rem 0.75rem !important;
      }
      .bubble-left .bubble {
        background: #ffffff !important;
        color: #111827 !important;
        border: 1px solid #e5e7eb !important;
        border-radius: 0.85rem !important;
        padding: 0.55rem 0.75rem !important;
      }
      .dark .bubble-right .bubble {
        background: #0b332a !important;
        color: #f8fafc !important;
        border-color: #145c4b !important;
      }
      .dark .bubble-left .bubble {
        background: #1f2937 !important;
        color: #f8fafc !important;
        border-color: #374151 !important;
      }
      #argws-new-chat-button {
        width: 100%;
        margin-top: .4rem;
        border: 1px solid hsl(var(--border));
        border-radius: .5rem;
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        padding: .5rem .65rem;
        font-size: .875rem;
        font-weight: 600;
        cursor: pointer;
        text-align: left;
      }
      #argws-new-chat-button:hover { background: hsl(var(--muted)); }
      .argws-contact-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 100000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 1rem;
        background: rgba(15, 23, 42, .48);
      }
      .argws-contact-modal {
        width: min(42rem, 100%);
        max-height: min(44rem, 88vh);
        overflow: hidden;
        display: flex;
        flex-direction: column;
        border: 1px solid hsl(var(--border));
        border-radius: .9rem;
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        box-shadow: 0 24px 70px rgba(15, 23, 42, .25);
      }
      .argws-contact-modal-header,
      .argws-contact-modal-footer { padding: 1rem; }
      .argws-contact-modal-header { border-bottom: 1px solid hsl(var(--border)); }
      .argws-contact-modal-footer {
        border-top: 1px solid hsl(var(--border));
        display: flex;
        justify-content: flex-end;
        gap: .6rem;
      }
      .argws-contact-modal h2 { margin: 0; font-size: 1.05rem; font-weight: 700; }
      .argws-contact-modal p { margin: .25rem 0 0; font-size: .82rem; opacity: .72; }
      .argws-contact-search { padding: 1rem; border-bottom: 1px solid hsl(var(--border)); }
      .argws-contact-search input {
        width: 100%;
        border: 1px solid hsl(var(--border));
        border-radius: .55rem;
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        padding: .65rem .75rem;
        outline: none;
      }
      .argws-contact-list { flex: 1; overflow: auto; padding: .5rem; min-height: 8rem; }
      .argws-contact-row {
        width: 100%;
        display: flex;
        flex-direction: column;
        gap: .12rem;
        border: 0;
        border-radius: .55rem;
        background: transparent;
        color: inherit;
        padding: .65rem .75rem;
        cursor: pointer;
        text-align: left;
      }
      .argws-contact-row:hover { background: hsl(var(--muted)); }
      .argws-contact-name { font-weight: 600; }
      .argws-contact-jid { font-size: .78rem; opacity: .68; }
      .argws-contact-status { padding: .8rem; font-size: .84rem; opacity: .72; text-align: center; }
      .argws-runtime-button {
        border: 1px solid hsl(var(--border));
        border-radius: .5rem;
        background: hsl(var(--background));
        color: hsl(var(--foreground));
        padding: .55rem .8rem;
        cursor: pointer;
      }
      .argws-runtime-button-primary {
        border-color: hsl(var(--primary));
        background: hsl(var(--primary));
        color: hsl(var(--primary-foreground));
      }
    `;
    document.head.appendChild(style);
  };

  const managerChatRoute = () => {
    const match = window.location.pathname.match(/^\/manager\/instance\/([^/]+)\/chat(?:\/.*)?\/?$/i);
    return match ? { instanceId: match[1] } : null;
  };

  const normalizeRemoteJid = (value) => {
    const raw = String(value || '').trim();
    if (!raw) return '';
    if (raw.includes('@')) return raw;

    const digits = raw.replace(/\D/g, '');
    return digits ? `${digits}@s.whatsapp.net` : '';
  };

  const openManagerChat = (rawRemoteJid) => {
    const route = managerChatRoute();
    const remoteJid = normalizeRemoteJid(rawRemoteJid);
    if (!route || !remoteJid) return false;

    window.location.assign(
      `/manager/instance/${encodeURIComponent(route.instanceId)}/chat/${encodeURIComponent(remoteJid)}`,
    );
    return true;
  };

  const resolveApiKey = () => {
    if (runtimeState.apiKey) return runtimeState.apiKey;

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !/(api.?key|token)/i.test(key)) continue;
      const value = localStorage.getItem(key);
      if (value && value.length >= 8) return value;
    }

    return '';
  };

  const resolveInstanceName = () => {
    if (runtimeState.instanceName) return runtimeState.instanceName;

    for (let index = 0; index < localStorage.length; index += 1) {
      const key = localStorage.key(index);
      if (!key || !/instance.?name/i.test(key)) continue;
      const value = localStorage.getItem(key);
      if (value) return value;
    }

    return '';
  };

  const contactRemoteJid = (contact) => contact?.remoteJid || contact?.id || contact?.jid || '';
  const contactName = (contact) => contact?.pushName || contact?.name || contact?.notify || contactRemoteJid(contact);

  const unwrapContacts = (payload) => {
    if (Array.isArray(payload)) return payload;
    if (Array.isArray(payload?.contacts?.records)) return payload.contacts.records;
    if (Array.isArray(payload?.contacts)) return payload.contacts;
    if (Array.isArray(payload?.records)) return payload.records;
    return [];
  };

  const fetchContacts = async () => {
    const instanceName = resolveInstanceName();
    const apiKey = resolveApiKey();
    if (!instanceName || !apiKey) return [];

    const response = await window.fetch(`/chat/findContacts/${encodeURIComponent(instanceName)}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        apikey: apiKey,
      },
      body: JSON.stringify({ where: {} }),
    });

    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return unwrapContacts(await response.json());
  };

  const createContactModal = async () => {
    if (document.querySelector('.argws-contact-modal-backdrop')) return;

    let contacts = [];

    const backdrop = document.createElement('div');
    backdrop.className = 'argws-contact-modal-backdrop';
    backdrop.innerHTML = `
      <section class="argws-contact-modal" role="dialog" aria-modal="true" aria-labelledby="argws-contact-modal-title">
        <header class="argws-contact-modal-header">
          <h2 id="argws-contact-modal-title">Nova conversa</h2>
          <p>Pesquise um contato sincronizado ou informe um número/JID.</p>
        </header>
        <div class="argws-contact-search">
          <input id="argws-contact-query" type="text" autocomplete="off" placeholder="Nome, número, +55... ou JID" />
        </div>
        <div id="argws-contact-list" class="argws-contact-list">
          <div class="argws-contact-status">Carregando contatos...</div>
        </div>
        <footer class="argws-contact-modal-footer">
          <button type="button" class="argws-runtime-button" data-action="cancel">Cancelar</button>
          <button type="button" class="argws-runtime-button argws-runtime-button-primary" data-action="open-manual">Abrir número/JID</button>
        </footer>
      </section>
    `;

    document.body.appendChild(backdrop);

    const input = backdrop.querySelector('#argws-contact-query');
    const list = backdrop.querySelector('#argws-contact-list');
    const close = () => backdrop.remove();

    const renderContacts = () => {
      const query = input.value.trim().toLocaleLowerCase('pt-BR');
      const filtered = contacts
        .filter((contact) => {
          const jid = String(contactRemoteJid(contact));
          if (!jid || jid.includes('@g.us')) return false;
          if (!query) return true;
          return `${contactName(contact)} ${jid}`.toLocaleLowerCase('pt-BR').includes(query);
        })
        .slice(0, 100);

      list.innerHTML = '';
      if (!filtered.length) {
        const empty = document.createElement('div');
        empty.className = 'argws-contact-status';
        empty.textContent = query
          ? 'Nenhum contato encontrado. Você ainda pode abrir pelo número/JID.'
          : 'Nenhum contato sincronizado encontrado.';
        list.appendChild(empty);
        return;
      }

      filtered.forEach((contact) => {
        const jid = contactRemoteJid(contact);
        const row = document.createElement('button');
        row.type = 'button';
        row.className = 'argws-contact-row';

        const name = document.createElement('span');
        name.className = 'argws-contact-name';
        name.textContent = contactName(contact);

        const jidElement = document.createElement('span');
        jidElement.className = 'argws-contact-jid';
        jidElement.textContent = String(jid).replace('@s.whatsapp.net', '');

        row.append(name, jidElement);
        row.addEventListener('click', () => openManagerChat(jid));
        list.appendChild(row);
      });
    };

    input.addEventListener('input', renderContacts);
    input.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      if (!openManagerChat(input.value)) {
        input.setCustomValidity('Informe um número ou JID válido.');
        input.reportValidity();
      }
    });

    backdrop.querySelector('[data-action="cancel"]').addEventListener('click', close);
    backdrop.querySelector('[data-action="open-manual"]').addEventListener('click', () => {
      if (!openManagerChat(input.value)) {
        input.setCustomValidity('Informe um número ou JID válido.');
        input.reportValidity();
      }
    });

    backdrop.addEventListener('mousedown', (event) => {
      if (event.target === backdrop) close();
    });

    input.focus();

    try {
      contacts = await fetchContacts();
      renderContacts();
    } catch (error) {
      list.innerHTML = '';
      const status = document.createElement('div');
      status.className = 'argws-contact-status';
      status.textContent = 'Não foi possível carregar os contatos agora. Informe o número/JID para iniciar a conversa.';
      list.appendChild(status);
      console.warn('[ARGWS Manager] Falha ao carregar contatos:', error);
    }
  };

  const ensureNewChatButton = () => {
    if (!managerChatRoute()) {
      document.getElementById('argws-new-chat-button')?.remove();
      return;
    }

    if (document.getElementById('argws-new-chat-button')) return;

    const tabs = document.querySelector('.tabs-chat');
    if (!tabs) return;

    const panel = tabs.closest('[data-panel]') || tabs.parentElement?.parentElement;
    const header = panel?.querySelector('.flex-shrink-0.p-2') || panel?.firstElementChild;
    if (!header) return;

    const button = document.createElement('button');
    button.id = 'argws-new-chat-button';
    button.type = 'button';
    button.textContent = '+ Nova conversa';
    button.addEventListener('click', createContactModal);
    header.appendChild(button);
  };

  const observeManagerNavigation = () => {
    const observer = new MutationObserver(() => ensureNewChatButton());
    const start = () => {
      if (!document.body) return;
      observer.observe(document.body, { childList: true, subtree: true });
      ensureNewChatButton();
    };

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', start, { once: true });
    } else {
      start();
    }
  };

  patchJsonParse();
  injectStyles();
  patchXmlHttpRequest();
  patchFetch();
  patchDisabledWebhookValidation();
  observeManagerNavigation();

  console.info(`[ARGWS Manager] Runtime fixes ${VERSION} carregadas.`);
})();
