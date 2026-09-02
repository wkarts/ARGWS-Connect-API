(() => {
  'use strict';

  if (window.__ARGWS_TEMPLATE_STUDIO_V2__) return;
  window.__ARGWS_TEMPLATE_STUDIO_V2__ = true;

  const $ = (id) => document.getElementById(id);
  const examples = {
    hello_world: { '1': 'Wallace' },
    sample_utility: { '1': 'Wallace', '2': 'Solicitação #123' },
    sample_marketing: { '1': 'Wallace', '2': 'uma condição especial para você' },
    sample_authentication: { '1': '123456' },
  };

  const refs = {
    apiKey: $('apiKeyInput'), instance: $('instanceSelect'), templateList: $('templateList'),
    templateCount: $('templateCount'), actionCount: $('actionCount'), recipeCount: $('recipeCount'), catalogSummary: $('catalogSummary'),
    variables: $('variablesInput'), variableChips: $('variableChips'), body: $('bodyInput'), header: $('headerInput'), footer: $('footerInput'),
    diagnostic: $('testDiagnostic'), integrationResult: $('integrationResult'),
    actionList: $('actionRegistryList'), recipeList: $('recipeRegistryList'),
    actionKey: $('actionKeyInput'), actionName: $('actionNameInput'), actionMethod: $('actionMethodInput'),
    actionConfirmation: $('actionConfirmationInput'), actionTimeout: $('actionTimeoutInput'), actionBaseUrl: $('actionBaseUrlInput'),
    actionPath: $('actionPathInput'), actionCredential: $('actionCredentialInput'), actionPrivate: $('actionPrivateInput'),
    actionRequest: $('actionRequestInput'), actionOutput: $('actionOutputInput'), actionSchema: $('actionSchemaInput'),
    recipeKey: $('recipeKeyInput'), recipeName: $('recipeNameInput'), recipeConfirmation: $('recipeConfirmationInput'),
    recipeSteps: $('recipeStepsInput'), recipeSchema: $('recipeSchemaInput'), recipeOutput: $('recipeOutputInput'),
    integrationInput: $('integrationTestInput'),
  };

  let registry = { templates: [], actions: [], recipes: [], selectedAction: '', selectedRecipe: '' };

  const toast = (message, error = false) => {
    const node = $('toast');
    if (!node) return;
    node.textContent = error ? humanError(message) : message;
    node.classList.toggle('error', error);
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 3400);
  };

  function parseJson(value, label, fallback = {}) {
    try {
      const parsed = JSON.parse(String(value || '').trim() || JSON.stringify(fallback));
      return parsed;
    } catch {
      throw new Error(`${label}: JSON inválido.`);
    }
  }

  function normalizeArray(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.records)) return data.records;
    if (Array.isArray(data?.templates)) return data.templates;
    return [];
  }

  function currentInstance() {
    return String(refs.instance?.value || '').trim();
  }

  function currentApiKey() {
    return String(refs.apiKey?.value || '').trim();
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    const key = currentApiKey();
    if (key) headers.apikey = key;
    let body = options.body;
    if (body !== undefined && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const response = await nativeFetch(path, { ...options, headers, body });
    const text = await response.text();
    let data;
    try { data = text ? JSON.parse(text) : null; } catch { data = text; }
    if (!response.ok) {
      const detail = data?.response?.message || data?.message || data?.error?.message || text || `HTTP ${response.status}`;
      throw new Error(Array.isArray(detail) ? detail.join('; ') : String(detail));
    }
    return data;
  }

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
  }

  function pretty(value) {
    if (typeof value === 'string') return value;
    try { return JSON.stringify(value, null, 2); } catch { return String(value); }
  }

  function humanError(value) {
    const raw = String(value?.message || value || 'Erro desconhecido').replace(/\s+/g, ' ').trim();
    const prisma = raw.match(/Unknown argument [`'"]?([^`'"\s]+)|PrismaClientValidationError[:\s]+([^\n]+)/i);
    const concise = prisma ? `Persistência incompatível: ${prisma[1] || prisma[2] || 'erro Prisma'}` : raw;
    return concise.length > 260 ? `${concise.slice(0, 257)}...` : concise;
  }

  async function refreshRegistry() {
    const instance = currentInstance();
    if (!instance || !currentApiKey()) return;
    try {
      const [templates, actions, recipes] = await Promise.all([
        api(`/template/find/${encodeURIComponent(instance)}`),
        api(`/action/find/${encodeURIComponent(instance)}`).catch(() => []),
        api(`/recipe/find/${encodeURIComponent(instance)}`).catch(() => []),
      ]);
      registry.templates = normalizeArray(templates);
      registry.actions = normalizeArray(actions);
      registry.recipes = normalizeArray(recipes);
      renderRegistry();
    } catch (error) {
      toast(error.message, true);
    }
  }

  function renderRegistry() {
    if (refs.templateCount) refs.templateCount.textContent = String(registry.templates.length);
    if (refs.actionCount) refs.actionCount.textContent = String(registry.actions.length);
    if (refs.recipeCount) refs.recipeCount.textContent = String(registry.recipes.length);
    if (refs.catalogSummary) refs.catalogSummary.textContent = currentInstance() ? `Instância: ${currentInstance()}` : 'Selecione uma instância';

    if (refs.actionList) {
      refs.actionList.innerHTML = registry.actions.length
        ? registry.actions.map((item) => `<button class="registry-item${registry.selectedAction === item.actionKey ? ' active' : ''}" data-action-key="${escapeHtml(item.actionKey)}" type="button"><strong>${escapeHtml(item.actionKey)}</strong><span>${escapeHtml(item.method)} · ${escapeHtml(item.confirmation || 'NONE')}</span></button>`).join('')
        : '<div class="empty">Nenhuma Action cadastrada. Crie uma operação REST abaixo.</div>';
      refs.actionList.querySelectorAll('[data-action-key]').forEach((node) => node.addEventListener('click', () => selectAction(node.dataset.actionKey)));
    }

    if (refs.recipeList) {
      refs.recipeList.innerHTML = registry.recipes.length
        ? registry.recipes.map((item) => `<button class="registry-item${registry.selectedRecipe === item.recipeKey ? ' active' : ''}" data-recipe-key="${escapeHtml(item.recipeKey)}" type="button"><strong>${escapeHtml(item.recipeKey)}</strong><span>${(item.steps || []).length} step(s) · ${escapeHtml(item.confirmation || 'NONE')}</span></button>`).join('')
        : '<div class="empty">Nenhuma Recipe cadastrada. Combine Actions em um fluxo reutilizável.</div>';
      refs.recipeList.querySelectorAll('[data-recipe-key]').forEach((node) => node.addEventListener('click', () => selectRecipe(node.dataset.recipeKey)));
    }
  }

  function resetAction() {
    registry.selectedAction = '';
    refs.actionKey.value = '';
    refs.actionName.value = '';
    refs.actionMethod.value = 'POST';
    refs.actionConfirmation.value = 'NONE';
    refs.actionTimeout.value = '10000';
    refs.actionBaseUrl.value = '';
    refs.actionPath.value = '';
    refs.actionCredential.value = '';
    refs.actionPrivate.checked = false;
    refs.actionRequest.value = '{}';
    refs.actionOutput.value = '{}';
    refs.actionSchema.value = '{}';
    renderRegistry();
  }

  function selectAction(key) {
    const item = registry.actions.find((entry) => entry.actionKey === key);
    if (!item) return;
    registry.selectedAction = key;
    refs.actionKey.value = item.actionKey || '';
    refs.actionName.value = item.name || '';
    refs.actionMethod.value = item.method || 'POST';
    refs.actionConfirmation.value = item.confirmation || 'NONE';
    refs.actionTimeout.value = String(item.timeoutMs || 10000);
    refs.actionBaseUrl.value = item.baseUrl || '';
    refs.actionPath.value = item.path || '';
    refs.actionCredential.value = item.credentialRef || '';
    refs.actionPrivate.checked = item.allowPrivateNetwork === true;
    refs.actionRequest.value = pretty(item.requestTemplate || {});
    refs.actionOutput.value = pretty(item.outputMapping || {});
    refs.actionSchema.value = pretty(item.inputSchema || {});
    renderRegistry();
  }

  function actionPayload() {
    const payload = {
      actionKey: refs.actionKey.value.trim(),
      name: refs.actionName.value.trim(),
      method: refs.actionMethod.value,
      baseUrl: refs.actionBaseUrl.value.trim(),
      path: refs.actionPath.value.trim(),
      timeoutMs: Number(refs.actionTimeout.value || 10000),
      confirmation: refs.actionConfirmation.value,
      allowPrivateNetwork: refs.actionPrivate.checked,
      enabled: true,
      requestTemplate: parseJson(refs.actionRequest.value, 'Request template'),
      outputMapping: parseJson(refs.actionOutput.value, 'Output mapping'),
      inputSchema: parseJson(refs.actionSchema.value, 'Input schema'),
    };
    const credentialRef = refs.actionCredential.value.trim();
    if (credentialRef) payload.credentialRef = credentialRef;
    if (!payload.actionKey || !payload.name || !payload.baseUrl) throw new Error('Action key, nome e Base URL são obrigatórios.');
    return payload;
  }

  async function saveAction() {
    const instance = currentInstance();
    if (!instance) throw new Error('Selecione uma instância.');
    const payload = actionPayload();
    await api(`/action/create/${encodeURIComponent(instance)}`, { method: 'POST', body: payload });
    registry.selectedAction = payload.actionKey;
    await refreshRegistry();
    $('refreshButton')?.click();
    toast('Action salva no Integration Registry.');
  }

  async function deleteAction() {
    const instance = currentInstance();
    const actionKey = refs.actionKey.value.trim();
    if (!instance || !actionKey) throw new Error('Selecione uma Action.');
    await api(`/action/delete/${encodeURIComponent(instance)}`, { method: 'DELETE', body: { actionKey } });
    resetAction();
    await refreshRegistry();
    $('refreshButton')?.click();
    toast('Action removida.');
  }

  async function dryRunAction() {
    const instance = currentInstance();
    const actionKey = refs.actionKey.value.trim();
    if (!instance || !actionKey) throw new Error('Selecione ou salve uma Action.');
    const input = parseJson(refs.integrationInput.value, 'Input do sandbox');
    refs.integrationResult.textContent = 'Executando dry-run...';
    const result = await api(`/action/execute/${encodeURIComponent(instance)}`, { method: 'POST', body: { actionKey, input, dryRun: true, confirmed: false } });
    refs.integrationResult.textContent = pretty(result);
  }

  function resetRecipe() {
    registry.selectedRecipe = '';
    refs.recipeKey.value = '';
    refs.recipeName.value = '';
    refs.recipeConfirmation.value = 'NONE';
    refs.recipeSteps.value = '[]';
    refs.recipeSchema.value = '{}';
    refs.recipeOutput.value = '{}';
    renderRegistry();
  }

  function selectRecipe(key) {
    const item = registry.recipes.find((entry) => entry.recipeKey === key);
    if (!item) return;
    registry.selectedRecipe = key;
    refs.recipeKey.value = item.recipeKey || '';
    refs.recipeName.value = item.name || '';
    refs.recipeConfirmation.value = item.confirmation || 'NONE';
    refs.recipeSteps.value = pretty(item.steps || []);
    refs.recipeSchema.value = pretty(item.inputSchema || {});
    refs.recipeOutput.value = pretty(item.outputTemplate || {});
    renderRegistry();
  }

  function recipePayload() {
    const steps = parseJson(refs.recipeSteps.value, 'Steps', []);
    if (!Array.isArray(steps) || !steps.length) throw new Error('A Recipe precisa de pelo menos um step.');
    const payload = {
      recipeKey: refs.recipeKey.value.trim(),
      name: refs.recipeName.value.trim(),
      steps,
      inputSchema: parseJson(refs.recipeSchema.value, 'Input schema'),
      outputTemplate: parseJson(refs.recipeOutput.value, 'Output template'),
      confirmation: refs.recipeConfirmation.value,
      enabled: true,
    };
    if (!payload.recipeKey || !payload.name) throw new Error('Recipe key e nome são obrigatórios.');
    return payload;
  }

  async function saveRecipe() {
    const instance = currentInstance();
    if (!instance) throw new Error('Selecione uma instância.');
    const payload = recipePayload();
    await api(`/recipe/create/${encodeURIComponent(instance)}`, { method: 'POST', body: payload });
    registry.selectedRecipe = payload.recipeKey;
    await refreshRegistry();
    $('refreshButton')?.click();
    toast('Recipe salva.');
  }

  async function deleteRecipe() {
    const instance = currentInstance();
    const recipeKey = refs.recipeKey.value.trim();
    if (!instance || !recipeKey) throw new Error('Selecione uma Recipe.');
    await api(`/recipe/delete/${encodeURIComponent(instance)}`, { method: 'DELETE', body: { recipeKey } });
    resetRecipe();
    await refreshRegistry();
    $('refreshButton')?.click();
    toast('Recipe removida.');
  }

  async function dryRunRecipe() {
    const instance = currentInstance();
    const recipeKey = refs.recipeKey.value.trim();
    if (!instance || !recipeKey) throw new Error('Selecione ou salve uma Recipe.');
    const input = parseJson(refs.integrationInput.value, 'Input do sandbox');
    refs.integrationResult.textContent = 'Executando dry-run...';
    const result = await api(`/recipe/execute/${encodeURIComponent(instance)}`, { method: 'POST', body: { recipeKey, input, dryRun: true, confirmed: false } });
    refs.integrationResult.textContent = pretty(result);
  }

  function placeholders() {
    const text = [refs.header?.value, refs.body?.value, refs.footer?.value].join('\n');
    const result = [];
    for (const match of text.matchAll(/\{\{\s*([^{}]+?)\s*\}\}/g)) {
      const key = match[1].trim();
      if (key && !result.includes(key)) result.push(key);
    }
    return result;
  }

  function renderVariables() {
    const values = placeholders();
    if (!refs.variableChips) return;
    refs.variableChips.innerHTML = values.length
      ? values.map((key) => `<span class="variable-chip">{{${escapeHtml(key)}}}</span>`).join('')
      : '<span class="helper">Nenhuma variável detectada.</span>';
  }

  function applyExample(name) {
    const value = examples[name];
    if (!value || !refs.variables) return;
    refs.variables.value = JSON.stringify(value, null, 2);
    refs.variables.dispatchEvent(new Event('input', { bubbles: true }));
    renderVariables();
  }

  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    const response = await nativeFetch(...args);
    const target = typeof args[0] === 'string' ? args[0] : String(args[0]?.url || '');
    if (target.includes('/message/sendTemplate/')) {
      const clone = response.clone();
      clone.text().then((text) => {
        let data = text;
        try { data = text ? JSON.parse(text) : null; } catch { /* keep text */ }
        if (refs.diagnostic) {
          const messageId = data?.key?.id || data?.messages?.[0]?.id || null;
          refs.diagnostic.textContent = pretty({
            httpStatus: response.status,
            ok: response.ok,
            transportStatus: response.ok ? 'ACCEPTED_BY_PROVIDER' : 'REJECTED',
            deliveryStatus: response.ok ? 'PENDING_OR_UNKNOWN' : 'NOT_SENT',
            messageId,
            templateExecution: data?.templateExecution || null,
            note: response.ok
              ? 'O provider aceitou o envio. A confirmação de entrega é assíncrona e não é equivalente ao HTTP 201.'
              : 'O request falhou antes de uma confirmação de transporte confiável.',
            response: data,
          });
        }
      }).catch(() => undefined);
    }
    return response;
  };

  function bind(id, event, handler) {
    const node = $(id);
    if (!node) return;
    node.addEventListener(event, () => Promise.resolve(handler()).catch((error) => {
      if (refs.integrationResult && ['dryRunActionButton','dryRunRecipeButton'].includes(id)) refs.integrationResult.textContent = `ERRO\n${error.message}`;
      toast(error.message, true);
    }));
  }

  bind('reloadIntegrationsButton', 'click', refreshRegistry);
  bind('newActionButton', 'click', resetAction);
  bind('saveActionButton', 'click', saveAction);
  bind('deleteActionButton', 'click', deleteAction);
  bind('dryRunActionButton', 'click', dryRunAction);
  bind('newRecipeButton', 'click', resetRecipe);
  bind('saveRecipeButton', 'click', saveRecipe);
  bind('deleteRecipeButton', 'click', deleteRecipe);
  bind('dryRunRecipeButton', 'click', dryRunRecipe);

  $('clearDiagnosticButton')?.addEventListener('click', () => { refs.diagnostic.textContent = 'Aguardando envio de teste.'; });
  document.querySelectorAll('[data-example-template]').forEach((node) => node.addEventListener('click', () => applyExample(node.dataset.exampleTemplate)));

  [refs.body, refs.header, refs.footer].filter(Boolean).forEach((node) => node.addEventListener('input', renderVariables));
  refs.templateList?.addEventListener('click', () => setTimeout(() => {
    renderVariables();
    const name = $('nameInput')?.value?.trim();
    if (examples[name] && (!refs.variables.value.trim() || refs.variables.value.trim() === '{}')) applyExample(name);
  }, 50));

  $('connectButton')?.addEventListener('click', () => setTimeout(refreshRegistry, 700));
  $('refreshButton')?.addEventListener('click', () => setTimeout(refreshRegistry, 300));
  refs.instance?.addEventListener('change', () => setTimeout(refreshRegistry, 300));

  const observer = new MutationObserver(() => {
    if (refs.templateList?.querySelector('.template-item')) {
      registry.templates = Array.from(refs.templateList.querySelectorAll('.template-item')).map((node) => ({ name: node.querySelector('strong')?.textContent || '' }));
      if (refs.templateCount) refs.templateCount.textContent = String(registry.templates.length);
    }
  });
  if (refs.templateList) observer.observe(refs.templateList, { childList: true, subtree: true });

  renderVariables();
  resetAction();
  resetRecipe();
})();
