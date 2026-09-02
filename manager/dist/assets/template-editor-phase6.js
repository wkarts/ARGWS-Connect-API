(() => {
  'use strict';
  if (window.__ARGWS_CONVERSATIONAL_PHASE6_UI__) return;
  window.__ARGWS_CONVERSATIONAL_PHASE6_UI__ = true;

  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? '').replace(
      /[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[c],
    );
  const clone = (value) => {
    try {
      return structuredClone(value);
    } catch {
      try {
        return JSON.parse(JSON.stringify(value));
      } catch {
        return value;
      }
    }
  };
  const parse = (value, fallback = {}) => {
    try {
      return JSON.parse(value || '{}');
    } catch {
      return fallback;
    }
  };
  const state = { interactionIndex: 0, appIndex: 0, pageIndex: 0, writing: false, lastPreview: null };

  function policy() {
    const value = parse($('policyJsonInput')?.value, {});
    if (!value.interactionsV2 || Number(value.interactionsV2.version) !== 2)
      value.interactionsV2 = { version: 2, items: [] };
    if (!Array.isArray(value.interactionsV2.items)) value.interactionsV2.items = [];
    if (!value.microApps || typeof value.microApps !== 'object') value.microApps = { version: 1, apps: [] };
    if (!Array.isArray(value.microApps.apps)) value.microApps.apps = [];
    return value;
  }

  function writePolicy(value, rerender = false) {
    const input = $('policyJsonInput');
    if (!input) return;
    state.writing = true;
    input.value = JSON.stringify(value, null, 2);
    input.dispatchEvent(new Event('input', { bubbles: true }));
    state.writing = false;
    if (rerender) renderAll();
  }

  function actions() {
    return parse($('actionsJsonInput')?.value, { bindings: [] });
  }
  function instanceName() {
    return String($('instanceSelect')?.value || '').trim();
  }
  function apiKey() {
    return String($('apiKeyInput')?.value || '').trim();
  }
  function templateName() {
    return String($('nameInput')?.value || '').trim();
  }
  function language() {
    return String($('languageInput')?.value || 'pt_BR').trim() || 'pt_BR';
  }
  function sampleVariables() {
    return parse($('variablesInput')?.value, {});
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
    if (!response.ok)
      throw new Error(
        data?.response?.message || data?.message || data?.error?.message || text || `HTTP ${response.status}`,
      );
    return data;
  }

  function toast(message, error = false) {
    const node = $('toast');
    if (!node) return;
    node.textContent = message;
    node.classList.toggle('error', error);
    node.classList.add('show');
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove('show'), 3600);
  }

  function injectStyle() {
    if ($('phase6Style')) return;
    const style = document.createElement('style');
    style.id = 'phase6Style';
    style.textContent = `
      .p6-shell{display:grid;gap:16px;margin-bottom:18px}.p6-hero{display:flex;justify-content:space-between;gap:16px;align-items:flex-start;padding:18px;border:1px solid #dbe4ef;background:linear-gradient(135deg,#fff,#f7faff);border-radius:18px}.p6-hero h3{margin:4px 0 5px}.p6-hero p{margin:0;color:#667085;font-size:12px;line-height:1.5;max-width:760px}.p6-badges{display:flex;gap:6px;flex-wrap:wrap}.p6-badge{font-size:10px;font-weight:800;padding:5px 8px;border-radius:999px;background:#eaf2ff;color:#174ea6;white-space:nowrap}
      .p6-nav{display:flex;gap:8px;flex-wrap:wrap}.p6-nav button{border:1px solid #d7e0ea;background:#fff;color:#475467;border-radius:10px;padding:8px 11px;font-weight:800;cursor:pointer}.p6-nav button.active{background:#1f5fd6;color:#fff;border-color:#1f5fd6}.p6-view{display:none}.p6-view.active{display:block}.p6-grid{display:grid;grid-template-columns:280px minmax(0,1fr);gap:14px}.p6-list,.p6-editor{border:1px solid #dbe4ef;border-radius:16px;background:#fff;padding:14px}.p6-list-head,.p6-editor-head{display:flex;justify-content:space-between;gap:8px;align-items:center;margin-bottom:12px}.p6-list-head h4,.p6-editor-head h4{margin:0}.p6-items{display:grid;gap:7px}.p6-item{display:block;width:100%;text-align:left;border:1px solid #dce5ef;background:#f9fbfd;border-radius:11px;padding:10px;cursor:pointer}.p6-item.active{border-color:#1f5fd6;background:#eef4ff}.p6-item strong{display:block;font-size:12px}.p6-item span{display:block;font-size:10px;color:#667085;margin-top:3px}.p6-actions{display:flex;gap:7px;flex-wrap:wrap}.p6-button{border:1px solid #ccd7e4;background:#fff;border-radius:9px;padding:7px 9px;font-weight:800;font-size:11px;cursor:pointer}.p6-button.primary{background:#1f5fd6;color:#fff;border-color:#1f5fd6}.p6-button.danger{color:#b42318;background:#fff5f4;border-color:#f4c7c3}.p6-form{display:grid;gap:11px}.p6-row{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.p6-row.three{grid-template-columns:repeat(3,minmax(0,1fr))}.p6-form label{display:grid;gap:5px}.p6-form label>span{font-size:10px;font-weight:800;color:#475467}.p6-form input,.p6-form select,.p6-form textarea{width:100%;border:1px solid #ccd7e4;border-radius:9px;padding:9px 10px;background:#fff;color:#172033;font:inherit;font-size:12px}.p6-subcard{border:1px solid #e0e7ef;border-radius:12px;padding:11px;background:#fbfcfe;display:grid;gap:9px}.p6-subhead{display:flex;justify-content:space-between;align-items:center;gap:8px}.p6-subhead strong{font-size:11px}.p6-help{font-size:10px;line-height:1.45;color:#667085}.p6-empty{padding:18px;text-align:center;color:#667085;font-size:11px}.p6-code{font-family:ui-monospace,SFMono-Regular,Consolas,monospace}.p6-console{white-space:pre-wrap;max-height:230px;overflow:auto;padding:11px;border-radius:11px;background:#f8fafc;border:1px solid #e2e8f0;font:10px/1.5 ui-monospace,SFMono-Regular,Consolas,monospace}.p6-transport{display:grid;gap:5px;margin-top:10px}.p6-transport div{font-size:10px;padding:6px 8px;border-radius:8px;background:#f8fafc;border:1px solid #e2e8f0}.p6-map-note{padding:10px;border-left:3px solid #1f5fd6;background:#f4f8ff;font-size:11px;color:#475467}.p6-page-tabs{display:flex;gap:6px;flex-wrap:wrap}.p6-page-tabs button{border:1px solid #d7e0ea;background:#fff;border-radius:8px;padding:6px 8px;font-size:10px;font-weight:800}.p6-page-tabs button.active{background:#eef4ff;border-color:#1f5fd6;color:#174ea6}
      @media(max-width:1050px){.p6-grid{grid-template-columns:1fr}.p6-row,.p6-row.three{grid-template-columns:1fr}}`;
    document.head.appendChild(style);
  }

  function injectUI() {
    const panel = document.querySelector('[data-panel="interactions"]');
    if (!panel || $('phase6Studio')) return;
    const root = document.createElement('section');
    root.id = 'phase6Studio';
    root.className = 'p6-shell';
    root.innerHTML = `
      <div class="p6-hero">
        <div><span class="eyebrow">Conversational Application Studio · Fase 6</span><h3>Interações, dados dinâmicos e Micro Apps</h3><p>LIST/CHOICE vivem em <code>policy.interactionsV2</code>, fora dos components Meta. Dados retornados por APIs podem alimentar opções por path. Micro Apps usam sessões server-side com token expiráveis e GPS/geofence.</p></div>
        <div class="p6-badges"><span class="p6-badge">Meta-safe</span><span class="p6-badge">Baileys-safe</span><span class="p6-badge">Data Mapper</span><span class="p6-badge">GPS</span></div>
      </div>
      <div class="p6-nav"><button class="active" data-p6-view="interactions" type="button">Interações v2</button><button data-p6-view="apps" type="button">Micro Apps</button><button data-p6-view="location" type="button">Localização</button></div>
      <div class="p6-view active" data-p6-panel="interactions"><div class="p6-grid"><div class="p6-list"><div class="p6-list-head"><h4>LIST / CHOICE</h4><div class="p6-actions"><button class="p6-button" id="p6AddList" type="button">+ Lista</button><button class="p6-button" id="p6AddChoice" type="button">+ Escolha</button></div></div><div id="p6InteractionList" class="p6-items"></div></div><div id="p6InteractionEditor" class="p6-editor"></div></div></div>
      <div class="p6-view" data-p6-panel="apps"><div class="p6-grid"><div class="p6-list"><div class="p6-list-head"><h4>Micro Apps</h4><button class="p6-button primary" id="p6AddApp" type="button">+ App</button></div><div id="p6AppList" class="p6-items"></div><div class="p6-help" style="margin-top:10px">O template apenas referencia o app. Estado, dados e localização da sessão não são colocados na URL.</div></div><div id="p6AppEditor" class="p6-editor"></div></div></div>
      <div class="p6-view" data-p6-panel="location"><div class="p6-editor"><div class="p6-editor-head"><h4>GPS e geofence</h4><button id="p6CaptureGps" class="p6-button primary" type="button">Testar GPS deste dispositivo</button></div><div class="p6-map-note">A localização do WhatsApp é normalizada como <code>location</code>; no Micro App o navegador usa <code>navigator.geolocation</code>. O backend calcula distância por Haversine e aplica fonte, precisão e raio.</div><pre id="p6LocationResult" class="p6-console" style="margin-top:12px">Nenhum teste executado.</pre></div></div>`;
    panel.prepend(root);

    root.querySelectorAll('[data-p6-view]').forEach((button) =>
      button.addEventListener('click', () => {
        root.querySelectorAll('[data-p6-view]').forEach((item) => item.classList.toggle('active', item === button));
        root
          .querySelectorAll('[data-p6-panel]')
          .forEach((item) => item.classList.toggle('active', item.dataset.p6Panel === button.dataset.p6View));
      }),
    );
    $('p6AddList')?.addEventListener('click', () => addInteraction('LIST'));
    $('p6AddChoice')?.addEventListener('click', () => addInteraction('CHOICE'));
    $('p6AddApp')?.addEventListener('click', addApp);
    $('p6CaptureGps')?.addEventListener('click', captureGps);
  }

  function interactionItems(p = policy()) {
    return p.interactionsV2.items;
  }

  function addInteraction(type) {
    const p = policy();
    const number = p.interactionsV2.items.length + 1;
    const item =
      type === 'LIST'
        ? {
            type: 'LIST',
            id: `list_${number}`,
            title: 'Escolha uma opção',
            body: 'Selecione um item',
            buttonText: 'Ver opções',
            sections: [
              { title: 'Opções', rows: [{ id: 'option_1', title: 'Opção 1', capture: { path: 'selection' } }] },
            ],
          }
        : {
            type: 'CHOICE',
            id: `choice_${number}`,
            title: 'Confirma?',
            body: 'Selecione uma opção',
            mode: 'SINGLE',
            options: [
              { id: 'yes', title: 'Sim', capture: { path: 'decision', value: true } },
              { id: 'no', title: 'Não', capture: { path: 'decision', value: false } },
            ],
          };
    p.interactionsV2.items.push(item);
    state.interactionIndex = p.interactionsV2.items.length - 1;
    writePolicy(p, true);
  }

  function setInteractionField(field, value) {
    const p = policy();
    const item = p.interactionsV2.items[state.interactionIndex];
    if (!item) return;
    if (value === '' && ['footer'].includes(field)) delete item[field];
    else item[field] = value;
    writePolicy(p);
  }

  function removeInteraction() {
    const p = policy();
    p.interactionsV2.items.splice(state.interactionIndex, 1);
    state.interactionIndex = Math.max(0, state.interactionIndex - 1);
    writePolicy(p, true);
  }

  function sourceEditor(item) {
    const source = item.source || {};
    return `<div class="p6-subcard"><div class="p6-subhead"><strong>Data Mapper · coleção dinâmica</strong><span class="p6-help">Opcional</span></div><div class="p6-row"><label><span>Array path</span><input data-p6-source="path" value="${esc(source.path || '')}" placeholder="api.appointments" /></label><label><span>ID por item</span><input data-p6-source="id" value="${esc(source.id || '')}" placeholder="{{item.id}}" /></label></div><div class="p6-row"><label><span>Título por item</span><input data-p6-source="title" value="${esc(source.title || '')}" placeholder="{{item.name}}" /></label><label><span>Descrição</span><input data-p6-source="description" value="${esc(source.description || '')}" placeholder="{{item.status}}" /></label></div><div class="p6-row"><label><span>Capturar seleção em</span><input data-p6-source-capture value="${esc(source.capture?.path || '')}" placeholder="selection.id" /></label><label><span>Seção</span><input data-p6-source="sectionTitle" value="${esc(source.sectionTitle || '')}" placeholder="Resultados" /></label></div><div class="p6-row three"><label><span>Operação</span><select data-p6-source-binding="type"><option value="NONE">NONE</option><option ${source.binding?.type === 'ACTION' ? 'selected' : ''}>ACTION</option><option ${source.binding?.type === 'RECIPE' ? 'selected' : ''}>RECIPE</option></select></label><label><span>Action / Recipe key</span><input data-p6-source-binding="key" value="${esc(source.binding?.key || '')}" placeholder="scheduler.appointment.select" /></label><label><span>Manter sessão</span><select data-p6-source-binding="keepSessionOpen"><option value="true" ${source.binding?.keepSessionOpen !== false ? 'selected' : ''}>Sim</option><option value="false" ${source.binding?.keepSessionOpen === false ? 'selected' : ''}>Não</option></select></label></div><div id="p6MapperPreview" class="p6-help"></div></div>`;
  }

  function rowEditor(row, index, kind, sectionIndex = 0) {
    return `<div class="p6-subcard" data-p6-row="${index}" data-p6-kind="${kind}" data-p6-section="${sectionIndex}"><div class="p6-subhead"><strong>${kind === 'LIST' ? 'Linha' : 'Opção'} ${index + 1}</strong><button class="p6-button danger" data-p6-remove-row type="button">Remover</button></div><div class="p6-row three"><label><span>ID</span><input data-p6-row-field="id" value="${esc(row.id || '')}" /></label><label><span>Título</span><input data-p6-row-field="title" value="${esc(row.title || '')}" /></label><label><span>Descrição</span><input data-p6-row-field="description" value="${esc(row.description || '')}" /></label></div><div class="p6-row"><label><span>Capturar em</span><input data-p6-row-field="capturePath" value="${esc(row.capture?.path || '')}" placeholder="selection" /></label><label><span>Valor capturado (JSON/template)</span><input data-p6-row-field="captureValue" value="${esc(row.capture?.value === undefined ? '' : typeof row.capture.value === 'string' ? row.capture.value : JSON.stringify(row.capture.value))}" placeholder="{{interaction.id}}" /></label></div><div class="p6-row three"><label><span>Operação</span><select data-p6-row-field="bindingType"><option ${!row.binding?.type || row.binding?.type === 'NONE' ? 'selected' : ''}>NONE</option><option ${row.binding?.type === 'ACTION' ? 'selected' : ''}>ACTION</option><option ${row.binding?.type === 'RECIPE' ? 'selected' : ''}>RECIPE</option></select></label><label><span>Action / Recipe key</span><input data-p6-row-field="bindingKey" value="${esc(row.binding?.key || '')}" /></label><label><span>Confirma pelo clique</span><select data-p6-row-field="confirm"><option value="true" ${row.binding?.confirmOnInteraction !== false ? 'selected' : ''}>Sim</option><option value="false" ${row.binding?.confirmOnInteraction === false ? 'selected' : ''}>Não</option></select></label></div></div>`;
  }

  function renderInteractionList() {
    const list = interactionItems();
    const root = $('p6InteractionList');
    if (!root) return;
    if (!list.length) {
      root.innerHTML = '<div class="p6-empty">Nenhuma interação v2.</div>';
      return;
    }
    if (state.interactionIndex >= list.length) state.interactionIndex = list.length - 1;
    root.innerHTML = list
      .map(
        (item, index) =>
          `<button class="p6-item ${index === state.interactionIndex ? 'active' : ''}" data-p6-interaction="${index}" type="button"><strong>${esc(item.id || `interação ${index + 1}`)}</strong><span>${esc(item.type)} · ${item.source?.path ? `dinâmica: ${esc(item.source.path)}` : 'estática'}</span></button>`,
      )
      .join('');
    root.querySelectorAll('[data-p6-interaction]').forEach((node) =>
      node.addEventListener('click', () => {
        state.interactionIndex = Number(node.dataset.p6Interaction);
        renderInteractions();
      }),
    );
  }

  function renderInteractionEditor() {
    const p = policy();
    const item = p.interactionsV2.items[state.interactionIndex];
    const root = $('p6InteractionEditor');
    if (!root) return;
    if (!item) {
      root.innerHTML = '<div class="p6-empty">Adicione uma LIST ou CHOICE.</div>';
      return;
    }
    const common = `<div class="p6-editor-head"><h4>${esc(item.type)} · ${esc(item.id)}</h4><button id="p6RemoveInteraction" class="p6-button danger" type="button">Excluir interação</button></div><div class="p6-form"><div class="p6-row three"><label><span>ID canônico</span><input data-p6-field="id" value="${esc(item.id || '')}" /></label><label><span>Tipo</span><input value="${esc(item.type)}" disabled /></label>${item.type === 'CHOICE' ? `<label><span>Modo</span><select data-p6-field="mode"><option ${item.mode !== 'MULTIPLE' ? 'selected' : ''}>SINGLE</option><option ${item.mode === 'MULTIPLE' ? 'selected' : ''}>MULTIPLE</option></select></label>` : `<label><span>Texto do botão</span><input data-p6-field="buttonText" value="${esc(item.buttonText || 'Ver opções')}" /></label>`}</div><div class="p6-row"><label><span>Título</span><input data-p6-field="title" value="${esc(item.title || '')}" /></label><label><span>Footer</span><input data-p6-field="footer" value="${esc(item.footer || '')}" /></label></div><label><span>Mensagem</span><textarea data-p6-field="body" rows="3">${esc(item.body || '')}</textarea></label>${sourceEditor(item)}`;
    let collection = '';
    if (item.type === 'LIST') {
      const sections = Array.isArray(item.sections) ? item.sections : [];
      collection = sections
        .map(
          (section, sectionIndex) =>
            `<div class="p6-subcard"><div class="p6-subhead"><strong>Seção ${sectionIndex + 1}</strong><input data-p6-section-title="${sectionIndex}" value="${esc(section.title || '')}" placeholder="Título da seção" style="max-width:260px" /></div>${(section.rows || []).map((row, rowIndex) => rowEditor(row, rowIndex, 'LIST', sectionIndex)).join('') || '<div class="p6-empty">Sem linhas.</div>'}<button class="p6-button" data-p6-add-row="${sectionIndex}" type="button">+ Linha</button></div>`,
        )
        .join('');
      collection += `<button id="p6AddSection" class="p6-button" type="button">+ Seção</button>`;
    } else {
      collection = `<div class="p6-subcard"><div class="p6-subhead"><strong>Opções estáticas</strong><button id="p6AddOption" class="p6-button" type="button">+ Opção</button></div>${(item.options || []).map((row, rowIndex) => rowEditor(row, rowIndex, 'CHOICE')).join('') || '<div class="p6-empty">Sem opções.</div>'}</div>`;
    }
    root.innerHTML = `${common}${collection}<div id="p6InteractionTransport" class="p6-transport"></div></div>`;
    bindInteractionEditor();
    renderMapperPreview();
    renderTransportPreview();
  }

  function bindInteractionEditor() {
    $('p6RemoveInteraction')?.addEventListener('click', removeInteraction);
    document
      .querySelectorAll('#p6InteractionEditor [data-p6-field]')
      .forEach((input) =>
        input.addEventListener('input', () => setInteractionField(input.dataset.p6Field, input.value)),
      );
    document.querySelectorAll('#p6InteractionEditor [data-p6-source]').forEach((input) =>
      input.addEventListener('input', () => {
        const p = policy();
        const item = p.interactionsV2.items[state.interactionIndex];
        if (!item) return;
        item.source ||= {};
        const value = input.value.trim();
        if (value) item.source[input.dataset.p6Source] = value;
        else delete item.source[input.dataset.p6Source];
        if (!item.source.path && !item.source.id && !item.source.title) delete item.source;
        writePolicy(p);
        renderMapperPreview();
      }),
    );
    $('p6InteractionEditor')
      ?.querySelector('[data-p6-source-capture]')
      ?.addEventListener('input', (event) => {
        const p = policy();
        const item = p.interactionsV2.items[state.interactionIndex];
        if (!item) return;
        item.source ||= {};
        const value = event.target.value.trim();
        if (value) item.source.capture = { ...(item.source.capture || {}), path: value };
        else delete item.source.capture;
        writePolicy(p);
      });
    document.querySelectorAll('#p6InteractionEditor [data-p6-source-binding]').forEach((input) =>
      input.addEventListener('input', () => {
        const p = policy();
        const item = p.interactionsV2.items[state.interactionIndex];
        if (!item) return;
        item.source ||= {};
        item.source.binding ||= {};
        const field = input.dataset.p6SourceBinding;
        if (field === 'keepSessionOpen') item.source.binding[field] = input.value === 'true';
        else if (input.value) item.source.binding[field] = input.value;
        else delete item.source.binding[field];
        if ((!item.source.binding.type || item.source.binding.type === 'NONE') && !item.source.binding.key)
          delete item.source.binding;
        writePolicy(p);
      }),
    );
    document.querySelectorAll('#p6InteractionEditor [data-p6-section-title]').forEach((input) =>
      input.addEventListener('input', () => {
        const p = policy();
        const item = p.interactionsV2.items[state.interactionIndex];
        const section = item?.sections?.[Number(input.dataset.p6SectionTitle)];
        if (!section) return;
        section.title = input.value;
        writePolicy(p);
      }),
    );
    $('p6AddSection')?.addEventListener('click', () => {
      const p = policy();
      const item = p.interactionsV2.items[state.interactionIndex];
      item.sections ||= [];
      item.sections.push({ title: `Seção ${item.sections.length + 1}`, rows: [] });
      writePolicy(p, true);
    });
    document.querySelectorAll('#p6InteractionEditor [data-p6-add-row]').forEach((button) =>
      button.addEventListener('click', () => {
        const p = policy();
        const item = p.interactionsV2.items[state.interactionIndex];
        const section = item.sections[Number(button.dataset.p6AddRow)];
        section.rows ||= [];
        const n = section.rows.length + 1;
        section.rows.push({ id: `option_${n}`, title: `Opção ${n}` });
        writePolicy(p, true);
      }),
    );
    $('p6AddOption')?.addEventListener('click', () => {
      const p = policy();
      const item = p.interactionsV2.items[state.interactionIndex];
      item.options ||= [];
      const n = item.options.length + 1;
      item.options.push({ id: `option_${n}`, title: `Opção ${n}` });
      writePolicy(p, true);
    });
    document.querySelectorAll('#p6InteractionEditor [data-p6-row]').forEach((card) => {
      const kind = card.dataset.p6Kind;
      const rowIndex = Number(card.dataset.p6Row);
      const sectionIndex = Number(card.dataset.p6Section || 0);
      const rowFor = (p) =>
        kind === 'LIST'
          ? p.interactionsV2.items[state.interactionIndex]?.sections?.[sectionIndex]?.rows?.[rowIndex]
          : p.interactionsV2.items[state.interactionIndex]?.options?.[rowIndex];
      card.querySelector('[data-p6-remove-row]')?.addEventListener('click', () => {
        const p = policy();
        const item = p.interactionsV2.items[state.interactionIndex];
        if (kind === 'LIST') item.sections[sectionIndex].rows.splice(rowIndex, 1);
        else item.options.splice(rowIndex, 1);
        writePolicy(p, true);
      });
      card.querySelectorAll('[data-p6-row-field]').forEach((input) =>
        input.addEventListener('input', () => {
          const p = policy();
          const row = rowFor(p);
          if (!row) return;
          const field = input.dataset.p6RowField;
          const value = input.value;
          if (field === 'capturePath') {
            if (value.trim()) row.capture = { ...(row.capture || {}), path: value.trim() };
            else delete row.capture;
          } else if (field === 'captureValue') {
            if (!value.trim()) {
              if (row.capture) delete row.capture.value;
            } else {
              row.capture ||= { path: 'selection' };
              try {
                row.capture.value = JSON.parse(value);
              } catch {
                row.capture.value = value;
              }
            }
          } else if (field === 'bindingType') {
            row.binding ||= {};
            row.binding.type = value;
            if (value === 'NONE' && !row.binding.key) delete row.binding;
          } else if (field === 'bindingKey') {
            row.binding ||= { type: 'ACTION' };
            row.binding.key = value.trim();
          } else if (field === 'confirm') {
            row.binding ||= { type: 'NONE' };
            row.binding.confirmOnInteraction = value === 'true';
          } else {
            if (value) row[field] = value;
            else delete row[field];
          }
          writePolicy(p);
        }),
      );
    });
  }

  function renderMapperPreview() {
    const node = $('p6MapperPreview');
    if (!node) return;
    const p = policy();
    const item = p.interactionsV2.items[state.interactionIndex];
    const source = item?.source;
    if (!source?.path) {
      node.textContent = 'Defina um Array path para visualizar dados de amostra.';
      return;
    }
    const value = readPath(sampleVariables(), source.path);
    node.textContent = Array.isArray(value)
      ? `${value.length} item(ns) encontrados em variables.${source.path}. O backend resolve {{item.*}} no envio.`
      : `O path ${source.path} ainda não aponta para um array nas variáveis de amostra.`;
  }

  function readPath(source, path) {
    const normalized = String(path || '')
      .replace(/^\$\.?/, '')
      .replace(/^result\.?/, '')
      .replace(/\[(\d+)\]/g, '.$1');
    return normalized
      .split('.')
      .filter(Boolean)
      .reduce((value, key) => (value == null ? undefined : value[key]), source);
  }

  function renderTransportPreview() {
    const node = $('p6InteractionTransport');
    if (!node) return;
    const item = interactionItems()[state.interactionIndex];
    const plan = state.lastPreview?.transport?.interactions || [];
    const current = plan.find((entry) => entry.id === item?.id);
    node.innerHTML = current
      ? `<div><strong>Provider:</strong> ${esc(state.lastPreview?.provider || '')}</div><div><strong>Transporte:</strong> ${esc(current.mode)} · ${esc(current.compatibilityTransport || 'nativo')}</div>${(current.warnings || []).map((warning) => `<div>${esc(warning)}</div>`).join('')}`
      : '<div>O preview do provider será exibido aqui após conectar a instância.</div>';
  }

  function renderInteractions() {
    renderInteractionList();
    renderInteractionEditor();
  }

  function addApp() {
    const p = policy();
    const n = p.microApps.apps.length + 1;
    p.microApps.apps.push({
      key: `app_${n}`,
      title: `Micro App ${n}`,
      description: 'Fluxo conversacional multipágina',
      startPage: 'start',
      ttlSeconds: 900,
      accessMode: 'CONVERSATION_SESSION',
      pages: [
        {
          key: 'start',
          title: 'Início',
          description: 'Preencha os dados',
          components: [{ type: 'INPUT', id: 'name', label: 'Nome' }],
        },
      ],
    });
    state.appIndex = p.microApps.apps.length - 1;
    state.pageIndex = 0;
    writePolicy(p, true);
  }

  function addCheckinPreset() {
    const p = policy();
    p.microApps.apps.push({
      key: 'checkin',
      title: 'Check-in com localização',
      description: 'Captura dados e valida presença em geofence.',
      startPage: 'identify',
      ttlSeconds: 900,
      accessMode: 'CONVERSATION_SESSION',
      pages: [
        {
          key: 'identify',
          title: 'Identificação',
          description: 'Informe os dados para continuar.',
          captureRoot: 'form',
          components: [
            { type: 'INPUT', id: 'name', label: 'Nome' },
            { type: 'INPUT', id: 'document', label: 'Documento' },
          ],
          next: 'location',
        },
        {
          key: 'location',
          title: 'Confirmar localização',
          description: 'Autorize o GPS para validar sua presença.',
          location: {
            mode: 'REQUIRED_AUTO',
            capturePath: 'visit.location',
            policy: {
              enabled: true,
              allowedSources: ['MICRO_APP_GPS'],
              maxAccuracyMeters: 100,
              geofences: [],
              outsideGeofence: 'BLOCK',
            },
          },
          components: [{ type: 'LOCATION', id: 'location', label: 'Localização atual' }],
        },
      ],
    });
    state.appIndex = p.microApps.apps.length - 1;
    state.pageIndex = 0;
    writePolicy(p, true);
  }

  function renderAppList() {
    const p = policy();
    const apps = p.microApps.apps;
    const root = $('p6AppList');
    if (!root) return;
    if (!apps.length) {
      root.innerHTML =
        '<div class="p6-empty">Nenhum Micro App.<br><button id="p6PresetCheckin" class="p6-button" type="button" style="margin-top:8px">Criar preset de check-in</button></div>';
      $('p6PresetCheckin')?.addEventListener('click', addCheckinPreset);
      return;
    }
    if (state.appIndex >= apps.length) state.appIndex = apps.length - 1;
    root.innerHTML = apps
      .map(
        (app, index) =>
          `<button class="p6-item ${index === state.appIndex ? 'active' : ''}" data-p6-app="${index}" type="button"><strong>${esc(app.title || app.key)}</strong><span>${esc(app.key)} · ${(app.pages || []).length} página(s)</span></button>`,
      )
      .join('');
    root.querySelectorAll('[data-p6-app]').forEach((node) =>
      node.addEventListener('click', () => {
        state.appIndex = Number(node.dataset.p6App);
        state.pageIndex = 0;
        renderApps();
      }),
    );
  }

  function componentSummary(components) {
    return (components || []).map((component) => component.type || 'INPUT').join(', ') || 'sem componentes';
  }

  function renderAppEditor() {
    const p = policy();
    const app = p.microApps.apps[state.appIndex];
    const root = $('p6AppEditor');
    if (!root) return;
    if (!app) {
      root.innerHTML = '<div class="p6-empty">Adicione um Micro App ou use o preset de check-in.</div>';
      return;
    }
    app.pages ||= [];
    if (state.pageIndex >= app.pages.length) state.pageIndex = Math.max(0, app.pages.length - 1);
    const page = app.pages[state.pageIndex];
    root.innerHTML = `<div class="p6-editor-head"><h4>${esc(app.title || app.key)}</h4><div class="p6-actions"><button id="p6TestApp" class="p6-button primary" type="button">Abrir sessão de teste</button><button id="p6RemoveApp" class="p6-button danger" type="button">Excluir app</button></div></div><div class="p6-form"><div class="p6-row three"><label><span>App key</span><input data-p6-app-field="key" value="${esc(app.key || '')}" /></label><label><span>Título</span><input data-p6-app-field="title" value="${esc(app.title || '')}" /></label><label><span>TTL segundos</span><input data-p6-app-field="ttlSeconds" type="number" min="60" max="86400" value="${esc(app.ttlSeconds || 900)}" /></label></div><div class="p6-row"><label><span>Descrição</span><input data-p6-app-field="description" value="${esc(app.description || '')}" /></label><label><span>Start page</span><select data-p6-app-field="startPage">${app.pages.map((candidate) => `<option ${candidate.key === app.startPage ? 'selected' : ''}>${esc(candidate.key)}</option>`).join('')}</select></label></div><div class="p6-subcard"><div class="p6-subhead"><strong>Páginas</strong><button id="p6AddPage" class="p6-button" type="button">+ Página</button></div><div class="p6-page-tabs">${app.pages.map((candidate, index) => `<button class="${index === state.pageIndex ? 'active' : ''}" data-p6-page="${index}" type="button">${esc(candidate.key)}</button>`).join('')}</div></div>${page ? pageEditor(page, app) : '<div class="p6-empty">Adicione uma página.</div>'}<div class="p6-subcard"><div class="p6-subhead"><strong>JSON técnico do app</strong><span class="p6-help">edição avançada</span></div><textarea id="p6AppJson" rows="12" class="p6-code">${esc(JSON.stringify(app, null, 2))}</textarea><button id="p6ApplyAppJson" class="p6-button" type="button">Aplicar JSON</button></div><pre id="p6AppResult" class="p6-console">Nenhuma sessão criada.</pre></div>`;
    bindAppEditor();
  }

  function pageEditor(page, app) {
    const location = page.location || {};
    const geofence = location.policy?.geofences?.[0] || {};
    return `<div class="p6-subcard"><div class="p6-subhead"><strong>Página · ${esc(page.key)}</strong><button id="p6RemovePage" class="p6-button danger" type="button">Remover</button></div><div class="p6-row three"><label><span>Page key</span><input data-p6-page-field="key" value="${esc(page.key || '')}" /></label><label><span>Título</span><input data-p6-page-field="title" value="${esc(page.title || '')}" /></label><label><span>Próxima página</span><select data-p6-page-field="next"><option value="">Concluir</option>${app.pages
      .filter((candidate) => candidate !== page)
      .map((candidate) => `<option ${candidate.key === page.next ? 'selected' : ''}>${esc(candidate.key)}</option>`)
      .join(
        '',
      )}</select></label></div><div class="p6-row"><label><span>Descrição</span><input data-p6-page-field="description" value="${esc(page.description || '')}" /></label><label><span>Capture root</span><input data-p6-page-field="captureRoot" value="${esc(page.captureRoot || '')}" placeholder="form" /></label></div><div class="p6-row three"><label><span>Localização</span><select data-p6-location="mode"><option ${!location.mode || location.mode === 'DISABLED' ? 'selected' : ''}>DISABLED</option><option ${location.mode === 'OPTIONAL' ? 'selected' : ''}>OPTIONAL</option><option ${location.mode === 'REQUIRED' ? 'selected' : ''}>REQUIRED</option><option ${location.mode === 'REQUIRED_AUTO' ? 'selected' : ''}>REQUIRED_AUTO</option></select></label><label><span>Capture path GPS</span><input data-p6-location="capturePath" value="${esc(location.capturePath || 'location')}" /></label><label><span>Precisão máx. m</span><input data-p6-location-policy="maxAccuracyMeters" type="number" value="${esc(location.policy?.maxAccuracyMeters || 100)}" /></label></div><div class="p6-row three"><label><span>Geofence lat</span><input data-p6-geofence="latitude" type="number" step="any" value="${esc(geofence.latitude ?? '')}" /></label><label><span>Geofence lon</span><input data-p6-geofence="longitude" type="number" step="any" value="${esc(geofence.longitude ?? '')}" /></label><label><span>Raio m</span><input data-p6-geofence="radiusMeters" type="number" value="${esc(geofence.radiusMeters || 500)}" /></label></div><div class="p6-row"><label><span>Operação LOAD</span><input data-p6-operation="load" value="${esc(page.load ? `${page.load.type}:${page.load.key}` : '')}" placeholder="ACTION:catalog.list" /></label><label><span>Operação SUBMIT</span><input data-p6-operation="submit" value="${esc(page.submit ? `${page.submit.type}:${page.submit.key}` : '')}" placeholder="RECIPE:checkin.complete" /></label></div><div class="p6-help">Componentes: ${esc(componentSummary(page.components))}. Para INPUT/SELECT/RADIO/TABLE e transições condicionais use o JSON técnico enquanto o designer visual avançado permanece compatível com o mesmo contrato.</div></div>`;
  }

  function bindAppEditor() {
    const pNow = policy();
    const appNow = pNow.microApps.apps[state.appIndex];
    if (!appNow) return;
    $('p6RemoveApp')?.addEventListener('click', () => {
      const p = policy();
      p.microApps.apps.splice(state.appIndex, 1);
      state.appIndex = Math.max(0, state.appIndex - 1);
      state.pageIndex = 0;
      writePolicy(p, true);
    });
    $('p6AddPage')?.addEventListener('click', () => {
      const p = policy();
      const app = p.microApps.apps[state.appIndex];
      const n = app.pages.length + 1;
      app.pages.push({ key: `page_${n}`, title: `Página ${n}`, components: [] });
      state.pageIndex = app.pages.length - 1;
      writePolicy(p, true);
    });
    document.querySelectorAll('#p6AppEditor [data-p6-page]').forEach((node) =>
      node.addEventListener('click', () => {
        state.pageIndex = Number(node.dataset.p6Page);
        renderApps();
      }),
    );
    document.querySelectorAll('#p6AppEditor [data-p6-app-field]').forEach((input) =>
      input.addEventListener('input', () => {
        const p = policy();
        const app = p.microApps.apps[state.appIndex];
        const field = input.dataset.p6AppField;
        app[field] = field === 'ttlSeconds' ? Number(input.value || 900) : input.value;
        writePolicy(p);
        renderAppList();
      }),
    );
    const pageFor = (p) => p.microApps.apps[state.appIndex]?.pages?.[state.pageIndex];
    document.querySelectorAll('#p6AppEditor [data-p6-page-field]').forEach((input) =>
      input.addEventListener('input', () => {
        const p = policy();
        const page = pageFor(p);
        if (!page) return;
        const oldKey = page.key;
        if (input.value) page[input.dataset.p6PageField] = input.value;
        else delete page[input.dataset.p6PageField];
        const app = p.microApps.apps[state.appIndex];
        if (input.dataset.p6PageField === 'key' && app.startPage === oldKey) app.startPage = input.value;
        writePolicy(p);
      }),
    );
    $('p6RemovePage')?.addEventListener('click', () => {
      const p = policy();
      const app = p.microApps.apps[state.appIndex];
      const removed = app.pages.splice(state.pageIndex, 1)[0];
      if (removed?.key === app.startPage) app.startPage = app.pages[0]?.key || '';
      state.pageIndex = Math.max(0, state.pageIndex - 1);
      writePolicy(p, true);
    });
    document.querySelectorAll('#p6AppEditor [data-p6-location]').forEach((input) =>
      input.addEventListener('input', () => {
        const p = policy();
        const page = pageFor(p);
        page.location ||= {};
        const field = input.dataset.p6Location;
        if (field === 'mode' && input.value === 'DISABLED') {
          page.location.mode = 'DISABLED';
        } else page.location[field] = input.value;
        writePolicy(p);
      }),
    );
    document.querySelectorAll('#p6AppEditor [data-p6-location-policy]').forEach((input) =>
      input.addEventListener('input', () => {
        const p = policy();
        const page = pageFor(p);
        page.location ||= {};
        page.location.policy ||= {
          enabled: true,
          allowedSources: ['MICRO_APP_GPS'],
          geofences: [],
          outsideGeofence: 'BLOCK',
        };
        page.location.policy[input.dataset.p6LocationPolicy] = Number(input.value || 0);
        writePolicy(p);
      }),
    );
    document.querySelectorAll('#p6AppEditor [data-p6-geofence]').forEach((input) =>
      input.addEventListener('input', () => {
        const p = policy();
        const page = pageFor(p);
        page.location ||= {};
        page.location.policy ||= { enabled: true, allowedSources: ['MICRO_APP_GPS'], outsideGeofence: 'BLOCK' };
        page.location.policy.geofences ||= [];
        page.location.policy.geofences[0] ||= {
          id: 'default',
          name: 'Área permitida',
          latitude: 0,
          longitude: 0,
          radiusMeters: 500,
        };
        page.location.policy.geofences[0][input.dataset.p6Geofence] = Number(input.value || 0);
        writePolicy(p);
      }),
    );
    document.querySelectorAll('#p6AppEditor [data-p6-operation]').forEach((input) =>
      input.addEventListener('change', () => {
        const p = policy();
        const page = pageFor(p);
        const field = input.dataset.p6Operation;
        const [type, ...rest] = input.value.split(':');
        const key = rest.join(':').trim();
        if (!key || !['ACTION', 'RECIPE'].includes(type.toUpperCase())) delete page[field];
        else page[field] = { type: type.toUpperCase(), key };
        writePolicy(p);
      }),
    );
    $('p6ApplyAppJson')?.addEventListener('click', () => {
      try {
        const next = JSON.parse($('p6AppJson').value);
        const p = policy();
        p.microApps.apps[state.appIndex] = next;
        state.pageIndex = 0;
        writePolicy(p, true);
        toast('JSON do Micro App aplicado.');
      } catch (error) {
        toast(`JSON inválido: ${error.message}`, true);
      }
    });
    $('p6TestApp')?.addEventListener('click', createTestSession);
  }

  async function createTestSession() {
    try {
      if (!instanceName() || !apiKey()) throw new Error('Conecte uma instância.');
      if (!templateName()) throw new Error('Salve o template antes de criar a sessão.');
      const p = policy();
      const app = p.microApps.apps[state.appIndex];
      if (!app) throw new Error('Selecione um Micro App.');
      const number = String($('testNumberInput')?.value || '').trim();
      if (!number) throw new Error('Informe o número na aba Teste.');
      const result = await api(`/micro-app/session/${encodeURIComponent(instanceName())}`, {
        method: 'POST',
        body: {
          templateName: templateName(),
          language: language(),
          appKey: app.key,
          number,
          variables: sampleVariables(),
          ttlSeconds: Number(app.ttlSeconds || 900),
        },
      });
      $('p6AppResult').textContent = JSON.stringify(result, null, 2);
      if (result?.url) window.open(result.url, '_blank', 'noopener,noreferrer');
      toast('Sessão Micro App criada.');
    } catch (error) {
      $('p6AppResult').textContent = `ERRO\n${error.message}`;
      toast(error.message, true);
    }
  }

  function renderApps() {
    renderAppList();
    renderAppEditor();
  }

  function captureGps() {
    const out = $('p6LocationResult');
    if (!out) return;
    if (!navigator.geolocation) {
      out.textContent = 'Geolocalização não suportada neste navegador.';
      return;
    }
    out.textContent = 'Obtendo localização...';
    navigator.geolocation.getCurrentPosition(
      (position) => {
        out.textContent = JSON.stringify(
          {
            source: 'MICRO_APP_GPS',
            latitude: position.coords.latitude,
            longitude: position.coords.longitude,
            accuracy: position.coords.accuracy,
            capturedAt: new Date(position.timestamp).toISOString(),
          },
          null,
          2,
        );
      },
      (error) => {
        out.textContent = `ERRO\n${error.message}`;
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 },
    );
  }

  function renderAll() {
    renderInteractions();
    renderApps();
  }

  function reloadFromEditor() {
    if (state.writing) return;
    state.interactionIndex = 0;
    state.appIndex = 0;
    state.pageIndex = 0;
    renderAll();
  }

  injectStyle();
  injectUI();
  renderAll();
  window.addEventListener('argws:template-preview', (event) => {
    state.lastPreview = event.detail;
    renderTransportPreview();
  });
  $('policyJsonInput')?.addEventListener('change', reloadFromEditor);
  $('variablesInput')?.addEventListener('input', renderMapperPreview);
  $('templateList')?.addEventListener('click', () => setTimeout(reloadFromEditor, 80));
  $('newTemplateButton')?.addEventListener('click', () => setTimeout(reloadFromEditor, 50));
  $('duplicateButton')?.addEventListener('click', () => setTimeout(reloadFromEditor, 50));
  $('refreshButton')?.addEventListener('click', () => setTimeout(reloadFromEditor, 400));
  $('connectButton')?.addEventListener('click', () => setTimeout(reloadFromEditor, 700));
})();
