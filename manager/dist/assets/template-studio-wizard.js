(() => {
  'use strict';
  if (window.__ARGWS_TEMPLATE_STUDIO_WIZARD__) return;
  window.__ARGWS_TEMPLATE_STUDIO_WIZARD__ = true;

  const $ = (id) => document.getElementById(id);
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
  const pretty = (value) => {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value ?? '');
    }
  };
  const parseJson = (value, fallback = null) => {
    try {
      return JSON.parse(String(value || '').trim() || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  };
  const slug = (value, fallback = 'item') =>
    String(value || fallback)
      .trim()
      .toLowerCase()
      .normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^a-z0-9._:-]+/g, '_')
      .replace(/^_+|_+$/g, '') || fallback;

  const steps = [
    { key: 'template', title: 'Mensagem', caption: 'Identidade e conteúdo' },
    { key: 'interactions', title: 'Interações', caption: 'Botões, listas e localização' },
    { key: 'apis', title: 'Dados & APIs', caption: 'Actions REST' },
    { key: 'flow', title: 'Fluxo', caption: 'Recipe e encadeamento' },
    { key: 'microapp', title: 'Micro App', caption: 'Páginas, GPS e geofence' },
    { key: 'review', title: 'Revisar', caption: 'Criar solução' },
  ];

  let bypassBlank = false;
  let wizard = freshState();

  function freshState() {
    return {
      step: 0,
      existingActions: [],
      existingRecipes: [],
      template: {
        name: '',
        language: 'pt_BR',
        category: 'UTILITY',
        header: '',
        body: 'Olá {{customer.name}}, como podemos ajudar?',
        footer: '',
      },
      interactions: [],
      actions: [],
      recipe: { enabled: false, recipeKey: '', name: '', confirmation: 'NONE', steps: [] },
      microApp: {
        enabled: false,
        key: '',
        title: '',
        ttlSeconds: 900,
        pages: [{ key: 'start', title: 'Início', fields: [{ type: 'INPUT', id: 'name', label: 'Nome' }] }],
        locationMode: 'DISABLED',
        capturePath: 'location',
        accuracy: 100,
        geofence: { name: 'Área permitida', latitude: '', longitude: '', radiusMeters: 150 },
        submitType: 'NONE',
        submitKey: '',
      },
    };
  }

  function toast(message, error = false) {
    const node = $('toast');
    if (!node) return;
    node.textContent = String(message || '');
    node.classList.toggle('error', error);
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 3800);
  }

  function apiKey() {
    return String($('apiKeyInput')?.value || '').trim();
  }

  function instanceName() {
    return String($('instanceSelect')?.value || '').trim();
  }

  async function api(path, options = {}) {
    const headers = { ...(options.headers || {}) };
    if (apiKey()) headers.apikey = apiKey();
    let body = options.body;
    if (body !== undefined && typeof body !== 'string') {
      headers['Content-Type'] = 'application/json';
      body = JSON.stringify(body);
    }
    const response = await fetch(path, { ...options, headers, body });
    const text = await response.text();
    let data;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!response.ok) {
      const detail = data?.response?.message || data?.message || data?.error?.message || text || `HTTP ${response.status}`;
      throw new Error(Array.isArray(detail) ? detail.join('; ') : String(detail));
    }
    return data;
  }

  function setupEntryPoints() {
    const toolbarActions = q('.toolbar-actions');
    if (toolbarActions && !$('wizardLaunchButton')) {
      const button = document.createElement('button');
      button.id = 'wizardLaunchButton';
      button.className = 'button secondary';
      button.type = 'button';
      button.textContent = 'Criar com Wizard';
      toolbarActions.prepend(button);
      button.addEventListener('click', openWizard);
    }

    const add = $('newTemplateButton');
    if (add) {
      add.title = 'Criar template ou solução';
      add.addEventListener(
        'click',
        (event) => {
          if (bypassBlank) {
            bypassBlank = false;
            return;
          }
          event.preventDefault();
          event.stopImmediatePropagation();
          openWizard();
        },
        true,
      );
    }

    const toolbar = q('.toolbar-actions');
    if (toolbar && !$('deleteTemplateButton')) {
      const deleteButton = document.createElement('button');
      deleteButton.id = 'deleteTemplateButton';
      deleteButton.className = 'button secondary';
      deleteButton.type = 'button';
      deleteButton.textContent = 'Excluir';
      deleteButton.hidden = true;
      toolbar.insertBefore(deleteButton, $('saveButton') || null);
      deleteButton.addEventListener('click', deleteSelectedTemplate);
      refreshDeleteVisibility();
      ['editorMode', 'editorTitle', 'originBadge', 'templateList'].forEach((id) => {
        const node = $(id);
        if (node) new MutationObserver(refreshDeleteVisibility).observe(node, { childList: true, subtree: true, attributes: true });
      });
      $('templateList')?.addEventListener('click', () => setTimeout(refreshDeleteVisibility, 40));
      $('newTemplateButton')?.addEventListener('click', () => setTimeout(refreshDeleteVisibility, 40));
    }
  }

  function refreshDeleteVisibility() {
    const button = $('deleteTemplateButton');
    if (!button) return;
    const mode = String($('editorMode')?.textContent || '').toLowerCase();
    const origin = String($('originBadge')?.textContent || '').toUpperCase();
    const active = q('.template-item.active');
    const isSystem = origin === 'SYSTEM' || mode.includes('padrão');
    button.hidden = !active || isSystem;
    button.disabled = isSystem;
    button.title = isSystem ? 'Templates de sistema não podem ser excluídos.' : 'Excluir o template selecionado';
  }

  async function deleteSelectedTemplate() {
    const active = q('.template-item.active');
    const name = String($('nameInput')?.value || '').trim();
    const id = String(active?.dataset?.templateId || '').trim();
    if (!active || !name || !instanceName()) return;
    const origin = String($('originBadge')?.textContent || '').toUpperCase();
    const mode = String($('editorMode')?.textContent || '').toLowerCase();
    if (origin === 'SYSTEM' || mode.includes('padrão')) return toast('Templates de sistema não podem ser excluídos.', true);

    const confirmed = await modalConfirm(
      'Excluir template?',
      `O template “${name}” será removido desta instância${origin === 'META' ? ' e a exclusão será enviada ao provedor Meta' : ''}. Esta ação não pode ser desfeita.`,
      'Excluir definitivamente',
      true,
    );
    if (!confirmed) return;

    await api(`/template/delete/${encodeURIComponent(instanceName())}`, {
      method: 'DELETE',
      body: { name, hsmId: id || undefined },
    });
    toast('Template excluído.');
    bypassBlank = true;
    $('newTemplateButton')?.click();
    $('refreshButton')?.click();
    setTimeout(refreshDeleteVisibility, 120);
  }

  async function openWizard() {
    if (!apiKey() || !instanceName()) {
      toast('Conecte uma instância antes de iniciar o Wizard.', true);
      return;
    }
    wizard = freshState();
    wizard.template.name = `template_${Date.now().toString().slice(-6)}`;
    try {
      const [actions, recipes] = await Promise.all([
        api(`/action/find/${encodeURIComponent(instanceName())}`).catch(() => []),
        api(`/recipe/find/${encodeURIComponent(instanceName())}`).catch(() => []),
      ]);
      wizard.existingActions = normalizeList(actions);
      wizard.existingRecipes = normalizeList(recipes);
    } catch {
      // Wizard continua operável mesmo se a biblioteca estiver vazia.
    }
    renderWizardShell();
  }

  function normalizeList(data) {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.data)) return data.data;
    if (Array.isArray(data?.records)) return data.records;
    return [];
  }

  function renderWizardShell() {
    $('studioWizardBackdrop')?.remove();
    const backdrop = document.createElement('div');
    backdrop.id = 'studioWizardBackdrop';
    backdrop.className = 'studio-wizard-backdrop';
    backdrop.innerHTML = `
      <section class="studio-wizard" role="dialog" aria-modal="true" aria-labelledby="wizardTitle">
        <aside class="wizard-sidebar">
          <div class="wizard-brand"><span class="eyebrow">Connect|API</span><h2>Wizard de solução</h2><p>Crie mensagem, interações, integrações e fluxo em uma única sequência.</p></div>
          <nav id="wizardSteps" class="wizard-steps"></nav>
          <div class="wizard-sidebar-footer">Nada é enviado para o WhatsApp durante o Wizard. A criação acontece somente na etapa final.</div>
        </aside>
        <main class="wizard-main">
          <header class="wizard-header"><div><span id="wizardEyebrow" class="eyebrow"></span><h3 id="wizardTitle"></h3><p id="wizardDescription"></p></div><button id="wizardClose" class="wizard-close" type="button" aria-label="Fechar">×</button></header>
          <div id="wizardBody" class="wizard-body"></div>
          <footer class="wizard-footer">
            <div class="wizard-footer-left"><button id="wizardBlank" class="button secondary" type="button">Começar em branco</button><span id="wizardProgress" class="wizard-progress"></span></div>
            <div class="wizard-footer-right"><button id="wizardBack" class="button secondary" type="button">Voltar</button><button id="wizardNext" class="button primary" type="button">Continuar</button></div>
          </footer>
        </main>
      </section>`;
    document.body.appendChild(backdrop);
    $('wizardClose').addEventListener('click', closeWizard);
    $('wizardBlank').addEventListener('click', openBlankEditor);
    $('wizardBack').addEventListener('click', previousStep);
    $('wizardNext').addEventListener('click', nextStep);
    backdrop.addEventListener('click', (event) => {
      if (event.target === backdrop) closeWizard();
    });
    renderWizard();
  }

  function closeWizard() {
    $('studioWizardBackdrop')?.remove();
  }

  function openBlankEditor() {
    closeWizard();
    bypassBlank = true;
    $('newTemplateButton')?.click();
  }

  function renderWizard() {
    const current = steps[wizard.step];
    $('wizardEyebrow').textContent = `Etapa ${wizard.step + 1} de ${steps.length}`;
    $('wizardTitle').textContent = current.title;
    $('wizardDescription').textContent = current.caption;
    $('wizardProgress').textContent = `${wizard.step + 1}/${steps.length}`;
    $('wizardBack').disabled = wizard.step === 0;
    $('wizardNext').textContent = wizard.step === steps.length - 1 ? 'Criar solução' : 'Continuar';
    $('wizardSteps').innerHTML = steps
      .map(
        (step, index) => `<button class="wizard-step ${index === wizard.step ? 'active' : ''} ${index < wizard.step ? 'done' : ''}" data-wizard-step="${index}" type="button"><span class="n">${index < wizard.step ? '✓' : index + 1}</span><span><strong>${esc(step.title)}</strong><small>${esc(step.caption)}</small></span></button>`,
      )
      .join('');
    qa('[data-wizard-step]', $('wizardSteps')).forEach((button) =>
      button.addEventListener('click', () => {
        collectCurrentStep();
        const target = Number(button.dataset.wizardStep);
        if (target <= wizard.step) {
          wizard.step = target;
          renderWizard();
        }
      }),
    );

    const renderers = [renderTemplateStep, renderInteractionsStep, renderApisStep, renderFlowStep, renderMicroAppStep, renderReviewStep];
    $('wizardBody').innerHTML = '<section class="wizard-panel active"></section>';
    renderers[wizard.step](q('.wizard-panel', $('wizardBody')));
  }

  function previousStep() {
    collectCurrentStep();
    wizard.step = Math.max(0, wizard.step - 1);
    renderWizard();
  }

  async function nextStep() {
    try {
      collectCurrentStep();
      validateStep(wizard.step);
      if (wizard.step === steps.length - 1) return await createSolution();
      wizard.step += 1;
      renderWizard();
    } catch (error) {
      toast(error.message, true);
    }
  }

  function renderTemplateStep(root) {
    const t = wizard.template;
    root.innerHTML = `
      <div class="wizard-card">
        <div class="wizard-card-head"><div><h4>Identidade</h4><p>Defina como este template será identificado.</p></div><span class="wizard-badge">Template</span></div>
        <div class="wizard-grid three">
          <label><span>Nome canônico</span><input id="wTemplateName" value="${esc(t.name)}" placeholder="confirmar_agendamento" /></label>
          <label><span>Idioma</span><input id="wTemplateLanguage" value="${esc(t.language)}" /></label>
          <label><span>Categoria</span><select id="wTemplateCategory"><option ${t.category === 'UTILITY' ? 'selected' : ''}>UTILITY</option><option ${t.category === 'MARKETING' ? 'selected' : ''}>MARKETING</option><option ${t.category === 'AUTHENTICATION' ? 'selected' : ''}>AUTHENTICATION</option></select></label>
        </div>
      </div>
      <div class="wizard-card">
        <div class="wizard-card-head"><div><h4>Mensagem</h4><p>Escreva o conteúdo principal. Variáveis podem usar {{customer.name}} ou {{1}}.</p></div></div>
        <div class="wizard-grid two"><label><span>Header</span><input id="wTemplateHeader" value="${esc(t.header)}" placeholder="Opcional" /></label><label><span>Footer</span><input id="wTemplateFooter" value="${esc(t.footer)}" placeholder="Opcional" /></label></div>
        <label><span>Corpo da mensagem</span><textarea id="wTemplateBody" rows="8">${esc(t.body)}</textarea></label>
      </div>`;
  }

  function renderInteractionsStep(root) {
    root.innerHTML = `
      <div class="wizard-card">
        <div class="wizard-card-head"><div><h4>Interações</h4><p>Adicione tudo que o usuário poderá tocar, escolher ou enviar.</p></div><button id="wAddInteraction" class="wizard-add" type="button">+ Interação</button></div>
        <div id="wInteractionList" class="wizard-list"></div>
      </div>
      <div class="wizard-help">Botões de ação ficam no template. LIST/CHOICE entram no Interaction Model v2. Localização do WhatsApp é tratada como resposta da sessão e pode executar Action/Recipe com geofence.</div>`;
    $('wAddInteraction').addEventListener('click', () => {
      wizard.interactions.push({ type: 'QUICK_REPLY', id: `option_${wizard.interactions.length + 1}`, title: 'Nova opção', value: '', targetType: 'NONE', targetKey: '', capturePath: '', sectionTitle: 'Opções', options: [] });
      renderInteractionsStep(root);
    });
    const list = $('wInteractionList');
    list.innerHTML = wizard.interactions.length ? wizard.interactions.map(interactionCard).join('') : '<div class="empty">Nenhuma interação adicionada. O template pode ser apenas informativo.</div>';
    bindInteractionCards(root);
  }

  function interactionCard(item, index) {
    const targetOptions = operationOptions(item.targetKey);
    const needsOptions = ['LIST', 'CHOICE'].includes(item.type);
    const valueLabel = item.type === 'URL' ? 'URL' : item.type === 'PHONE_NUMBER' ? 'Telefone' : item.type === 'COPY_CODE' ? 'Código' : 'ID';
    return `<article class="wizard-item" data-w-interaction="${index}">
      <div class="wizard-item-head"><strong>Interação ${index + 1}</strong><button data-w-remove-interaction="${index}" class="wizard-remove" type="button">Remover</button></div>
      <div class="wizard-grid three">
        <label><span>Tipo</span><select data-w-int="type"><option ${item.type === 'QUICK_REPLY' ? 'selected' : ''}>QUICK_REPLY</option><option ${item.type === 'URL' ? 'selected' : ''}>URL</option><option ${item.type === 'PHONE_NUMBER' ? 'selected' : ''}>PHONE_NUMBER</option><option ${item.type === 'COPY_CODE' ? 'selected' : ''}>COPY_CODE</option><option ${item.type === 'LIST' ? 'selected' : ''}>LIST</option><option ${item.type === 'CHOICE' ? 'selected' : ''}>CHOICE</option><option ${item.type === 'WHATSAPP_LOCATION' ? 'selected' : ''}>WHATSAPP_LOCATION</option></select></label>
        <label><span>${item.type === 'WHATSAPP_LOCATION' ? 'Identificador' : 'Texto / título'}</span><input data-w-int="title" value="${esc(item.title || '')}" /></label>
        <label><span>${valueLabel}</span><input data-w-int="value" value="${esc(item.value || item.id || '')}" ${needsOptions || item.type === 'WHATSAPP_LOCATION' ? 'disabled' : ''}/></label>
      </div>
      ${needsOptions ? `<div class="wizard-divider"></div><div class="wizard-card-head"><div><h4>Opções</h4><p>Cada opção mantém ID estável separado do texto exibido.</p></div><button data-w-add-option="${index}" class="wizard-add" type="button">+ Opção</button></div><div class="wizard-list">${(item.options || []).map((option, optionIndex) => optionRow(index, option, optionIndex)).join('') || '<div class="empty">Adicione ao menos uma opção.</div>'}</div>` : ''}
      ${['QUICK_REPLY', 'LIST', 'CHOICE', 'WHATSAPP_LOCATION'].includes(item.type) ? `<div class="wizard-divider"></div><div class="wizard-grid three"><label><span>Ao responder</span><select data-w-int="targetType"><option ${item.targetType === 'NONE' ? 'selected' : ''}>NONE</option><option ${item.targetType === 'ACTION' ? 'selected' : ''}>ACTION</option><option ${item.targetType === 'RECIPE' ? 'selected' : ''}>RECIPE</option></select></label><label><span>Action / Recipe</span><input data-w-int="targetKey" list="wOperationKeys" value="${esc(item.targetKey || '')}" placeholder="ex.: erp.customer.find" /></label><label><span>Capturar em</span><input data-w-int="capturePath" value="${esc(item.capturePath || '')}" placeholder="customer.selection" /></label></div><datalist id="wOperationKeys">${targetOptions}</datalist>` : ''}
    </article>`;
  }

  function optionRow(interactionIndex, option, optionIndex) {
    return `<div class="wizard-grid three" data-w-option="${optionIndex}"><label><span>ID</span><input data-w-opt="id" value="${esc(option.id || '')}" /></label><label><span>Título</span><input data-w-opt="title" value="${esc(option.title || '')}" /></label><label><span>Descrição</span><div class="wizard-inline"><input data-w-opt="description" value="${esc(option.description || '')}" /><button data-w-remove-option="${interactionIndex}:${optionIndex}" class="wizard-remove" type="button">×</button></div></label></div>`;
  }

  function bindInteractionCards(root) {
    qa('[data-w-interaction]', root).forEach((card) => {
      const index = Number(card.dataset.wInteraction);
      qa('[data-w-int]', card).forEach((input) => input.addEventListener('input', () => {
        const item = wizard.interactions[index];
        const field = input.dataset.wInt;
        item[field] = input.value;
        if (field === 'type') {
          if (['LIST', 'CHOICE'].includes(input.value) && !item.options.length) item.options = [{ id: 'option_1', title: 'Opção 1', description: '' }];
          if (input.value === 'WHATSAPP_LOCATION') {
            item.id = 'location';
            item.title = 'Localização do WhatsApp';
          }
          renderInteractionsStep(root);
        }
      }));
      qa('[data-w-option]', card).forEach((row) => {
        const optionIndex = Number(row.dataset.wOption);
        qa('[data-w-opt]', row).forEach((input) => input.addEventListener('input', () => {
          wizard.interactions[index].options[optionIndex][input.dataset.wOpt] = input.value;
        }));
      });
    });
    qa('[data-w-remove-interaction]', root).forEach((button) => button.addEventListener('click', () => {
      wizard.interactions.splice(Number(button.dataset.wRemoveInteraction), 1);
      renderInteractionsStep(root);
    }));
    qa('[data-w-add-option]', root).forEach((button) => button.addEventListener('click', () => {
      const index = Number(button.dataset.wAddOption);
      const options = wizard.interactions[index].options;
      options.push({ id: `option_${options.length + 1}`, title: `Opção ${options.length + 1}`, description: '' });
      renderInteractionsStep(root);
    }));
    qa('[data-w-remove-option]', root).forEach((button) => button.addEventListener('click', () => {
      const [interactionIndex, optionIndex] = button.dataset.wRemoveOption.split(':').map(Number);
      wizard.interactions[interactionIndex].options.splice(optionIndex, 1);
      renderInteractionsStep(root);
    }));
  }

  function operationOptions(current = '') {
    const values = [
      current,
      ...wizard.existingActions.map((item) => item.actionKey),
      ...wizard.actions.map((item) => item.actionKey),
      ...wizard.existingRecipes.map((item) => item.recipeKey),
      ...(wizard.recipe.enabled && wizard.recipe.recipeKey ? [wizard.recipe.recipeKey] : []),
    ].filter(Boolean);
    return [...new Set(values)].map((value) => `<option value="${esc(value)}"></option>`).join('');
  }

  function renderApisStep(root) {
    root.innerHTML = `
      <div class="wizard-card">
        <div class="wizard-card-head"><div><h4>Actions REST</h4><p>Cadastre as APIs que este template ou fluxo poderá executar.</p></div><button id="wAddAction" class="wizard-add" type="button">+ Action REST</button></div>
        <div id="wActionList" class="wizard-list"></div>
      </div>
      <div class="wizard-help">Segredos não entram no Wizard. Use <strong>credentialRef</strong>; o Connect|API resolve a credencial no servidor.</div>`;
    $('wAddAction').addEventListener('click', () => {
      const n = wizard.actions.length + 1;
      wizard.actions.push({ actionKey: `integration.action_${n}`, name: `Action ${n}`, method: 'GET', baseUrl: '', path: '/', credentialRef: '', confirmation: 'NONE', timeoutMs: 10000, allowPrivateNetwork: false, query: {}, body: {}, outputMapping: {} });
      renderApisStep(root);
    });
    $('wActionList').innerHTML = wizard.actions.length ? wizard.actions.map(actionCard).join('') : `<div class="empty">Nenhuma nova Action. Você ainda pode usar Actions existentes: ${wizard.existingActions.length} disponível(is).</div>`;
    bindActionCards(root);
  }

  function actionCard(action, index) {
    return `<article class="wizard-item" data-w-action="${index}">
      <div class="wizard-item-head"><strong>${esc(action.name || action.actionKey || `Action ${index + 1}`)}</strong><button data-w-remove-action="${index}" class="wizard-remove" type="button">Remover</button></div>
      <div class="wizard-grid two"><label><span>Action key</span><input data-w-action-field="actionKey" value="${esc(action.actionKey)}" /></label><label><span>Nome</span><input data-w-action-field="name" value="${esc(action.name)}" /></label></div>
      <div class="wizard-grid three"><label><span>Método</span><select data-w-action-field="method"><option ${action.method === 'GET' ? 'selected' : ''}>GET</option><option ${action.method === 'POST' ? 'selected' : ''}>POST</option><option ${action.method === 'PUT' ? 'selected' : ''}>PUT</option><option ${action.method === 'PATCH' ? 'selected' : ''}>PATCH</option><option ${action.method === 'DELETE' ? 'selected' : ''}>DELETE</option></select></label><label><span>Confirmação</span><select data-w-action-field="confirmation"><option ${action.confirmation === 'NONE' ? 'selected' : ''}>NONE</option><option ${action.confirmation === 'CONFIRM' ? 'selected' : ''}>CONFIRM</option><option ${action.confirmation === 'STRONG' ? 'selected' : ''}>STRONG</option></select></label><label><span>Timeout ms</span><input type="number" data-w-action-field="timeoutMs" value="${esc(action.timeoutMs)}" /></label></div>
      <div class="wizard-grid two"><label><span>Base URL</span><input data-w-action-field="baseUrl" value="${esc(action.baseUrl)}" placeholder="https://erp.exemplo.com/api" /></label><label><span>Path</span><input data-w-action-field="path" value="${esc(action.path)}" placeholder="/customers/{{input.id}}" /></label></div>
      <div class="wizard-grid two"><label><span>credentialRef</span><input data-w-action-field="credentialRef" value="${esc(action.credentialRef)}" placeholder="ERP_PRODUCTION" /></label><label class="wizard-toggle"><input type="checkbox" data-w-action-field="allowPrivateNetwork" ${action.allowPrivateNetwork ? 'checked' : ''}/><span>Permitir rede privada</span></label></div>
      <details class="pro-advanced-only"><summary>Query, body e saída</summary><div class="wizard-grid two" style="margin-top:10px"><label><span>Query JSON</span><textarea class="wizard-code" rows="5" data-w-action-field="query">${esc(pretty(action.query || {}))}</textarea></label><label><span>Body JSON</span><textarea class="wizard-code" rows="5" data-w-action-field="body">${esc(pretty(action.body || {}))}</textarea></label></div><label><span>Output Mapping JSON</span><textarea class="wizard-code" rows="5" data-w-action-field="outputMapping">${esc(pretty(action.outputMapping || {}))}</textarea></label></details>
    </article>`;
  }

  function bindActionCards(root) {
    qa('[data-w-action]', root).forEach((card) => {
      const index = Number(card.dataset.wAction);
      qa('[data-w-action-field]', card).forEach((input) => {
        const eventName = input.type === 'checkbox' ? 'change' : 'input';
        input.addEventListener(eventName, () => {
          const field = input.dataset.wActionField;
          const action = wizard.actions[index];
          if (input.type === 'checkbox') action[field] = input.checked;
          else if (field === 'timeoutMs') action[field] = Number(input.value || 10000);
          else if (['query', 'body', 'outputMapping'].includes(field)) action[field] = parseJson(input.value, action[field] || {}) ?? action[field] ?? {};
          else action[field] = input.value;
        });
      });
    });
    qa('[data-w-remove-action]', root).forEach((button) => button.addEventListener('click', () => {
      wizard.actions.splice(Number(button.dataset.wRemoveAction), 1);
      renderApisStep(root);
    }));
  }

  function renderFlowStep(root) {
    const recipe = wizard.recipe;
    root.innerHTML = `
      <div class="wizard-card">
        <label class="wizard-select-card"><input id="wRecipeEnabled" type="checkbox" ${recipe.enabled ? 'checked' : ''}/><span><strong>Criar Recipe para este fluxo</strong><small>Use quando duas ou mais Actions precisarem ser encadeadas ou quando quiser uma operação reutilizável.</small></span></label>
      </div>
      ${recipe.enabled ? `<div class="wizard-card"><div class="wizard-card-head"><div><h4>Recipe</h4><p>Defina a operação composta.</p></div><button id="wAddRecipeStep" class="wizard-add" type="button">+ Etapa</button></div><div class="wizard-grid three"><label><span>Recipe key</span><input id="wRecipeKey" value="${esc(recipe.recipeKey)}" placeholder="customer.onboarding" /></label><label><span>Nome</span><input id="wRecipeName" value="${esc(recipe.name)}" /></label><label><span>Confirmação</span><select id="wRecipeConfirmation"><option ${recipe.confirmation === 'NONE' ? 'selected' : ''}>NONE</option><option ${recipe.confirmation === 'CONFIRM' ? 'selected' : ''}>CONFIRM</option><option ${recipe.confirmation === 'STRONG' ? 'selected' : ''}>STRONG</option></select></label></div><div id="wRecipeSteps" class="wizard-list" style="margin-top:12px">${recipe.steps.map(recipeStepCard).join('') || '<div class="empty">Adicione as Actions que compõem o fluxo.</div>'}</div></div>` : ''}
      <div class="wizard-help">O Wizard usa o mesmo Recipe Service do Studio. Nada é executado durante a criação; somente as definições são registradas.</div>`;
    $('wRecipeEnabled').addEventListener('change', () => {
      recipe.enabled = $('wRecipeEnabled').checked;
      if (recipe.enabled && !recipe.recipeKey) {
        recipe.recipeKey = `${slug(wizard.template.name, 'template')}.flow`;
        recipe.name = `Fluxo · ${wizard.template.name || 'Template'}`;
      }
      renderFlowStep(root);
    });
    $('wAddRecipeStep')?.addEventListener('click', () => {
      const n = recipe.steps.length + 1;
      recipe.steps.push({ id: `step_${n}`, action: wizard.actions[n - 1]?.actionKey || wizard.existingActions[0]?.actionKey || '', input: {}, continueOnError: false });
      renderFlowStep(root);
    });
    bindRecipeStep(root);
  }

  function recipeStepCard(step, index) {
    const actions = [...wizard.existingActions.map((item) => item.actionKey), ...wizard.actions.map((item) => item.actionKey)].filter(Boolean);
    return `<div class="wizard-item" data-w-recipe-step="${index}"><div class="wizard-item-head"><strong>Etapa ${index + 1}</strong><button data-w-remove-recipe-step="${index}" class="wizard-remove" type="button">Remover</button></div><div class="wizard-grid three"><label><span>ID</span><input data-w-rstep="id" value="${esc(step.id)}" /></label><label><span>Action</span><select data-w-rstep="action"><option value="">Selecione</option>${[...new Set(actions)].map((key) => `<option value="${esc(key)}" ${key === step.action ? 'selected' : ''}>${esc(key)}</option>`).join('')}</select></label><label class="wizard-toggle"><input type="checkbox" data-w-rstep="continueOnError" ${step.continueOnError ? 'checked' : ''}/><span>Continuar em erro</span></label></div><label><span>Input da etapa (JSON)</span><textarea class="wizard-code" rows="4" data-w-rstep="input">${esc(pretty(step.input || {}))}</textarea></label></div>`;
  }

  function bindRecipeStep(root) {
    const recipe = wizard.recipe;
    $('wRecipeKey')?.addEventListener('input', () => (recipe.recipeKey = $('wRecipeKey').value));
    $('wRecipeName')?.addEventListener('input', () => (recipe.name = $('wRecipeName').value));
    $('wRecipeConfirmation')?.addEventListener('input', () => (recipe.confirmation = $('wRecipeConfirmation').value));
    qa('[data-w-recipe-step]', root).forEach((card) => {
      const index = Number(card.dataset.wRecipeStep);
      qa('[data-w-rstep]', card).forEach((input) => {
        const eventName = input.type === 'checkbox' ? 'change' : 'input';
        input.addEventListener(eventName, () => {
          const field = input.dataset.wRstep;
          const step = recipe.steps[index];
          if (input.type === 'checkbox') step[field] = input.checked;
          else if (field === 'input') step[field] = parseJson(input.value, step[field] || {}) ?? step[field] ?? {};
          else step[field] = input.value;
        });
      });
    });
    qa('[data-w-remove-recipe-step]', root).forEach((button) => button.addEventListener('click', () => {
      recipe.steps.splice(Number(button.dataset.wRemoveRecipeStep), 1);
      renderFlowStep(root);
    }));
  }

  function renderMicroAppStep(root) {
    const app = wizard.microApp;
    root.innerHTML = `
      <div class="wizard-card"><label class="wizard-select-card"><input id="wMicroEnabled" type="checkbox" ${app.enabled ? 'checked' : ''}/><span><strong>Criar Micro App</strong><small>Interface HTTPS vinculada à conversa para formulários, seleção de dados, GPS e tarefas com mais de uma etapa.</small></span></label></div>
      ${app.enabled ? `<div class="wizard-card"><div class="wizard-card-head"><div><h4>Aplicação</h4><p>Defina o Micro App e suas páginas.</p></div><button id="wAddPage" class="wizard-add" type="button">+ Página</button></div><div class="wizard-grid three"><label><span>App key</span><input id="wMicroKey" value="${esc(app.key)}" /></label><label><span>Título</span><input id="wMicroTitle" value="${esc(app.title)}" /></label><label><span>TTL segundos</span><input id="wMicroTtl" type="number" min="60" max="86400" value="${esc(app.ttlSeconds)}" /></label></div><div id="wPages" class="wizard-list" style="margin-top:12px">${app.pages.map(pageCard).join('')}</div></div>
      <div class="wizard-card"><div class="wizard-card-head"><div><h4>Localização</h4><p>Defina se o GPS do Micro App será solicitado.</p></div></div><div class="wizard-grid three"><label><span>Modo</span><select id="wLocationMode"><option ${app.locationMode === 'DISABLED' ? 'selected' : ''}>DISABLED</option><option ${app.locationMode === 'OPTIONAL' ? 'selected' : ''}>OPTIONAL</option><option ${app.locationMode === 'REQUIRED' ? 'selected' : ''}>REQUIRED</option><option ${app.locationMode === 'REQUIRED_AUTO' ? 'selected' : ''}>REQUIRED_AUTO</option></select></label><label><span>Salvar em</span><input id="wLocationCapture" value="${esc(app.capturePath)}" /></label><label><span>Precisão máxima (m)</span><input id="wLocationAccuracy" type="number" value="${esc(app.accuracy)}" /></label></div><div class="wizard-grid two"><label><span>Geofence</span><input id="wGeoName" value="${esc(app.geofence.name)}" /></label><label><span>Raio (m)</span><input id="wGeoRadius" type="number" value="${esc(app.geofence.radiusMeters)}" /></label></div><div class="wizard-grid two"><label><span>Latitude</span><input id="wGeoLat" type="number" step="any" value="${esc(app.geofence.latitude)}" placeholder="-12.9714" /></label><label><span>Longitude</span><input id="wGeoLon" type="number" step="any" value="${esc(app.geofence.longitude)}" placeholder="-38.5014" /></label></div><div class="wizard-grid two"><label><span>Ao concluir</span><select id="wMicroSubmitType"><option ${app.submitType === 'NONE' ? 'selected' : ''}>NONE</option><option ${app.submitType === 'ACTION' ? 'selected' : ''}>ACTION</option><option ${app.submitType === 'RECIPE' ? 'selected' : ''}>RECIPE</option></select></label><label><span>Action / Recipe</span><input id="wMicroSubmitKey" list="wMicroOperationKeys" value="${esc(app.submitKey)}" /></label><datalist id="wMicroOperationKeys">${operationOptions(app.submitKey)}</datalist></div></div>` : ''}
      <div class="wizard-help">Para o modelo <strong>WhatsApp Location</strong>, use uma interação WHATSAPP_LOCATION na etapa anterior. Para GPS do navegador, use Micro App com OPTIONAL, REQUIRED ou REQUIRED_AUTO.</div>`;
    $('wMicroEnabled').addEventListener('change', () => {
      app.enabled = $('wMicroEnabled').checked;
      if (app.enabled && !app.key) {
        app.key = `${slug(wizard.template.name, 'template')}_app`;
        app.title = wizard.template.name || 'Micro App';
      }
      renderMicroAppStep(root);
    });
    bindMicroApp(root);
  }

  function pageCard(page, pageIndex) {
    return `<article class="wizard-item" data-w-page="${pageIndex}"><div class="wizard-item-head"><strong>Página ${pageIndex + 1}</strong><div class="wizard-inline"><button data-w-add-field="${pageIndex}" class="wizard-add" type="button">+ Campo</button>${wizard.microApp.pages.length > 1 ? `<button data-w-remove-page="${pageIndex}" class="wizard-remove" type="button">Remover</button>` : ''}</div></div><div class="wizard-grid two"><label><span>Page key</span><input data-w-page-field="key" value="${esc(page.key)}" /></label><label><span>Título</span><input data-w-page-field="title" value="${esc(page.title)}" /></label></div><div class="wizard-list">${page.fields.map((field, fieldIndex) => fieldRow(pageIndex, field, fieldIndex)).join('') || '<div class="empty">Sem campos nesta página.</div>'}</div></article>`;
  }

  function fieldRow(pageIndex, field, fieldIndex) {
    return `<div class="wizard-grid three" data-w-field="${fieldIndex}"><label><span>Tipo</span><select data-w-field-prop="type"><option ${field.type === 'INPUT' ? 'selected' : ''}>INPUT</option><option ${field.type === 'DATE' ? 'selected' : ''}>DATE</option><option ${field.type === 'TIME' ? 'selected' : ''}>TIME</option><option ${field.type === 'CHECKBOX' ? 'selected' : ''}>CHECKBOX</option><option ${field.type === 'SELECT' ? 'selected' : ''}>SELECT</option></select></label><label><span>ID</span><input data-w-field-prop="id" value="${esc(field.id)}" /></label><label><span>Label</span><div class="wizard-inline"><input data-w-field-prop="label" value="${esc(field.label)}" /><button data-w-remove-field="${pageIndex}:${fieldIndex}" class="wizard-remove" type="button">×</button></div></label></div>`;
  }

  function bindMicroApp(root) {
    const app = wizard.microApp;
    $('wMicroKey')?.addEventListener('input', () => (app.key = $('wMicroKey').value));
    $('wMicroTitle')?.addEventListener('input', () => (app.title = $('wMicroTitle').value));
    $('wMicroTtl')?.addEventListener('input', () => (app.ttlSeconds = Number($('wMicroTtl').value || 900)));
    $('wLocationMode')?.addEventListener('input', () => (app.locationMode = $('wLocationMode').value));
    $('wLocationCapture')?.addEventListener('input', () => (app.capturePath = $('wLocationCapture').value));
    $('wLocationAccuracy')?.addEventListener('input', () => (app.accuracy = Number($('wLocationAccuracy').value || 100)));
    $('wGeoName')?.addEventListener('input', () => (app.geofence.name = $('wGeoName').value));
    $('wGeoRadius')?.addEventListener('input', () => (app.geofence.radiusMeters = Number($('wGeoRadius').value || 150)));
    $('wGeoLat')?.addEventListener('input', () => (app.geofence.latitude = $('wGeoLat').value));
    $('wGeoLon')?.addEventListener('input', () => (app.geofence.longitude = $('wGeoLon').value));
    $('wMicroSubmitType')?.addEventListener('input', () => (app.submitType = $('wMicroSubmitType').value));
    $('wMicroSubmitKey')?.addEventListener('input', () => (app.submitKey = $('wMicroSubmitKey').value));
    $('wAddPage')?.addEventListener('click', () => {
      const n = app.pages.length + 1;
      app.pages.push({ key: `page_${n}`, title: `Página ${n}`, fields: [] });
      renderMicroAppStep(root);
    });
    qa('[data-w-page]', root).forEach((card) => {
      const pageIndex = Number(card.dataset.wPage);
      qa('[data-w-page-field]', card).forEach((input) => input.addEventListener('input', () => (app.pages[pageIndex][input.dataset.wPageField] = input.value)));
      qa('[data-w-field]', card).forEach((row) => {
        const fieldIndex = Number(row.dataset.wField);
        qa('[data-w-field-prop]', row).forEach((input) => input.addEventListener('input', () => (app.pages[pageIndex].fields[fieldIndex][input.dataset.wFieldProp] = input.value)));
      });
    });
    qa('[data-w-add-field]', root).forEach((button) => button.addEventListener('click', () => {
      const page = app.pages[Number(button.dataset.wAddField)];
      const n = page.fields.length + 1;
      page.fields.push({ type: 'INPUT', id: `field_${n}`, label: `Campo ${n}` });
      renderMicroAppStep(root);
    }));
    qa('[data-w-remove-field]', root).forEach((button) => button.addEventListener('click', () => {
      const [pageIndex, fieldIndex] = button.dataset.wRemoveField.split(':').map(Number);
      app.pages[pageIndex].fields.splice(fieldIndex, 1);
      renderMicroAppStep(root);
    }));
    qa('[data-w-remove-page]', root).forEach((button) => button.addEventListener('click', () => {
      app.pages.splice(Number(button.dataset.wRemovePage), 1);
      renderMicroAppStep(root);
    }));
  }

  function renderReviewStep(root) {
    const payload = buildSolution();
    root.innerHTML = `
      <div class="wizard-review">
        <div class="wizard-review-card"><strong>Template</strong><span>${esc(payload.template.name)} · ${esc(payload.template.language)} · ${esc(payload.template.category)}\n${esc(payload.template.components.find((item) => item.type === 'BODY')?.text || '')}</span></div>
        <div class="wizard-review-card"><strong>Interações</strong><span>${wizard.interactions.length} interação(ões)\n${esc(wizard.interactions.map((item) => `${item.type}: ${item.title || item.id}`).join('\n') || 'Nenhuma')}</span></div>
        <div class="wizard-review-card"><strong>Dados & APIs</strong><span>${wizard.actions.length} nova(s) Action(s)\n${esc(wizard.actions.map((item) => item.actionKey).join('\n') || 'Usará apenas integrações existentes')}</span></div>
        <div class="wizard-review-card"><strong>Fluxo</strong><span>${wizard.recipe.enabled ? `${esc(wizard.recipe.recipeKey)} · ${wizard.recipe.steps.length} etapa(s)` : 'Recipe não será criada'}</span></div>
        <div class="wizard-review-card"><strong>Micro App</strong><span>${wizard.microApp.enabled ? `${esc(wizard.microApp.key)} · ${wizard.microApp.pages.length} página(s) · GPS ${esc(wizard.microApp.locationMode)}` : 'Não será criado'}</span></div>
        <div class="wizard-review-card"><strong>Instância</strong><span>${esc(instanceName())}\nAs definições serão registradas somente ao clicar em “Criar solução”.</span></div>
      </div>
      <div class="wizard-card" style="margin-top:12px"><div class="wizard-card-head"><div><h4>Ordem de criação</h4><p>O Wizard respeita dependências para não deixar bindings apontando para recursos inexistentes.</p></div></div><div class="wizard-help">1. Actions REST → 2. Recipe → 3. Template + Interações + Micro App. Se uma etapa falhar, o Wizard mostra exatamente onde parou.</div><div id="wCreateStatus" style="margin-top:10px"></div></div>`;
  }

  function collectCurrentStep() {
    if (wizard.step === 0) {
      wizard.template.name = String($('wTemplateName')?.value || wizard.template.name).trim();
      wizard.template.language = String($('wTemplateLanguage')?.value || wizard.template.language).trim();
      wizard.template.category = String($('wTemplateCategory')?.value || wizard.template.category);
      wizard.template.header = String($('wTemplateHeader')?.value || '');
      wizard.template.footer = String($('wTemplateFooter')?.value || '');
      wizard.template.body = String($('wTemplateBody')?.value || '');
    }
  }

  function validateStep(index) {
    if (index === 0) {
      if (!wizard.template.name) throw new Error('Informe o nome do template.');
      if (!wizard.template.body.trim()) throw new Error('A mensagem precisa de um corpo.');
    }
    if (index === 1) {
      for (const item of wizard.interactions) {
        if (['LIST', 'CHOICE'].includes(item.type) && (!item.options || !item.options.length)) throw new Error(`${item.type} precisa de pelo menos uma opção.`);
        if (['QUICK_REPLY', 'LIST', 'CHOICE', 'WHATSAPP_LOCATION'].includes(item.type) && item.targetType !== 'NONE' && !item.targetKey) throw new Error(`Informe a Action/Recipe da interação ${item.title || item.id}.`);
      }
    }
    if (index === 2) {
      for (const action of wizard.actions) {
        if (!action.actionKey || !action.name || !action.baseUrl) throw new Error('Cada Action precisa de key, nome e Base URL.');
      }
    }
    if (index === 3 && wizard.recipe.enabled) {
      if (!wizard.recipe.recipeKey || !wizard.recipe.name) throw new Error('Informe key e nome da Recipe.');
      if (!wizard.recipe.steps.length || wizard.recipe.steps.some((step) => !step.id || !step.action)) throw new Error('A Recipe precisa de etapas válidas.');
    }
    if (index === 4 && wizard.microApp.enabled) {
      if (!wizard.microApp.key || !wizard.microApp.title || !wizard.microApp.pages.length) throw new Error('Micro App precisa de key, título e pelo menos uma página.');
      if (wizard.microApp.locationMode !== 'DISABLED' && (!wizard.microApp.geofence.latitude || !wizard.microApp.geofence.longitude)) throw new Error('Informe latitude e longitude da geofence ou desative a localização.');
    }
  }

  function buildSolution() {
    const components = [];
    if (wizard.template.header.trim()) components.push({ type: 'HEADER', format: 'TEXT', text: wizard.template.header.trim() });
    components.push({ type: 'BODY', text: wizard.template.body });
    if (wizard.template.footer.trim()) components.push({ type: 'FOOTER', text: wizard.template.footer.trim() });

    const buttons = wizard.interactions.flatMap((item) => {
      if (item.type === 'QUICK_REPLY') return [{ type: 'QUICK_REPLY', text: item.title, id: item.value || item.id || slug(item.title, 'reply') }];
      if (item.type === 'URL') return [{ type: 'URL', text: item.title, url: item.value }];
      if (item.type === 'PHONE_NUMBER') return [{ type: 'PHONE_NUMBER', text: item.title, phone_number: item.value }];
      if (item.type === 'COPY_CODE') return [{ type: 'COPY_CODE', text: item.title, example: item.value }];
      return [];
    });
    if (buttons.length) components.push({ type: 'BUTTONS', buttons });

    const policy = { interactionTtlSeconds: 86400 };
    const v2Items = wizard.interactions.filter((item) => ['LIST', 'CHOICE'].includes(item.type)).map((item) => buildV2Interaction(item));
    if (v2Items.length) policy.interactionsV2 = { version: 2, items: v2Items };
    if (wizard.microApp.enabled) policy.microApps = { version: 1, apps: [buildMicroApp()] };

    const bindings = [];
    wizard.interactions.forEach((item) => {
      if (item.type === 'QUICK_REPLY' && (item.targetType !== 'NONE' || item.capturePath)) {
        bindings.push({
          id: item.value || item.id || slug(item.title, 'reply'),
          matchTitle: item.title,
          type: item.targetType || 'NONE',
          key: item.targetKey || undefined,
          capture: item.capturePath ? { path: item.capturePath } : undefined,
          confirmOnInteraction: true,
          keepSessionOpen: false,
        });
      }
      if (item.type === 'WHATSAPP_LOCATION') {
        const locationPolicy = buildWhatsAppLocationPolicy();
        ['location', 'live_location'].forEach((interactionType) =>
          bindings.push({
            id: `wizard_${interactionType}`,
            interactionType,
            type: item.targetType || 'NONE',
            key: item.targetKey || undefined,
            capture: { path: item.capturePath || 'location', includePayload: true },
            locationPolicy,
            confirmOnInteraction: true,
            keepSessionOpen: false,
          }),
        );
      }
    });

    const actions = wizard.actions.map((action) => {
      const requestTemplate = {};
      if (action.query && Object.keys(action.query).length) requestTemplate.query = action.query;
      if (action.body && Object.keys(action.body).length) requestTemplate.body = action.body;
      return {
        actionKey: action.actionKey,
        name: action.name,
        method: action.method,
        baseUrl: action.baseUrl,
        path: action.path || '/',
        credentialRef: action.credentialRef || undefined,
        requestTemplate,
        outputMapping: action.outputMapping || {},
        inputSchema: {},
        timeoutMs: Number(action.timeoutMs || 10000),
        confirmation: action.confirmation || 'NONE',
        allowPrivateNetwork: Boolean(action.allowPrivateNetwork),
        enabled: true,
      };
    });

    const recipe = wizard.recipe.enabled
      ? {
          recipeKey: wizard.recipe.recipeKey,
          name: wizard.recipe.name,
          steps: wizard.recipe.steps,
          inputSchema: {},
          outputTemplate: {},
          confirmation: wizard.recipe.confirmation || 'NONE',
          enabled: true,
        }
      : null;

    return {
      actions,
      recipe,
      template: {
        name: wizard.template.name,
        language: wizard.template.language || 'pt_BR',
        category: wizard.template.category || 'UTILITY',
        allowCategoryChange: false,
        components,
        actions: { bindings },
        policy,
        enabled: true,
      },
    };
  }

  function buildV2Interaction(item) {
    const buildRow = (option) => ({
      id: option.id,
      title: option.title,
      ...(option.description ? { description: option.description } : {}),
      ...(item.capturePath ? { capture: { path: item.capturePath } } : {}),
      ...(item.targetType !== 'NONE' && item.targetKey
        ? { binding: { type: item.targetType, key: item.targetKey, confirmOnInteraction: true, keepSessionOpen: false } }
        : {}),
    });
    if (item.type === 'LIST') {
      return {
        type: 'LIST',
        id: item.id || slug(item.title, 'list'),
        title: item.title || 'Escolha uma opção',
        body: item.body || 'Selecione um item',
        buttonText: 'Ver opções',
        sections: [{ title: item.sectionTitle || 'Opções', rows: item.options.map(buildRow) }],
      };
    }
    return {
      type: 'CHOICE',
      id: item.id || slug(item.title, 'choice'),
      title: item.title || 'Escolha uma opção',
      body: item.body || 'Selecione uma opção',
      mode: 'SINGLE',
      options: item.options.map(buildRow),
    };
  }

  function buildWhatsAppLocationPolicy() {
    const app = wizard.microApp;
    const lat = Number(app.geofence.latitude);
    const lon = Number(app.geofence.longitude);
    const geofences = Number.isFinite(lat) && Number.isFinite(lon)
      ? [{ id: slug(app.geofence.name, 'geofence'), name: app.geofence.name || 'Área permitida', latitude: lat, longitude: lon, radiusMeters: Number(app.geofence.radiusMeters || 150) }]
      : [];
    return { enabled: true, required: true, allowedSources: ['WHATSAPP'], geofences, outsideGeofence: geofences.length ? 'BLOCK' : 'ALLOW' };
  }

  function buildMicroApp() {
    const app = wizard.microApp;
    const pages = app.pages.map((page, index) => {
      const next = app.pages[index + 1]?.key;
      const definition = {
        key: page.key,
        title: page.title,
        captureRoot: `pages.${page.key}`,
        components: page.fields.map((field) => ({ type: field.type, id: field.id, label: field.label })),
        ...(next ? { next } : {}),
      };
      if (index === app.pages.length - 1 && app.locationMode !== 'DISABLED') {
        const latitude = Number(app.geofence.latitude);
        const longitude = Number(app.geofence.longitude);
        definition.location = {
          mode: app.locationMode,
          capturePath: app.capturePath || 'location',
          policy: {
            enabled: true,
            allowedSources: ['MICRO_APP_GPS'],
            maxAccuracyMeters: Number(app.accuracy || 100),
            geofences: Number.isFinite(latitude) && Number.isFinite(longitude)
              ? [{ id: slug(app.geofence.name, 'geofence'), name: app.geofence.name || 'Área permitida', latitude, longitude, radiusMeters: Number(app.geofence.radiusMeters || 150) }]
              : [],
            outsideGeofence: 'BLOCK',
          },
        };
        definition.components.push({ type: 'LOCATION', id: 'location', label: 'Localização atual' });
      }
      if (index === app.pages.length - 1 && app.submitType !== 'NONE' && app.submitKey) definition.submit = { type: app.submitType, key: app.submitKey, input: { form: '{{input}}' }, confirmed: true };
      return definition;
    });
    return {
      key: app.key,
      title: app.title,
      description: `Criado pelo Wizard para ${wizard.template.name}`,
      startPage: pages[0]?.key,
      ttlSeconds: Number(app.ttlSeconds || 900),
      accessMode: 'CONVERSATION_SESSION',
      pages,
    };
  }

  async function createSolution() {
    const status = $('wCreateStatus');
    const next = $('wizardNext');
    next.disabled = true;
    try {
      const solution = buildSolution();
      status.innerHTML = '<div class="wizard-help">Preparando criação...</div>';
      for (const action of solution.actions) {
        status.innerHTML = `<div class="wizard-help">Criando Action <strong>${esc(action.actionKey)}</strong>...</div>`;
        await api(`/action/create/${encodeURIComponent(instanceName())}`, { method: 'POST', body: action });
      }
      if (solution.recipe) {
        status.innerHTML = `<div class="wizard-help">Criando Recipe <strong>${esc(solution.recipe.recipeKey)}</strong>...</div>`;
        await api(`/recipe/create/${encodeURIComponent(instanceName())}`, { method: 'POST', body: solution.recipe });
      }
      status.innerHTML = `<div class="wizard-help">Criando template <strong>${esc(solution.template.name)}</strong>...</div>`;
      await api(`/template/create/${encodeURIComponent(instanceName())}`, { method: 'POST', body: solution.template });
      status.innerHTML = '<div class="wizard-created">Solução criada com sucesso. Abrindo no Studio...</div>';
      toast('Solução conversacional criada.');
      setTimeout(() => {
        closeWizard();
        $('refreshButton')?.click();
        setTimeout(() => selectCreatedTemplate(solution.template.name), 550);
      }, 650);
    } catch (error) {
      status.innerHTML = `<div class="wizard-help" style="border-color:#fecaca;background:#fff1f0;color:#b42318">Falha: ${esc(error.message)}</div>`;
      throw error;
    } finally {
      next.disabled = false;
    }
  }

  function selectCreatedTemplate(name) {
    const search = $('templateSearch');
    if (search) {
      search.value = name;
      search.dispatchEvent(new Event('input', { bubbles: true }));
    }
    setTimeout(() => {
      const item = qa('.template-item').find((node) => q('strong', node)?.textContent?.trim() === name);
      item?.click();
      refreshDeleteVisibility();
    }, 100);
  }

  function modalConfirm(title, message, confirmLabel, danger = false) {
    return new Promise((resolve) => {
      const overlay = document.createElement('div');
      overlay.className = 'studio-wizard-backdrop';
      overlay.style.zIndex = '260';
      overlay.innerHTML = `<section style="width:min(470px,100%);background:#fff;border:1px solid #dbe3ef;border-radius:16px;padding:18px;box-shadow:0 24px 70px rgba(15,23,42,.25)"><h3 style="margin:0 0 7px;font-size:16px">${esc(title)}</h3><p style="margin:0;color:#667085;font-size:12px;line-height:1.55">${esc(message)}</p><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button data-modal="cancel" class="button secondary" type="button">Cancelar</button><button data-modal="ok" class="button ${danger ? 'danger' : 'primary'}" type="button">${esc(confirmLabel)}</button></div></section>`;
      document.body.appendChild(overlay);
      const finish = (value) => {
        overlay.remove();
        resolve(value);
      };
      q('[data-modal="cancel"]', overlay).addEventListener('click', () => finish(false));
      q('[data-modal="ok"]', overlay).addEventListener('click', () => finish(true));
      overlay.addEventListener('click', (event) => {
        if (event.target === overlay) finish(false);
      });
    });
  }

  let attempts = 0;
  function boot() {
    attempts += 1;
    if ((!q('.toolbar-actions') || !$('newTemplateButton')) && attempts < 50) return setTimeout(boot, 100);
    setupEntryPoints();
  }

  boot();
})();
