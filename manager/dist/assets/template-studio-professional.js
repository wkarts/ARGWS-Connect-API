(() => {
  'use strict';
  if (window.__ARGWS_TEMPLATE_STUDIO_PRO__) return;
  window.__ARGWS_TEMPLATE_STUDIO_PRO__ = true;

  const $ = (id) => document.getElementById(id);
  const q = (selector, root = document) => root.querySelector(selector);
  const qa = (selector, root = document) => Array.from(root.querySelectorAll(selector));
  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c]);
  const state = {
    selectedJsonPath: '',
    selectedJsonValue: undefined,
    actionHeaders: {},
    actionRecords: [],
    recipeActions: [],
    mapperFocus: 'proMapSource',
  };

  function parseJson(value, fallback = null) {
    try {
      return JSON.parse(String(value || '').trim() || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  }

  function pretty(value) {
    try {
      return JSON.stringify(value, null, 2);
    } catch {
      return String(value ?? '');
    }
  }

  function toast(message, error = false) {
    const node = $('toast');
    if (!node) return;
    node.textContent = String(message || '');
    node.classList.toggle('error', error);
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 3600);
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

  function icon(name) {
    const icons = {
      catalog: '<svg viewBox="0 0 24 24"><path d="M4 5.5h16M4 12h16M4 18.5h16"/></svg>',
      preview: '<svg viewBox="0 0 24 24"><path d="M2.8 12s3.3-6 9.2-6 9.2 6 9.2 6-3.3 6-9.2 6-9.2-6-9.2-6Z"/><circle cx="12" cy="12" r="2.4"/></svg>',
      connection: '<svg viewBox="0 0 24 24"><path d="M8 12h8M6.5 8.5 3 12l3.5 3.5M17.5 8.5 21 12l-3.5 3.5"/></svg>',
    };
    return icons[name] || '';
  }

  function setupDrawers() {
    document.body.classList.add('studio-pro');
    if (!$('proDrawerBackdrop')) {
      const backdrop = document.createElement('div');
      backdrop.id = 'proDrawerBackdrop';
      backdrop.className = 'pro-drawer-backdrop';
      backdrop.addEventListener('click', closeDrawers);
      document.body.appendChild(backdrop);
    }

    const toolbar = q('.editor-toolbar');
    const actions = q('.toolbar-actions', toolbar || document);
    if (toolbar && actions && !$('proToolbarTools')) {
      const tools = document.createElement('div');
      tools.id = 'proToolbarTools';
      tools.className = 'pro-toolbar-tools';
      tools.innerHTML = `
        <button id="proToggleCatalog" class="pro-tool-button" type="button" title="Catálogo">${icon('catalog')}</button>
        <button id="proTogglePreview" class="pro-tool-button" type="button" title="Preview">${icon('preview')}</button>
        <button id="proToggleConnection" class="pro-tool-button" type="button" title="Conexão">${icon('connection')}</button>`;
      toolbar.insertBefore(tools, actions);
      $('proToggleCatalog').addEventListener('click', () => toggleDrawer('catalog'));
      $('proTogglePreview').addEventListener('click', () => toggleDrawer('preview'));
      $('proToggleConnection').addEventListener('click', () => {
        document.body.classList.toggle('connection-collapsed');
        sessionStorage.setItem('argws-studio-connection-collapsed', document.body.classList.contains('connection-collapsed') ? '1' : '0');
      });
    }

    const catalog = q('.catalog-panel');
    const preview = q('.preview-panel');
    if (catalog && !q('.pro-drawer-close', catalog)) {
      const close = document.createElement('button');
      close.className = 'pro-drawer-close';
      close.type = 'button';
      close.textContent = '×';
      close.setAttribute('aria-label', 'Fechar catálogo');
      close.addEventListener('click', closeDrawers);
      catalog.appendChild(close);
    }
    if (preview && !q('.pro-drawer-close', preview)) {
      const close = document.createElement('button');
      close.className = 'pro-drawer-close';
      close.type = 'button';
      close.textContent = '×';
      close.setAttribute('aria-label', 'Fechar preview');
      close.addEventListener('click', closeDrawers);
      preview.appendChild(close);
    }

    const stored = sessionStorage.getItem('argws-studio-connection-collapsed');
    if (stored === '1') document.body.classList.add('connection-collapsed');
    const badge = $('connectionBadge');
    if (badge) {
      new MutationObserver(() => {
        if (badge.classList.contains('connected') && sessionStorage.getItem('argws-studio-connection-collapsed') === null) {
          document.body.classList.add('connection-collapsed');
        }
      }).observe(badge, { attributes: true, childList: true, subtree: true });
    }
  }

  function toggleDrawer(type) {
    const cls = `${type}-open`;
    const other = type === 'catalog' ? 'preview-open' : 'catalog-open';
    document.body.classList.remove(other);
    document.body.classList.toggle(cls);
  }

  function closeDrawers() {
    document.body.classList.remove('catalog-open', 'preview-open');
  }

  function activateMainTab(name) {
    qa('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.tab === name));
    qa('.tab-panel').forEach((panel) => panel.classList.toggle('active', panel.dataset.panel === name));
    closeDrawers();
  }

  function setupMainNavigation() {
    const nav = q('.tabs');
    const scroll = q('.editor-scroll');
    if (!nav || !scroll) return;
    const integrationsTab = q('[data-tab="integrations"]', nav);
    const advancedTab = q('[data-tab="advanced"]', nav);
    if (integrationsTab) integrationsTab.textContent = 'Dados & APIs';
    if (advancedTab) advancedTab.textContent = 'Configurações';
    if (!q('[data-tab="flow"]', nav)) {
      const flowTab = document.createElement('button');
      flowTab.className = 'tab';
      flowTab.dataset.tab = 'flow';
      flowTab.type = 'button';
      flowTab.textContent = 'Fluxo';
      const testTab = q('[data-tab="test"]', nav);
      nav.insertBefore(flowTab, testTab || advancedTab || null);
      const flowPanel = document.createElement('section');
      flowPanel.className = 'tab-panel';
      flowPanel.dataset.panel = 'flow';
      const testPanel = q('[data-panel="test"]', scroll);
      scroll.insertBefore(flowPanel, testPanel || q('[data-panel="advanced"]', scroll) || null);
    }
    qa('.tab').forEach((tab) => tab.addEventListener('click', () => activateMainTab(tab.dataset.tab)));
  }

  function pageIntro(eyebrow, title, description, actions = '') {
    const wrapper = document.createElement('div');
    wrapper.className = 'pro-page-intro';
    wrapper.innerHTML = `<div><span class="eyebrow">${esc(eyebrow)}</span><h3>${esc(title)}</h3><p>${esc(description)}</p></div>${actions ? `<div class="pro-page-actions">${actions}</div>` : ''}`;
    return wrapper;
  }

  function subnav(items, onChange) {
    const nav = document.createElement('div');
    nav.className = 'pro-subnav';
    nav.innerHTML = items.map((item, index) => `<button class="${index === 0 ? 'active' : ''}" data-pro-sub="${esc(item.key)}" type="button">${esc(item.label)}</button>`).join('');
    qa('[data-pro-sub]', nav).forEach((button) =>
      button.addEventListener('click', () => {
        qa('[data-pro-sub]', nav).forEach((item) => item.classList.toggle('active', item === button));
        onChange(button.dataset.proSub);
      }),
    );
    return nav;
  }

  function setupInteractions() {
    const panel = q('[data-panel="interactions"]');
    if (!panel || $('proInteractionShell')) return;
    const phase6 = $('phase6Studio');
    const buttonCard = $('buttonEditor')?.closest('.section-card');
    const bindingEditor = $('bindingEditor');
    const notice = bindingEditor?.previousElementSibling?.classList?.contains('notice') ? bindingEditor.previousElementSibling : null;

    const shell = document.createElement('div');
    shell.id = 'proInteractionShell';
    shell.innerHTML = `
      <div class="pro-interaction-header">
        <div></div>
        <div class="pro-interaction-menu">
          <button id="proAddInteraction" class="button primary" type="button">+ Adicionar interação</button>
          <div id="proInteractionPalette" class="pro-palette">
            <button data-pro-add="QUICK_REPLY" type="button">Resposta rápida<small>Executa Action/Recipe</small></button>
            <button data-pro-add="URL" type="button">Abrir link<small>CTA para URL</small></button>
            <button data-pro-add="PHONE_NUMBER" type="button">Telefone<small>CTA de chamada</small></button>
            <button data-pro-add="COPY_CODE" type="button">Copiar código<small>Cupom ou código</small></button>
            <button data-pro-add="LIST" type="button">Lista<small>Seções e itens</small></button>
            <button data-pro-add="CHOICE" type="button">Escolha<small>Opções / enquete</small></button>
            <button data-pro-add="MICRO_APP" type="button">Micro App<small>Interface multipágina</small></button>
            <button data-pro-add="LOCATION" type="button">Localização<small>GPS e geofence</small></button>
          </div>
        </div>
      </div>`;

    const intro = pageIntro(
      'Interações',
      'Tudo que o usuário pode tocar, escolher ou responder',
      'Botões, listas, escolhas, Micro Apps e localização ficam em um único lugar. O transporte real continua sendo decidido automaticamente pelo provider.',
    );
    panel.prepend(shell);
    panel.prepend(intro);

    const panes = {
      buttons: document.createElement('div'),
      structured: document.createElement('div'),
      apps: document.createElement('div'),
      location: document.createElement('div'),
    };
    Object.values(panes).forEach((node) => node.classList.add('pro-subpanel'));
    panes.buttons.classList.add('active');
    panes.buttons.dataset.proPane = 'buttons';
    panes.structured.dataset.proPane = 'structured';
    panes.apps.dataset.proPane = 'apps';
    panes.location.dataset.proPane = 'location';

    const nav = subnav(
      [
        { key: 'buttons', label: 'Botões e respostas' },
        { key: 'structured', label: 'Listas e escolhas' },
        { key: 'apps', label: 'Micro Apps' },
        { key: 'location', label: 'Localização' },
      ],
      (key) => activateInteractionPane(key),
    );
    shell.appendChild(nav);
    Object.values(panes).forEach((node) => shell.appendChild(node));

    if (buttonCard) panes.buttons.appendChild(buttonCard);
    if (bindingEditor) {
      const zone = document.createElement('div');
      zone.className = 'pro-binding-zone';
      if (notice) {
        q('strong', notice).textContent = 'Ao responder';
        const p = q('p', notice);
        if (p) p.textContent = 'Defina o que acontece depois de uma resposta rápida: executar uma Action, uma Recipe ou apenas registrar a escolha.';
        zone.appendChild(notice);
      }
      zone.appendChild(bindingEditor);
      panes.buttons.appendChild(zone);
    }

    if (phase6) {
      const structured = q('[data-p6-panel="interactions"]', phase6);
      const apps = q('[data-p6-panel="apps"]', phase6);
      const location = q('[data-p6-panel="location"]', phase6);
      [structured, apps, location].forEach((node) => {
        if (!node) return;
        node.classList.remove('p6-view', 'active');
        node.style.display = 'block';
      });
      if (structured) panes.structured.appendChild(structured);
      if (apps) panes.apps.appendChild(apps);
      if (location) panes.location.appendChild(location);
      phase6.remove();
    }

    $('proAddInteraction').addEventListener('click', (event) => {
      event.stopPropagation();
      $('proInteractionPalette').classList.toggle('open');
    });
    qa('[data-pro-add]', $('proInteractionPalette')).forEach((button) => button.addEventListener('click', () => addInteraction(button.dataset.proAdd)));
    document.addEventListener('click', (event) => {
      if (!event.target.closest('.pro-interaction-menu')) $('proInteractionPalette')?.classList.remove('open');
    });
  }

  function activateInteractionPane(key) {
    qa('[data-pro-pane]').forEach((pane) => pane.classList.toggle('active', pane.dataset.proPane === key));
    qa('#proInteractionShell [data-pro-sub]').forEach((button) => button.classList.toggle('active', button.dataset.proSub === key));
  }

  function addInteraction(type) {
    $('proInteractionPalette')?.classList.remove('open');
    if (['QUICK_REPLY', 'URL', 'PHONE_NUMBER', 'COPY_CODE'].includes(type)) {
      $('addButtonButton')?.click();
      setTimeout(() => {
        const cards = qa('#buttonEditor [data-button-index]');
        const last = cards[cards.length - 1];
        const select = q('[data-button-field="type"]', last || document);
        if (select && type !== 'QUICK_REPLY') {
          select.value = type;
          select.dispatchEvent(new Event('input', { bubbles: true }));
        }
        activateInteractionPane('buttons');
      }, 0);
      return;
    }
    if (type === 'LIST') {
      $('p6AddList')?.click();
      activateInteractionPane('structured');
      return;
    }
    if (type === 'CHOICE') {
      $('p6AddChoice')?.click();
      activateInteractionPane('structured');
      return;
    }
    if (type === 'MICRO_APP') {
      $('p6AddApp')?.click();
      activateInteractionPane('apps');
      return;
    }
    if (type === 'LOCATION') activateInteractionPane('location');
  }

  function setupDataAndFlow() {
    const dataPanel = q('[data-panel="integrations"]');
    const flowPanel = q('[data-panel="flow"]');
    const settingsPanel = q('[data-panel="advanced"]');
    if (!dataPanel || !flowPanel || !settingsPanel) return;

    const actionCard = $('actionRegistryList')?.closest('.integration-card');
    const recipeCard = $('recipeRegistryList')?.closest('.integration-card');
    const sandboxCard = $('integrationTestInput')?.closest('.sandbox-card');
    const phase4 = $('phase4PlatformPanel');
    const phase4Cards = phase4 ? qa('.phase4-card', phase4) : [];

    dataPanel.innerHTML = '';
    dataPanel.appendChild(
      pageIntro(
        'Dados & APIs',
        'Conecte sistemas reais sem transformar o template em código',
        'Construa a requisição, valide o plano, execute um teste controlado, explore o JSON retornado e converta campos da resposta em variáveis e coleções conversacionais.',
      ),
    );
    const dataShell = document.createElement('div');
    dataShell.className = 'pro-data-shell';
    dataPanel.appendChild(dataShell);

    const httpLayout = document.createElement('div');
    httpLayout.className = 'pro-http-layout';
    const httpMain = document.createElement('div');
    httpMain.className = 'pro-http-main';
    const responsePanel = document.createElement('aside');
    responsePanel.className = 'pro-response-panel';
    responsePanel.innerHTML = `
      <div class="pro-response-head"><h4>Resposta e JSON Explorer</h4><span id="proResponseState">Nenhum teste executado</span></div>
      <div id="proJsonTree" class="pro-json-tree"><div class="empty">Execute uma requisição para explorar a resposta.</div></div>
      <div class="pro-mapper">
        <h5>Campo selecionado</h5>
        <div id="proSelectedJsonPath" class="pro-selected-path">Clique em um campo do JSON.</div>
        <div class="pro-mapper-grid">
          <label><span>Nome da variável de saída</span><input id="proOutputName" placeholder="products" /></label>
          <label><span>&nbsp;</span><button id="proAddOutputMap" class="button secondary" type="button">Adicionar variável</button></label>
        </div>
        <div id="proOutputMapList" class="pro-output-map-list"></div>
      </div>
      <div class="pro-mapper">
        <h5>REST → interação</h5>
        <label><span>Interação de destino</span><select id="proMapTarget"><option value="">Selecione LIST/CHOICE</option></select></label>
        <label><span>Caminho do array no contexto</span><input id="proMapSource" placeholder="api.products" /></label>
        <div class="pro-mapper-grid">
          <label><span>ID do item</span><input id="proMapId" placeholder="id" /></label>
          <label><span>Título do item</span><input id="proMapTitle" placeholder="name" /></label>
          <label><span>Descrição</span><input id="proMapDescription" placeholder="price" /></label>
          <label><span>&nbsp;</span><button id="proApplyMapper" class="button primary" type="button">Aplicar à interação</button></label>
        </div>
      </div>`;
    httpLayout.append(httpMain, responsePanel);
    dataShell.appendChild(httpLayout);

    if (actionCard) {
      actionCard.classList.add('pro-action-card');
      const heading = q('.section-heading h3', actionCard);
      if (heading) heading.textContent = 'HTTP Request';
      const headingP = q('.section-heading p', actionCard);
      if (headingP) headingP.textContent = 'Defina uma operação REST reutilizável e segura.';
      const newAction = $('newActionButton');
      if (newAction) newAction.textContent = 'Nova requisição';
      httpMain.appendChild(actionCard);
      enhanceActionCard(actionCard);
    }

    if (sandboxCard) {
      const testInput = $('integrationTestInput');
      const result = $('integrationResult');
      if (testInput) {
        const inputBox = document.createElement('section');
        inputBox.className = 'section-card';
        inputBox.innerHTML = '<div class="section-heading compact"><div><h3>Dados de teste</h3><p>Input usado para resolver path, query e body da Action.</p></div></div>';
        inputBox.appendChild(testInput);
        httpMain.appendChild(inputBox);
      }
      if (result) responsePanel.appendChild(result);
      sandboxCard.remove();
    }

    flowPanel.innerHTML = '';
    flowPanel.appendChild(
      pageIntro(
        'Fluxo',
        'Organize Actions em processos reutilizáveis',
        'Recipes encadeiam operações do Integration Registry. O modo visual mantém o JSON técnico disponível apenas quando necessário.',
      ),
    );
    const flowShell = document.createElement('div');
    flowShell.className = 'pro-flow-shell';
    flowPanel.appendChild(flowShell);
    const flowPanes = { builder: document.createElement('div'), library: document.createElement('div') };
    flowPanes.builder.className = 'pro-subpanel active';
    flowPanes.library.className = 'pro-subpanel';
    flowPanes.builder.dataset.proFlowPane = 'builder';
    flowPanes.library.dataset.proFlowPane = 'library';
    const flowNav = subnav(
      [
        { key: 'builder', label: 'Recipe Builder' },
        { key: 'library', label: 'Biblioteca' },
      ],
      (key) => {
        Object.entries(flowPanes).forEach(([name, node]) => node.classList.toggle('active', name === key));
      },
    );
    flowShell.append(flowNav, flowPanes.builder, flowPanes.library);
    if (recipeCard) {
      flowPanes.builder.appendChild(recipeCard);
      enhanceRecipeCard(recipeCard);
    }
    if (phase4Cards[1]) flowPanes.library.appendChild(phase4Cards[1]);

    setupSettings(settingsPanel, phase4Cards[0], phase4Cards[2]);
    phase4?.remove();
    refreshMapperTargets();
    $('policyJsonInput')?.addEventListener('input', refreshMapperTargets);
    $('policyJsonInput')?.addEventListener('change', refreshMapperTargets);
  }

  function enhanceActionCard(card) {
    const advanced = q('.advanced-box', card);
    const actionActions = q('.integration-actions', card);
    if (advanced) advanced.classList.add('pro-advanced-only');
    if (actionActions && !$('proHttpTools')) {
      const request = document.createElement('div');
      request.className = 'pro-request-tabs';
      request.innerHTML = `
        <label><span>Query JSON</span><textarea id="proQueryInput" spellcheck="false">{}</textarea></label>
        <label><span>Body JSON</span><textarea id="proBodyInput" spellcheck="false">{}</textarea></label>
        <label><span>Headers seguros (JSON)</span><textarea id="proHeadersInput" spellcheck="false">{}</textarea></label>
        <label><span>Observação</span><textarea readonly>Credenciais continuam fora do template e são resolvidas por credentialRef no servidor.</textarea></label>`;
      card.insertBefore(request, advanced || actionActions);
      const tools = document.createElement('div');
      tools.id = 'proHttpTools';
      tools.className = 'pro-request-tools';
      tools.innerHTML = `
        <button id="proSaveAction" class="button primary" type="button">Salvar requisição</button>
        <button id="proValidateAction" class="button secondary" type="button">Validar sem executar</button>
        <button id="proExecuteAction" class="button secondary" type="button">Executar teste real</button>`;
      actionActions.prepend(tools);
      $('saveActionButton').style.display = 'none';
      $('dryRunActionButton').style.display = 'none';
      $('proSaveAction').addEventListener('click', () => saveProAction().catch((e) => toast(e.message, true)));
      $('proValidateAction').addEventListener('click', () => $('dryRunActionButton')?.click());
      $('proExecuteAction').addEventListener('click', () => executeActionTest().catch((e) => toast(e.message, true)));
      ['proQueryInput', 'proBodyInput'].forEach((id) => $(id).addEventListener('input', syncRequestTemplate));
      $('proHeadersInput').addEventListener('input', () => {
        state.actionHeaders = parseJson($('proHeadersInput').value, state.actionHeaders || {}) || {};
      });
      $('actionRegistryList')?.addEventListener('click', () => setTimeout(syncProActionFromSelected, 80));
      $('newActionButton')?.addEventListener('click', () => setTimeout(() => {
        state.actionHeaders = {};
        syncProActionFromFields();
      }, 30));
      syncProActionFromFields();
    }

    const result = $('integrationResult');
    if (result) new MutationObserver(() => parseResponseConsole()).observe(result, { childList: true, characterData: true, subtree: true });
    $('proAddOutputMap')?.addEventListener('click', addOutputMapping);
    $('proApplyMapper')?.addEventListener('click', applyInteractionMapper);
    ['proMapSource', 'proMapId', 'proMapTitle', 'proMapDescription'].forEach((id) => $(id)?.addEventListener('focus', () => (state.mapperFocus = id)));
  }

  function syncRequestTemplate() {
    const queryValue = parseJson($('proQueryInput')?.value, {});
    const bodyValue = parseJson($('proBodyInput')?.value, {});
    const template = {};
    if (queryValue && Object.keys(queryValue).length) template.query = queryValue;
    if (bodyValue && Object.keys(bodyValue).length) template.body = bodyValue;
    if ($('actionRequestInput')) $('actionRequestInput').value = pretty(template);
  }

  function syncProActionFromFields() {
    const template = parseJson($('actionRequestInput')?.value, {}) || {};
    if ($('proQueryInput')) $('proQueryInput').value = pretty(template.query || {});
    if ($('proBodyInput')) $('proBodyInput').value = pretty(template.body || {});
    if ($('proHeadersInput')) $('proHeadersInput').value = pretty(state.actionHeaders || {});
    renderOutputMappings();
  }

  async function syncProActionFromSelected() {
    const key = String($('actionKeyInput')?.value || '').trim();
    if (!key || !instanceName()) return syncProActionFromFields();
    try {
      const data = await api(`/action/find/${encodeURIComponent(instanceName())}`);
      const list = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
      state.actionRecords = list;
      const selected = list.find((item) => item.actionKey === key);
      state.actionHeaders = selected?.headers || {};
    } catch {
      state.actionHeaders = {};
    }
    syncProActionFromFields();
  }

  async function saveProAction() {
    if (!instanceName()) throw new Error('Selecione uma instância.');
    syncRequestTemplate();
    const payload = {
      actionKey: String($('actionKeyInput')?.value || '').trim(),
      name: String($('actionNameInput')?.value || '').trim(),
      method: String($('actionMethodInput')?.value || 'GET'),
      baseUrl: String($('actionBaseUrlInput')?.value || '').trim(),
      path: String($('actionPathInput')?.value || '').trim(),
      timeoutMs: Number($('actionTimeoutInput')?.value || 10000),
      confirmation: String($('actionConfirmationInput')?.value || 'NONE'),
      allowPrivateNetwork: Boolean($('actionPrivateInput')?.checked),
      enabled: true,
      headers: parseJson($('proHeadersInput')?.value, {}) || {},
      requestTemplate: parseJson($('actionRequestInput')?.value, {}) || {},
      outputMapping: parseJson($('actionOutputInput')?.value, {}) || {},
      inputSchema: parseJson($('actionSchemaInput')?.value, {}) || {},
    };
    const credentialRef = String($('actionCredentialInput')?.value || '').trim();
    if (credentialRef) payload.credentialRef = credentialRef;
    if (!payload.actionKey || !payload.name || !payload.baseUrl) throw new Error('Action key, nome e Base URL são obrigatórios.');
    await api(`/action/create/${encodeURIComponent(instanceName())}`, { method: 'POST', body: payload });
    state.actionHeaders = payload.headers;
    $('reloadIntegrationsButton')?.click();
    $('refreshButton')?.click();
    toast('Requisição salva no Integration Registry.');
  }

  async function executeActionTest() {
    const instance = instanceName();
    const actionKey = String($('actionKeyInput')?.value || '').trim();
    if (!instance || !actionKey) throw new Error('Selecione ou salve uma requisição.');
    const method = String($('actionMethodInput')?.value || 'GET').toUpperCase();
    const confirmation = String($('actionConfirmationInput')?.value || 'NONE').toUpperCase();
    if (confirmation === 'STRONG') throw new Error('Actions STRONG devem ser testadas pelo fluxo de aprovação; o Studio não ignora confirmação forte.');
    if (method !== 'GET' || confirmation !== 'NONE') {
      const ok = await confirmModal(
        'Executar requisição real?',
        `${method} pode alterar dados no sistema externo. O teste será executado com a Action salva e ficará registrado no histórico de execução.`,
        'Executar agora',
      );
      if (!ok) return;
    }
    const input = parseJson($('integrationTestInput')?.value, null);
    if (input === null) throw new Error('Input de teste contém JSON inválido.');
    $('proResponseState').textContent = 'Executando...';
    const result = await api(`/action/execute/${encodeURIComponent(instance)}`, {
      method: 'POST',
      body: { actionKey, input, dryRun: false, confirmed: confirmation !== 'NONE' },
    });
    if ($('integrationResult')) $('integrationResult').textContent = pretty(result);
    renderJsonExplorer(result?.data ?? result, result);
    $('proResponseState').textContent = result?.status ? `HTTP ${result.status}` : 'Concluído';
    toast('Requisição executada.');
  }

  function parseResponseConsole() {
    const raw = String($('integrationResult')?.textContent || '').trim();
    if (!raw || raw.startsWith('Nenhum') || raw.startsWith('Executando')) return;
    const value = parseJson(raw, null);
    if (value !== null) renderJsonExplorer(value?.data ?? value, value);
  }

  function renderJsonExplorer(value, envelope = null) {
    const tree = $('proJsonTree');
    if (!tree) return;
    tree.innerHTML = jsonNode(value, 'response.data', 0);
    qa('[data-json-path]', tree).forEach((node) =>
      node.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        state.selectedJsonPath = node.dataset.jsonPath;
        state.selectedJsonValue = valueAtPath({ response: { data: value } }, state.selectedJsonPath);
        $('proSelectedJsonPath').textContent = state.selectedJsonPath;
        const outputName = $('proOutputName');
        if (outputName && !outputName.value) outputName.value = state.selectedJsonPath.split('.').pop().replace(/\W+/g, '_');
        const focus = $(state.mapperFocus);
        if (focus) {
          if (state.mapperFocus === 'proMapSource' && Array.isArray(state.selectedJsonValue)) {
            focus.value = state.selectedJsonPath.replace(/^response\.data\.?/, '');
          } else if (state.mapperFocus !== 'proMapSource') {
            focus.value = state.selectedJsonPath.split('.').pop();
          }
        }
      }),
    );
    if (envelope?.status) $('proResponseState').textContent = `HTTP ${envelope.status}`;
  }

  function jsonNode(value, path, depth) {
    if (depth > 7) return `<div class="pro-json-value">…</div>`;
    if (Array.isArray(value)) {
      const children = value.slice(0, 30).map((item, index) => jsonNode(item, `${path}.${index}`, depth + 1)).join('');
      return `<details open><summary data-json-path="${esc(path)}"><span class="pro-json-array">${esc(path.split('.').pop())}</span> [${value.length}]</summary>${children}${value.length > 30 ? '<div>…</div>' : ''}</details>`;
    }
    if (value && typeof value === 'object') {
      const entries = Object.entries(value);
      return `<details open><summary data-json-path="${esc(path)}"><span class="pro-json-object">${esc(path.split('.').pop())}</span> {${entries.length}}</summary>${entries
        .map(([key, item]) => {
          const childPath = `${path}.${key}`;
          if (item && typeof item === 'object') return jsonNode(item, childPath, depth + 1);
          return `<button class="pro-json-leaf" data-json-path="${esc(childPath)}" type="button"><span class="pro-json-key">${esc(key)}</span><span class="pro-json-value">${esc(typeof item === 'string' ? item : pretty(item))}</span></button>`;
        })
        .join('')}</details>`;
    }
    return `<button class="pro-json-leaf" data-json-path="${esc(path)}" type="button"><span class="pro-json-key">${esc(path.split('.').pop())}</span><span class="pro-json-value">${esc(String(value ?? 'null'))}</span></button>`;
  }

  function valueAtPath(root, path) {
    return String(path || '').split('.').filter(Boolean).reduce((current, key) => (current == null ? undefined : current[key]), root);
  }

  function addOutputMapping() {
    const name = String($('proOutputName')?.value || '').trim();
    const path = state.selectedJsonPath;
    if (!name || !path) return toast('Selecione um campo da resposta e informe o nome da variável.', true);
    const mapping = parseJson($('actionOutputInput')?.value, {}) || {};
    mapping[name] = `{{${path}}}`;
    $('actionOutputInput').value = pretty(mapping);
    $('proOutputName').value = '';
    renderOutputMappings();
  }

  function renderOutputMappings() {
    const root = $('proOutputMapList');
    if (!root) return;
    const mapping = parseJson($('actionOutputInput')?.value, {}) || {};
    const entries = Object.entries(mapping);
    root.innerHTML = entries.length
      ? entries.map(([key, value]) => `<div class="pro-output-map-row"><input value="${esc(key)}" readonly/><input value="${esc(typeof value === 'string' ? value : pretty(value))}" readonly/><button data-output-remove="${esc(key)}" type="button">×</button></div>`).join('')
      : '<div class="helper">Nenhum campo mapeado.</div>';
    qa('[data-output-remove]', root).forEach((button) => button.addEventListener('click', () => {
      const next = parseJson($('actionOutputInput')?.value, {}) || {};
      delete next[button.dataset.outputRemove];
      $('actionOutputInput').value = pretty(next);
      renderOutputMappings();
    }));
  }

  function refreshMapperTargets() {
    const select = $('proMapTarget');
    if (!select) return;
    const policy = parseJson($('policyJsonInput')?.value, {}) || {};
    const items = policy?.interactionsV2?.items || [];
    const current = select.value;
    select.innerHTML = '<option value="">Selecione LIST/CHOICE</option>' + items.map((item) => `<option value="${esc(item.id)}">${esc(item.id)} · ${esc(item.type)}</option>`).join('');
    if (items.some((item) => item.id === current)) select.value = current;
  }

  function applyInteractionMapper() {
    const target = String($('proMapTarget')?.value || '');
    const sourcePath = String($('proMapSource')?.value || '').trim();
    const idPath = String($('proMapId')?.value || '').trim();
    const titlePath = String($('proMapTitle')?.value || '').trim();
    const descriptionPath = String($('proMapDescription')?.value || '').trim();
    if (!target || !sourcePath || !idPath || !titlePath) return toast('Selecione a interação e informe array, ID e título.', true);
    const policy = parseJson($('policyJsonInput')?.value, {}) || {};
    const item = (policy?.interactionsV2?.items || []).find((entry) => entry.id === target);
    if (!item) return toast('Interação de destino não encontrada.', true);
    item.source = {
      ...(item.source || {}),
      path: sourcePath,
      id: `{{item.${idPath}}}`,
      title: `{{item.${titlePath}}}`,
    };
    if (descriptionPath) item.source.description = `{{item.${descriptionPath}}}`;
    else delete item.source.description;
    $('policyJsonInput').value = pretty(policy);
    $('policyJsonInput').dispatchEvent(new Event('input', { bubbles: true }));
    $('policyJsonInput').dispatchEvent(new Event('change', { bubbles: true }));
    toast('Data Mapper aplicado à interação.');
  }

  function enhanceRecipeCard(card) {
    const stepsLabel = $('recipeStepsInput')?.closest('label');
    if (!stepsLabel || $('proRecipeBuilder')) return;
    const builder = document.createElement('section');
    builder.id = 'proRecipeBuilder';
    builder.className = 'pro-recipe-builder';
    builder.innerHTML = '<div class="section-heading"><div><h3>Etapas do fluxo</h3><p>Adicione Actions em sequência e passe dados entre elas.</p></div><button id="proAddRecipeStep" class="button secondary" type="button">+ Etapa</button></div><div id="proRecipeSteps"></div>';
    stepsLabel.parentNode.insertBefore(builder, stepsLabel);
    const details = document.createElement('details');
    details.className = 'pro-advanced-only';
    const summary = document.createElement('summary');
    summary.textContent = 'JSON técnico das etapas';
    details.append(summary, stepsLabel);
    builder.parentNode.insertBefore(details, builder.nextSibling);
    $('proAddRecipeStep').addEventListener('click', addRecipeStep);
    $('recipeStepsInput').addEventListener('input', renderRecipeSteps);
    $('recipeRegistryList')?.addEventListener('click', () => setTimeout(renderRecipeSteps, 80));
    refreshRecipeActions().then(renderRecipeSteps).catch(renderRecipeSteps);
  }

  async function refreshRecipeActions() {
    if (!instanceName()) return;
    const data = await api(`/action/find/${encodeURIComponent(instanceName())}`);
    state.recipeActions = Array.isArray(data) ? data : Array.isArray(data?.data) ? data.data : [];
  }

  function recipeSteps() {
    const value = parseJson($('recipeStepsInput')?.value, []);
    return Array.isArray(value) ? value : [];
  }

  function writeRecipeSteps(steps) {
    $('recipeStepsInput').value = pretty(steps);
    $('recipeStepsInput').dispatchEvent(new Event('input', { bubbles: true }));
  }

  function addRecipeStep() {
    const steps = recipeSteps();
    const index = steps.length + 1;
    steps.push({ id: `step_${index}`, action: state.recipeActions[0]?.actionKey || '', input: {}, continueOnError: false });
    writeRecipeSteps(steps);
    renderRecipeSteps();
  }

  function renderRecipeSteps() {
    const root = $('proRecipeSteps');
    if (!root) return;
    const steps = recipeSteps();
    root.innerHTML = steps.length
      ? steps.map((step, index) => `<div class="pro-recipe-step" data-recipe-step="${index}">
          <input data-step-field="id" value="${esc(step.id || '')}" placeholder="step_${index + 1}" />
          <select data-step-field="action"><option value="">Selecione Action</option>${state.recipeActions.map((action) => `<option value="${esc(action.actionKey)}" ${action.actionKey === step.action ? 'selected' : ''}>${esc(action.actionKey)}</option>`).join('')}</select>
          <textarea data-step-field="input" spellcheck="false">${esc(pretty(step.input || {}))}</textarea>
          <div><label class="toggle-line"><input data-step-field="continueOnError" type="checkbox" ${step.continueOnError ? 'checked' : ''}/><span>Continuar em erro</span></label><button class="pro-step-remove" data-step-remove="${index}" type="button">Remover</button></div>
        </div>`).join('')
      : '<div class="empty">Nenhuma etapa. Adicione uma Action ao fluxo.</div>';
    qa('[data-recipe-step]', root).forEach((row) => {
      const index = Number(row.dataset.recipeStep);
      qa('[data-step-field]', row).forEach((input) => {
        const eventName = input.type === 'checkbox' ? 'change' : 'input';
        input.addEventListener(eventName, () => {
          const stepsNow = recipeSteps();
          const step = stepsNow[index];
          const field = input.dataset.stepField;
          if (field === 'continueOnError') step[field] = input.checked;
          else if (field === 'input') step[field] = parseJson(input.value, step[field] || {}) || {};
          else step[field] = input.value;
          writeRecipeSteps(stepsNow);
        });
      });
    });
    qa('[data-step-remove]', root).forEach((button) => button.addEventListener('click', () => {
      const stepsNow = recipeSteps();
      stepsNow.splice(Number(button.dataset.stepRemove), 1);
      writeRecipeSteps(stepsNow);
      renderRecipeSteps();
    }));
  }

  function setupSettings(panel, metaPolicyCard, strongCard) {
    const oldCard = q('.section-card', panel);
    panel.innerHTML = '';
    panel.appendChild(
      pageIntro(
        'Configurações',
        'Governança e recursos técnicos',
        'Opções de instância, aprovações críticas e JSON ficam fora do fluxo principal de criação do template.',
      ),
    );
    const grid = document.createElement('div');
    grid.className = 'pro-settings-grid';
    panel.appendChild(grid);

    if (oldCard) {
      const enabled = q('.toggle-line', oldCard);
      if (enabled) {
        const statusCard = document.createElement('section');
        statusCard.className = 'section-card';
        statusCard.innerHTML = '<h3 class="pro-governance-title">Estado do template</h3>';
        statusCard.appendChild(enabled);
        grid.appendChild(statusCard);
      }
      const details = document.createElement('details');
      details.className = 'pro-advanced-only pro-developer-box';
      details.innerHTML = '<summary>Modo desenvolvedor · JSON canônico</summary>';
      oldCard.classList.remove('section-card');
      details.appendChild(oldCard);
      grid.appendChild(details);
    }
    if (metaPolicyCard) {
      q('.eyebrow', metaPolicyCard)?.remove();
      grid.appendChild(metaPolicyCard);
    }
    if (strongCard) {
      q('.eyebrow', strongCard)?.remove();
      grid.appendChild(strongCard);
    }
  }

  function confirmModal(title, message, confirmLabel = 'Confirmar') {
    return new Promise((resolve) => {
      let modal = $('proModal');
      if (!modal) {
        modal = document.createElement('div');
        modal.id = 'proModal';
        modal.style.cssText = 'position:fixed;inset:0;z-index:200;background:rgba(15,23,42,.34);display:grid;place-items:center;padding:18px';
        document.body.appendChild(modal);
      }
      modal.innerHTML = `<section style="width:min(460px,100%);background:#fff;border:1px solid #dbe3ef;border-radius:16px;box-shadow:0 24px 70px rgba(15,23,42,.24);padding:18px"><h3 style="margin:0 0 7px;font-size:16px">${esc(title)}</h3><p style="margin:0;color:#667085;font-size:12px;line-height:1.55">${esc(message)}</p><div style="display:flex;justify-content:flex-end;gap:8px;margin-top:18px"><button id="proModalCancel" class="button secondary" type="button">Cancelar</button><button id="proModalConfirm" class="button primary" type="button">${esc(confirmLabel)}</button></div></section>`;
      const finish = (value) => {
        modal.remove();
        resolve(value);
      };
      $('proModalCancel').addEventListener('click', () => finish(false));
      $('proModalConfirm').addEventListener('click', () => finish(true));
      modal.addEventListener('click', (event) => {
        if (event.target === modal) finish(false);
      });
    });
  }

  function cleanupTechnicalLabels() {
    const card = $('providerTransportPreview');
    if (!card) return;
    const replace = () => {
      qa('.phase5-mode-row strong', card).forEach((node) => {
        const labels = {
          POLL_COMPAT: 'Enquete compatível',
          TEXT_COMPAT: 'Fallback de texto',
          INTERACTIVE: 'Interativo',
          PROVIDER_NATIVE: 'Nativo do provider',
          TEXT: 'Texto',
        };
        if (labels[node.textContent.trim()]) node.textContent = labels[node.textContent.trim()];
      });
      qa('.phase5-interaction-plan strong', card).forEach((node) => (node.textContent = 'Plano das interações'));
    };
    replace();
    new MutationObserver(replace).observe(card, { childList: true, subtree: true });
  }

  function boot() {
    setupDrawers();
    setupMainNavigation();
    setupInteractions();
    setupDataAndFlow();
    cleanupTechnicalLabels();
  }

  let attempts = 0;
  function waitForExtensions() {
    attempts += 1;
    const ready = $('phase6Studio') && $('phase4PlatformPanel');
    if (!ready && attempts < 50) return setTimeout(waitForExtensions, 100);
    boot();
  }

  waitForExtensions();
})();
