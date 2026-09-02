(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = { timer: null, lastKey: '', lastPreview: null };

  function apiKey() { return String($('apiKeyInput')?.value || '').trim(); }
  function instanceName() { return String($('instanceSelect')?.value || '').trim(); }
  function parseJson(value, fallback = {}) { try { return JSON.parse(value || '{}'); } catch { return fallback; } }
  function esc(value) { return String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;' })[c]); }

  function components() {
    const result = [];
    const header = String($('headerInput')?.value || '').trim();
    const body = String($('bodyInput')?.value || '');
    const footer = String($('footerInput')?.value || '').trim();
    if (header) result.push({ type: 'HEADER', format: 'TEXT', text: header });
    if (body) result.push({ type: 'BODY', text: body });
    if (footer) result.push({ type: 'FOOTER', text: footer });

    const buttons = Array.from(document.querySelectorAll('#buttonEditor .button-row, #buttonEditor [data-button-index]')).map((row) => {
      const fields = row.querySelectorAll('input,select');
      const type = String(fields[0]?.value || 'QUICK_REPLY').toUpperCase();
      const text = String(fields[1]?.value || '').trim();
      const id = String(fields[2]?.value || '').trim();
      if (!text) return null;
      if (type === 'URL') return { type, text, url: id };
      if (type === 'PHONE_NUMBER') return { type, text, phone_number: id };
      if (type === 'COPY_CODE') return { type, text, example: id };
      return { type: 'QUICK_REPLY', text, id };
    }).filter(Boolean);
    if (buttons.length) result.push({ type: 'BUTTONS', buttons });
    return result;
  }

  function ensureCard() {
    let card = $('providerTransportPreview');
    if (card) return card;
    const panel = document.querySelector('.preview-panel');
    if (!panel) return null;
    card = document.createElement('section');
    card.id = 'providerTransportPreview';
    card.className = 'provider-transport-card';
    card.innerHTML = '<div class="provider-transport-title">Transporte real</div><div class="provider-transport-body">Conecte uma instância para visualizar.</div>';
    const help = panel.querySelector('.preview-help');
    panel.insertBefore(card, help || null);
    return card;
  }

  function previewPoll(rendered) {
    const options = (rendered.buttons || []).map((button) => `<div class="phase5-poll-option"><span class="phase5-radio"></span><span>${esc(button.displayText || button.title || '')}</span></div>`).join('');
    return `${rendered.title ? `<div class="preview-header">${esc(rendered.title)}</div>` : ''}<div class="preview-body phase5-poll-body">${esc(rendered.text || 'Escolha uma opção')}</div><div class="phase5-poll-label">Selecione uma opção</div>${options}${rendered.footer ? `<div class="preview-footer">${esc(rendered.footer)}</div>` : ''}`;
  }

  function previewTextCompat(rendered) {
    const lines = [];
    if (rendered.title) lines.push(rendered.title);
    if (rendered.text) lines.push(rendered.text);
    if (rendered.footer) lines.push(rendered.footer);
    if ((rendered.buttons || []).length) {
      lines.push((rendered.buttons || []).map((button) => {
        if (button.type === 'url') return `${button.displayText}: ${button.url || ''}`;
        if (button.type === 'call') return `${button.displayText}: ${button.phoneNumber || ''}`;
        if (button.type === 'copy') return `${button.displayText}: ${button.copyCode || ''}`;
        return `• ${button.displayText || ''}`;
      }).join('\n'));
    }
    return `<div class="preview-body phase5-text-compat">${esc(lines.filter(Boolean).join('\n\n'))}</div>`;
  }

  function applyPreview(data) {
    state.lastPreview = data;
    const transport = data?.transport || {};
    const rendered = data?.rendered || {};
    const card = ensureCard();
    if (card) {
      const warning = (transport.warnings || []).map((item) => `<div class="phase5-warning">${esc(item)}</div>`).join('');
      card.innerHTML = `<div class="provider-transport-title"><span>Transporte real</span><span class="phase5-badge">${esc(data.provider || 'UNKNOWN')}</span></div><div class="phase5-mode-row"><strong>${esc(transport.mode || 'UNKNOWN')}</strong>${transport.degraded ? '<span class="phase5-degraded">compatibilidade</span>' : '<span class="phase5-native">nativo</span>'}</div>${warning}`;
    }

    const message = $('messagePreview');
    if (!message) return;
    if (transport.mode === 'POLL_COMPAT') message.innerHTML = previewPoll(rendered);
    else if (transport.mode === 'TEXT_COMPAT') message.innerHTML = previewTextCompat(rendered);
    else {
      const buttons = (rendered.buttons || []).map((button) => `<div class="preview-button">${esc(button.displayText || '')}</div>`).join('');
      message.innerHTML = `${rendered.title ? `<div class="preview-header">${esc(rendered.title)}</div>` : ''}<div class="preview-body">${esc(rendered.text || '')}</div>${rendered.footer ? `<div class="preview-footer">${esc(rendered.footer)}</div>` : ''}${buttons}`;
    }
  }

  async function refresh() {
    const instance = instanceName();
    const key = apiKey();
    if (!instance || !key) { ensureCard(); return; }
    const body = {
      name: String($('nameInput')?.value || '').trim() || 'draft_template',
      language: String($('languageInput')?.value || 'pt_BR'),
      category: String($('categoryInput')?.value || 'UTILITY'),
      components: components(),
      variables: parseJson($('variablesInput')?.value, {}),
    };
    const signature = JSON.stringify([instance, body]);
    if (signature === state.lastKey) return;
    state.lastKey = signature;
    const response = await fetch(`/template/preview/${encodeURIComponent(instance)}`, {
      method: 'POST',
      headers: { apikey: key, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.response?.message || data?.message || `HTTP ${response.status}`);
    applyPreview(data);
  }

  function schedule() {
    window.clearTimeout(state.timer);
    state.timer = window.setTimeout(() => refresh().catch((error) => {
      state.lastKey = '';
      const card = ensureCard();
      if (card) card.innerHTML = `<div class="provider-transport-title">Transporte real</div><div class="phase5-warning">Preview indisponível: ${esc(error.message)}</div>`;
    }), 320);
  }

  ensureCard();
  ['nameInput','languageInput','categoryInput','headerInput','footerInput','bodyInput','variablesInput','instanceSelect','apiKeyInput'].forEach((id) => {
    const node = $(id); if (node) { node.addEventListener('input', schedule); node.addEventListener('change', schedule); }
  });
  $('connectButton')?.addEventListener('click', () => window.setTimeout(schedule, 650));
  $('refreshButton')?.addEventListener('click', () => window.setTimeout(schedule, 400));
  document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => { if (tab.dataset.tab === 'content' || tab.dataset.tab === 'test') schedule(); }));
  const editor = $('buttonEditor');
  if (editor) {
    editor.addEventListener('input', schedule);
    editor.addEventListener('change', schedule);
    new MutationObserver(schedule).observe(editor, { childList: true, subtree: true, attributes: true });
  }
  window.setTimeout(schedule, 900);
})();
