(() => {
  'use strict';

  const $ = (id) => document.getElementById(id);
  const state = {
    apiKey: '',
    instanceName: '',
    instanceId: '',
    templates: [],
    selected: null,
    actions: [],
    recipes: [],
    buttons: [],
    bindings: [],
    actionsRaw: { bindings: [] },
    policy: { interactionTtlSeconds: 86400 },
  };

  const refs = {
    apiKey: $('apiKeyInput'), instance: $('instanceSelect'), badge: $('connectionBadge'),
    templateList: $('templateList'), search: $('templateSearch'), name: $('nameInput'), language: $('languageInput'),
    category: $('categoryInput'), header: $('headerInput'), footer: $('footerInput'), body: $('bodyInput'),
    buttons: $('buttonEditor'), bindings: $('bindingEditor'), actionsJson: $('actionsJsonInput'), policyJson: $('policyJsonInput'),
    enabled: $('enabledInput'), preview: $('messagePreview'), editorMode: $('editorMode'), editorTitle: $('editorTitle'),
    origin: $('originBadge'), status: $('statusBadge'), variables: $('variablesInput'), testNumber: $('testNumberInput'),
    testStatus: $('testStatus'), toast: $('toast'),
  };

  function toast(message, error = false) {
    refs.toast.textContent = message;
    refs.toast.classList.toggle('error', error);
    refs.toast.classList.add('show');
    window.clearTimeout(toast.timer);
    toast.timer = window.setTimeout(() => refs.toast.classList.remove('show'), 3200);
  }

  function safeJson(text, fallback = {}) {
    try { return JSON.parse(text || ''); } catch { return fallback; }
  }

  function storedApiKey() {
    const candidates = [];
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      if (!key || !/(api.?key|token)/i.test(key)) continue;
      const value = localStorage.getItem(key);
      if (value && value.length >= 8) candidates.push(value);
    }
    return candidates[0] || '';
  }

  function queryParam(name) { return new URLSearchParams(window.location.search).get(name) || ''; }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (state.apiKey) headers.apikey = state.apiKey;
    if (options.body && typeof options.body !== 'string') {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(options.body);
    }
    const response = await fetch(path, { ...options, headers });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const detail = data?.response?.message || data?.message || data?.error?.message || text || `HTTP ${response.status}`;
      throw new Error(Array.isArray(detail) ? detail.join('; ') : String(detail));
    }
    return data;
  }

  function collectInstances(node, out = []) {
    if (Array.isArray(node)) { node.forEach((item) => collectInstances(item, out)); return out; }
    if (!node || typeof node !== 'object') return out;
    const name = node.instanceName || node.name || node.instance?.instanceName;
    const id = node.instanceId || node.id || node.instance?.instanceId;
    if (name && (node.integration || node.connectionStatus || node.instance || id)) {
      if (!out.some((item) => item.name === name)) out.push({ name: String(name), id: id ? String(id) : '', raw: node });
    }
    Object.values(node).forEach((value) => {
      if (value && typeof value === 'object') collectInstances(value, out);
    });
    return out;
  }

  function normalizeArray(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.templates)) return data.templates;
    if (Array.isArray(data?.records)) return data.records;
    return [];
  }

  async function connect() {
    state.apiKey = refs.apiKey.value.trim();
    if (!state.apiKey) throw new Error('Informe a API key.');
    const data = await api('/instance/fetchInstances');
    const instances = collectInstances(data);
    refs.instance.innerHTML = '<option value="">Selecione uma instância</option>' + instances
      .map((item) => `<option value="${escapeHtml(item.name)}" data-id="${escapeHtml(item.id)}">${escapeHtml(item.name)}</option>`).join('');

    const desiredName = queryParam('instance') || localStorage.getItem('argws-template-editor-instance') || '';
    const desiredId = queryParam('instanceId') || '';
    const match = instances.find((item) => item.name === desiredName || (desiredId && item.id === desiredId));
    if (match) refs.instance.value = match.name;
    else if (instances.length === 1) refs.instance.value = instances[0].name;

    state.instanceName = refs.instance.value;
    syncInstanceId(instances);
    refs.badge.textContent = `${instances.length} instância(s)`;
    refs.badge.className = 'badge connected';
    if (state.instanceName) await loadWorkspace();
  }

  function syncInstanceId(instances) {
    const selected = refs.instance.selectedOptions[0];
    state.instanceId = selected?.dataset?.id || instances?.find((item) => item.name === refs.instance.value)?.id || '';
  }

  async function loadWorkspace() {
    if (!state.instanceName) return;
    localStorage.setItem('argws-template-editor-instance', state.instanceName);
    const [templates, actions, recipes] = await Promise.all([
      api(`/template/find/${encodeURIComponent(state.instanceName)}`),
      api(`/action/find/${encodeURIComponent(state.instanceName)}`).catch(() => []),
      api(`/recipe/find/${encodeURIComponent(state.instanceName)}`).catch(() => []),
    ]);
    state.templates = normalizeArray(templates);
    state.actions = normalizeArray(actions);
    state.recipes = normalizeArray(recipes);
    renderTemplateList();
    if (state.selected) {
      const selectedId = templateIdentifier(state.selected);
      const refreshed = state.templates.find((item) => templateIdentifier(item) === selectedId);
      if (refreshed) selectTemplate(refreshed);
    }
  }

  function templateIdentifier(template) {
    return String(template?.id || template?.templateId || template?.externalTemplateId || `${template?.name}:${template?.language}`);
  }

  function renderTemplateList() {
    const filter = refs.search.value.trim().toLowerCase();
    const list = state.templates.filter((item) => !filter || `${item.name} ${item.language} ${item.category}`.toLowerCase().includes(filter));
    if (!list.length) {
      refs.templateList.innerHTML = '<div class="empty">Nenhum template encontrado.</div>';
      return;
    }
    refs.templateList.innerHTML = list.map((item) => {
      const active = state.selected && templateIdentifier(state.selected) === templateIdentifier(item) ? ' active' : '';
      return `<div class="template-item${active}" data-template-id="${escapeHtml(templateIdentifier(item))}">
        <strong>${escapeHtml(item.name || 'sem_nome')}</strong>
        <div class="meta"><span class="tiny">${escapeHtml(item.language || 'pt_BR')}</span><span class="tiny">${escapeHtml(item.category || 'UTILITY')}</span><span class="tiny">${escapeHtml(item.origin || 'META')}</span></div>
      </div>`;
    }).join('');
    refs.templateList.querySelectorAll('.template-item').forEach((node) => node.addEventListener('click', () => {
      const template = state.templates.find((item) => templateIdentifier(item) === node.dataset.templateId);
      if (template) selectTemplate(template);
    }));
  }

  function component(template, type) {
    return (template?.components || []).find((item) => String(item.type || '').toUpperCase() === type);
  }

  function selectTemplate(template) {
    state.selected = template;
    refs.name.value = template.name || '';
    refs.language.value = template.language || 'pt_BR';
    refs.category.value = template.category || 'UTILITY';
    refs.header.value = component(template, 'HEADER')?.text || '';
    refs.body.value = component(template, 'BODY')?.text || '';
    refs.footer.value = component(template, 'FOOTER')?.text || '';
    const buttonComponent = component(template, 'BUTTONS');
    state.buttons = Array.isArray(buttonComponent?.buttons) ? buttonComponent.buttons.map(normalizeButton) : [];
    state.actionsRaw = (template.actions && typeof template.actions === 'object') ? structuredClone(template.actions) : { bindings: [] };
    state.bindings = Array.isArray(state.actionsRaw.bindings) ? state.actionsRaw.bindings.map(normalizeBinding) : [];
    state.policy = (template.policy && typeof template.policy === 'object') ? structuredClone(template.policy) : { interactionTtlSeconds: 86400 };
    refs.enabled.checked = template.enabled !== false;
    refs.editorMode.textContent = template.isDefault ? 'Template padrão' : 'Editando template';
    refs.editorTitle.textContent = template.name || 'Template';
    refs.origin.textContent = template.origin || 'META';
    refs.status.textContent = template.status || 'APPROVED';
    refs.status.className = `badge ${String(template.status || '').toUpperCase() === 'APPROVED' ? 'success' : 'warning'}`;
    syncAdvancedJson();
    renderButtons(); renderBindings(); renderPreview(); renderTemplateList();
  }

  function newTemplate() {
    state.selected = null;
    refs.name.value = '';
    refs.language.value = 'pt_BR';
    refs.category.value = 'UTILITY';
    refs.header.value = '';
    refs.body.value = 'Olá {{customer.name}}, como podemos ajudar?';
    refs.footer.value = '';
    refs.enabled.checked = true;
    state.buttons = [{ type: 'QUICK_REPLY', text: 'Continuar', id: 'continue' }];
    state.bindings = [];
    state.actionsRaw = { bindings: [] };
    state.policy = { interactionTtlSeconds: 86400 };
    refs.editorMode.textContent = 'Novo template';
    refs.editorTitle.textContent = 'Template sem título';
    refs.origin.textContent = 'LOCAL';
    refs.status.textContent = 'APPROVED';
    refs.status.className = 'badge success';
    syncAdvancedJson(); renderButtons(); renderBindings(); renderPreview(); renderTemplateList();
  }

  function duplicateTemplate() {
    if (!state.selected) return newTemplate();
    state.selected = null;
    refs.name.value = `${refs.name.value}_copy`;
    refs.editorMode.textContent = 'Cópia de template';
    refs.editorTitle.textContent = refs.name.value;
    toast('Cópia preparada. Ajuste o nome e salve.');
    renderTemplateList();
  }

  function normalizeButton(button) {
    return {
      type: String(button.type || 'QUICK_REPLY').toUpperCase(),
      text: button.text || button.title || '',
      id: button.id || button.payload || '',
      url: button.url || '',
      phone_number: button.phone_number || '',
      example: button.example || button.code || '',
    };
  }

  function normalizeBinding(binding) {
    return {
      id: binding.id || '', matchTitle: binding.matchTitle || '', type: String(binding.type || 'NONE').toUpperCase(),
      key: binding.key || binding.actionKey || binding.recipeKey || '', confirmOnInteraction: binding.confirmOnInteraction !== false,
      input: binding.input || {}, response: binding.response || null, onError: binding.onError || null,
      keepSessionOpen: binding.keepSessionOpen === true,
    };
  }

  function addButton() {
    const index = state.buttons.length + 1;
    state.buttons.push({ type: 'QUICK_REPLY', text: `Opção ${index}`, id: `option_${index}` });
    renderButtons(); renderBindings(); renderPreview();
  }

  function renderButtons() {
    if (!state.buttons.length) refs.buttons.innerHTML = '<div class="empty">Nenhum botão adicionado.</div>';
    else refs.buttons.innerHTML = state.buttons.map((button, index) => `<div class="editor-card" data-button-index="${index}">
      <div class="editor-card-header"><strong>Botão ${index + 1}</strong><button data-remove-button="${index}" type="button">Remover</button></div>
      <div class="card-grid">
        <label><span>Tipo</span><select data-button-field="type"><option ${button.type === 'QUICK_REPLY' ? 'selected' : ''}>QUICK_REPLY</option><option ${button.type === 'URL' ? 'selected' : ''}>URL</option><option ${button.type === 'PHONE_NUMBER' ? 'selected' : ''}>PHONE_NUMBER</option><option ${button.type === 'COPY_CODE' ? 'selected' : ''}>COPY_CODE</option></select></label>
        <label><span>Texto</span><input data-button-field="text" value="${escapeAttr(button.text)}" /></label>
        <label><span>${buttonValueLabel(button.type)}</span><input data-button-field="value" value="${escapeAttr(buttonValue(button))}" /></label>
      </div>
    </div>`).join('');
    refs.buttons.querySelectorAll('[data-remove-button]').forEach((node) => node.addEventListener('click', () => {
      const index = Number(node.dataset.removeButton); const removed = state.buttons.splice(index, 1)[0];
      if (removed?.id) state.bindings = state.bindings.filter((item) => item.id !== removed.id);
      renderButtons(); renderBindings(); renderPreview(); syncAdvancedJson();
    }));
    refs.buttons.querySelectorAll('[data-button-index]').forEach((card) => {
      const index = Number(card.dataset.buttonIndex);
      card.querySelectorAll('[data-button-field]').forEach((input) => input.addEventListener('input', () => {
        const field = input.dataset.buttonField;
        const button = state.buttons[index];
        if (field === 'type') button.type = input.value;
        if (field === 'text') button.text = input.value;
        if (field === 'value') setButtonValue(button, input.value);
        ensureBindingReferences();
        if (field === 'type') renderButtons();
        renderBindings(); renderPreview(); syncAdvancedJson();
      }));
    });
  }

  function buttonValueLabel(type) { return type === 'URL' ? 'URL' : type === 'PHONE_NUMBER' ? 'Telefone' : type === 'COPY_CODE' ? 'Código' : 'ID'; }
  function buttonValue(button) { return button.type === 'URL' ? button.url : button.type === 'PHONE_NUMBER' ? button.phone_number : button.type === 'COPY_CODE' ? button.example : button.id; }
  function setButtonValue(button, value) {
    if (button.type === 'URL') button.url = value;
    else if (button.type === 'PHONE_NUMBER') button.phone_number = value;
    else if (button.type === 'COPY_CODE') button.example = value;
    else button.id = value;
  }

  function ensureBindingReferences() {
    const quickIds = new Set(state.buttons.filter((b) => b.type === 'QUICK_REPLY').map((b) => b.id).filter(Boolean));
    state.bindings = state.bindings.filter((binding) => quickIds.has(binding.id));
  }

  function targetOptions(binding) {
    const source = binding.type === 'ACTION' ? state.actions.map((item) => item.actionKey) : binding.type === 'RECIPE' ? state.recipes.map((item) => item.recipeKey) : [];
    const values = [...new Set([binding.key, ...source].filter(Boolean))];
    return '<option value="">Selecione...</option>' + values.map((value) => `<option value="${escapeAttr(value)}" ${value === binding.key ? 'selected' : ''}>${escapeHtml(value)}</option>`).join('');
  }

  function renderBindings() {
    const quickButtons = state.buttons.filter((button) => button.type === 'QUICK_REPLY' && button.id);
    if (!quickButtons.length) { refs.bindings.innerHTML = '<div class="empty">Adicione um QUICK_REPLY para criar uma interação.</div>'; return; }
    refs.bindings.innerHTML = quickButtons.map((button) => {
      let binding = state.bindings.find((item) => item.id === button.id);
      if (!binding) binding = { id: button.id, matchTitle: button.text, type: 'NONE', key: '', confirmOnInteraction: true, input: {}, response: null, onError: null, keepSessionOpen: false };
      return `<div class="editor-card" data-binding-id="${escapeAttr(button.id)}">
        <div class="editor-card-header"><strong>${escapeHtml(button.text || button.id)}</strong><span class="helper">ID: ${escapeHtml(button.id)}</span></div>
        <div class="card-grid binding">
          <label><span>Destino</span><select data-binding-field="type"><option ${binding.type === 'NONE' ? 'selected' : ''}>NONE</option><option ${binding.type === 'ACTION' ? 'selected' : ''}>ACTION</option><option ${binding.type === 'RECIPE' ? 'selected' : ''}>RECIPE</option></select></label>
          <label><span>Action / Recipe</span><select data-binding-field="key">${targetOptions(binding)}</select></label>
          <label><span>Confirmação pelo clique</span><select data-binding-field="confirmOnInteraction"><option value="true" ${binding.confirmOnInteraction ? 'selected' : ''}>Sim</option><option value="false" ${!binding.confirmOnInteraction ? 'selected' : ''}>Não</option></select></label>
        </div>
        <div class="binding-json">
          <label><span>Input JSON</span><textarea rows="5" data-binding-field="input">${escapeHtml(JSON.stringify(binding.input || {}, null, 2))}</textarea></label>
          <label><span>Resposta após sucesso</span><textarea rows="5" data-binding-field="response" placeholder='{"type":"TEXT","text":"✅ Concluído"}'>${escapeHtml(binding.response ? JSON.stringify(binding.response, null, 2) : '')}</textarea></label>
        </div>
        <label class="toggle-line"><input type="checkbox" data-binding-field="keepSessionOpen" ${binding.keepSessionOpen ? 'checked' : ''} /> <span>Manter sessão de interação aberta</span></label>
      </div>`;
    }).join('');
    refs.bindings.querySelectorAll('[data-binding-id]').forEach((card) => {
      const id = card.dataset.bindingId;
      let binding = state.bindings.find((item) => item.id === id);
      if (!binding) { binding = { id, matchTitle: state.buttons.find((b) => b.id === id)?.text || '', type: 'NONE', key: '', confirmOnInteraction: true, input: {}, response: null, onError: null, keepSessionOpen: false }; state.bindings.push(binding); }
      card.querySelectorAll('[data-binding-field]').forEach((input) => {
        const eventName = input.type === 'checkbox' ? 'change' : 'input';
        input.addEventListener(eventName, () => {
          const field = input.dataset.bindingField;
          if (field === 'type') { binding.type = input.value; binding.key = ''; renderBindings(); }
          else if (field === 'key') binding.key = input.value;
          else if (field === 'confirmOnInteraction') binding.confirmOnInteraction = input.value === 'true';
          else if (field === 'keepSessionOpen') binding.keepSessionOpen = input.checked;
          else if (field === 'input') binding.input = safeJson(input.value, binding.input || {});
          else if (field === 'response') binding.response = input.value.trim() ? safeJson(input.value, binding.response || {}) : null;
          syncAdvancedJson();
        });
      });
    });
    state.bindings = state.bindings.filter((binding) => quickButtons.some((button) => button.id === binding.id));
    syncAdvancedJson();
  }

  function syncAdvancedJson() {
    state.actionsRaw = { ...(state.actionsRaw || {}), bindings: state.bindings.filter((b) => b.type !== 'NONE') };
    refs.actionsJson.value = JSON.stringify(state.actionsRaw, null, 2);
    refs.policyJson.value = JSON.stringify(state.policy || {}, null, 2);
  }

  function buildComponents() {
    const components = [];
    if (refs.header.value.trim()) components.push({ type: 'HEADER', format: 'TEXT', text: refs.header.value.trim() });
    components.push({ type: 'BODY', text: refs.body.value });
    if (refs.footer.value.trim()) components.push({ type: 'FOOTER', text: refs.footer.value.trim() });
    if (state.buttons.length) components.push({ type: 'BUTTONS', buttons: state.buttons.map((button) => {
      if (button.type === 'URL') return { type: 'URL', text: button.text, url: button.url };
      if (button.type === 'PHONE_NUMBER') return { type: 'PHONE_NUMBER', text: button.text, phone_number: button.phone_number };
      if (button.type === 'COPY_CODE') return { type: 'COPY_CODE', text: button.text, example: button.example };
      return { type: 'QUICK_REPLY', text: button.text, id: button.id };
    }) });
    return components;
  }

  function editorPayload() {
    state.policy = safeJson(refs.policyJson.value, state.policy || {});
    state.actionsRaw = safeJson(refs.actionsJson.value, state.actionsRaw || { bindings: [] });
    if (!Array.isArray(state.actionsRaw.bindings)) state.actionsRaw.bindings = state.bindings;
    return {
      name: refs.name.value.trim(), language: refs.language.value.trim() || 'pt_BR', category: refs.category.value,
      allowCategoryChange: false, components: buildComponents(), actions: state.actionsRaw, policy: state.policy,
      enabled: refs.enabled.checked,
    };
  }

  async function saveTemplate() {
    if (!state.instanceName) throw new Error('Selecione uma instância.');
    const payload = editorPayload();
    if (!payload.name) throw new Error('Nome é obrigatório.');
    if (!refs.body.value.trim()) throw new Error('Corpo da mensagem é obrigatório.');
    if (state.selected) {
      await api(`/template/edit/${encodeURIComponent(state.instanceName)}`, { method: 'POST', body: { ...payload, templateId: templateIdentifier(state.selected) } });
      toast('Template atualizado.');
    } else {
      await api(`/template/create/${encodeURIComponent(state.instanceName)}`, { method: 'POST', body: payload });
      toast('Template criado.');
    }
    const selectedName = payload.name;
    await loadWorkspace();
    const refreshed = state.templates.find((item) => item.name === selectedName && item.language === payload.language);
    if (refreshed) selectTemplate(refreshed);
  }

  function numericParameters(text, variables) {
    const indexes = [...new Set([...String(text || '').matchAll(/\{\{\s*(\d+)\s*\}\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
    return indexes.map((index) => ({ type: 'text', text: String(variables[String(index)] ?? variables[index] ?? '') }));
  }

  function requestComponents(variables) {
    const result = [];
    const bodyParams = numericParameters(refs.body.value, variables);
    if (bodyParams.length) result.push({ type: 'body', parameters: bodyParams });
    const headerParams = numericParameters(refs.header.value, variables);
    if (headerParams.length) result.push({ type: 'header', parameters: headerParams });
    return result;
  }

  async function sendTest() {
    if (!state.instanceName) throw new Error('Selecione uma instância.');
    if (!refs.name.value.trim()) throw new Error('Salve ou informe o nome do template.');
    const number = refs.testNumber.value.trim();
    if (!number) throw new Error('Informe o número para teste.');
    const variables = safeJson(refs.variables.value, null);
    if (variables === null) throw new Error('JSON de variáveis inválido.');
    refs.testStatus.textContent = 'Enviando...';
    const response = await api(`/message/sendTemplate/${encodeURIComponent(state.instanceName)}`, {
      method: 'POST', body: { number, name: refs.name.value.trim(), language: refs.language.value.trim() || 'pt_BR', variables, components: requestComponents(variables) },
    });
    refs.testStatus.textContent = `Enviado: ${response?.key?.id || response?.messages?.[0]?.id || 'OK'}`;
    toast('Template de teste enviado.');
  }

  function interpolate(text, variables) {
    return String(text || '')
      .replace(/\{\{\s*([A-Za-z_][A-Za-z0-9_.-]*)\s*\}\}/g, (_, key) => String(readPath(variables, key) ?? `{{${key}}}`))
      .replace(/\{\{\s*(\d+)\s*\}\}/g, (_, key) => String(variables[key] ?? `{{${key}}}`));
  }

  function readPath(obj, path) { return String(path).split('.').reduce((value, key) => value == null ? undefined : value[key], obj); }

  function renderPreview() {
    const variables = safeJson(refs.variables.value, {});
    const header = interpolate(refs.header.value, variables);
    const body = interpolate(refs.body.value, variables) || 'Digite o conteúdo do template...';
    const footer = interpolate(refs.footer.value, variables);
    refs.preview.innerHTML = `${header ? `<div class="preview-header">${escapeHtml(header)}</div>` : ''}<div class="preview-body">${escapeHtml(body)}</div>${footer ? `<div class="preview-footer">${escapeHtml(footer)}</div>` : ''}${state.buttons.map((button) => `<div class="preview-button">${escapeHtml(interpolate(button.text, variables))}</div>`).join('')}`;
    refs.editorTitle.textContent = refs.name.value.trim() || 'Template sem título';
  }

  function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]); }
  function escapeAttr(value) { return escapeHtml(value).replace(/`/g, '&#096;'); }

  function bindEvents() {
    $('connectButton').addEventListener('click', () => connect().catch((error) => toast(error.message, true)));
    $('refreshButton').addEventListener('click', () => loadWorkspace().then(() => toast('Catálogo atualizado.')).catch((error) => toast(error.message, true)));
    refs.instance.addEventListener('change', () => { state.instanceName = refs.instance.value; state.instanceId = refs.instance.selectedOptions[0]?.dataset?.id || ''; state.selected = null; loadWorkspace().catch((error) => toast(error.message, true)); });
    refs.search.addEventListener('input', renderTemplateList);
    $('newTemplateButton').addEventListener('click', newTemplate);
    $('duplicateButton').addEventListener('click', duplicateTemplate);
    $('addButtonButton').addEventListener('click', addButton);
    $('saveButton').addEventListener('click', () => saveTemplate().catch((error) => toast(error.message, true)));
    $('sendTestButton').addEventListener('click', () => sendTest().catch((error) => { refs.testStatus.textContent = ''; toast(error.message, true); }));
    document.querySelectorAll('.tab').forEach((tab) => tab.addEventListener('click', () => {
      document.querySelectorAll('.tab').forEach((item) => item.classList.toggle('active', item === tab));
      document.querySelectorAll('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === tab.dataset.tab));
    }));
    [refs.name, refs.language, refs.category, refs.header, refs.footer, refs.body, refs.variables].forEach((input) => input.addEventListener('input', renderPreview));
    refs.actionsJson.addEventListener('change', () => {
      const parsed = safeJson(refs.actionsJson.value, null);
      if (!parsed) return toast('Actions JSON inválido.', true);
      state.actionsRaw = parsed; state.bindings = Array.isArray(parsed.bindings) ? parsed.bindings.map(normalizeBinding) : [];
      renderBindings(); renderPreview();
    });
    refs.policyJson.addEventListener('change', () => {
      const parsed = safeJson(refs.policyJson.value, null);
      if (!parsed) return toast('Policy JSON inválido.', true);
      state.policy = parsed;
    });
  }

  refs.apiKey.value = storedApiKey();
  state.apiKey = refs.apiKey.value;
  bindEvents();
  newTemplate();
  if (state.apiKey) connect().catch(() => {
    refs.badge.textContent = 'Informe a chave e conecte'; refs.badge.className = 'badge muted';
  });
})();
