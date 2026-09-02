(() => {
  'use strict';
  if (window.__ARGWS_STUDIO_TRANSFER__) return;
  window.__ARGWS_STUDIO_TRANSFER__ = true;

  const $ = (id) => document.getElementById(id);
  const state = { bundle: null, files: [], importing: false };
  const SECRET_KEY = /(?:^|[_-])(secret|password|passwd|token|api[_-]?key|authorization|cookie)(?:$|[_-])/i;
  const ALLOWED_SECRET_REFERENCE = /^(credentialRef|credential_ref)$/i;

  function apiKey() {
    return String($('apiKeyInput')?.value || '').trim();
  }

  function instanceName() {
    return String($('instanceSelect')?.value || '').trim();
  }

  function esc(value) {
    return String(value ?? '').replace(
      /[&<>"']/g,
      (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char],
    );
  }

  function clone(value) {
    try {
      return structuredClone(value);
    } catch {
      return JSON.parse(JSON.stringify(value));
    }
  }

  function pretty(value) {
    return JSON.stringify(value, null, 2);
  }

  function normalizeArray(value) {
    if (Array.isArray(value)) return value;
    if (Array.isArray(value?.data)) return value.data;
    if (Array.isArray(value?.records)) return value.records;
    if (Array.isArray(value?.templates)) return value.templates;
    return [];
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

  function blankBundle() {
    return {
      schema: 'argws.connect.studio.bundle',
      version: 1,
      exportedAt: new Date().toISOString(),
      source: { product: 'Connect|API Template Studio', instance: instanceName() || undefined },
      templates: [],
      actions: [],
      recipes: [],
      microApps: [],
    };
  }

  function scrubSecrets(value, path = '') {
    if (Array.isArray(value)) return value.map((item, index) => scrubSecrets(item, `${path}[${index}]`));
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if (!ALLOWED_SECRET_REFERENCE.test(key) && SECRET_KEY.test(key)) continue;
      if (/headers/i.test(path) && /^(authorization|cookie|x-api-key)$/i.test(key)) continue;
      result[key] = scrubSecrets(item, path ? `${path}.${key}` : key);
    }
    return result;
  }

  function cleanTemplate(template) {
    return scrubSecrets({
      kind: 'TEMPLATE',
      name: template?.name,
      language: template?.language || 'pt_BR',
      category: template?.category || 'UTILITY',
      components: clone(template?.components || []),
      actions: clone(template?.actions || { bindings: [] }),
      policy: clone(template?.policy || {}),
      enabled: template?.enabled !== false,
      webhookUrl: template?.webhookUrl || undefined,
      source: {
        id: template?.id || template?.templateId || template?.externalTemplateId || undefined,
        origin: template?.origin || undefined,
        isDefault: Boolean(template?.isDefault),
      },
    });
  }

  function cleanAction(action) {
    const allowed = [
      'actionKey',
      'name',
      'description',
      'method',
      'baseUrl',
      'path',
      'credentialRef',
      'headers',
      'requestTemplate',
      'inputSchema',
      'outputMapping',
      'timeoutMs',
      'confirmation',
      'allowPrivateNetwork',
      'enabled',
    ];
    const result = { kind: 'ACTION' };
    for (const key of allowed) if (action?.[key] !== undefined) result[key] = clone(action[key]);
    return scrubSecrets(result);
  }

  function cleanRecipe(recipe) {
    const allowed = ['recipeKey', 'name', 'description', 'version', 'steps', 'inputSchema', 'outputTemplate', 'confirmation', 'enabled'];
    const result = { kind: 'RECIPE' };
    for (const key of allowed) if (recipe?.[key] !== undefined) result[key] = clone(recipe[key]);
    return scrubSecrets(result);
  }

  function extractMicroApps(template) {
    const apps = template?.policy?.microApps?.apps;
    if (!Array.isArray(apps)) return [];
    return apps.map((app) =>
      scrubSecrets({
        kind: 'MICRO_APP',
        templateRef: `${template.name}:${template.language || 'pt_BR'}`,
        app: clone(app),
      }),
    );
  }

  function referencedKeys(template) {
    const actions = new Set();
    const recipes = new Set();
    const visit = (value) => {
      if (Array.isArray(value)) return value.forEach(visit);
      if (!value || typeof value !== 'object') return;
      const type = String(value.type || '').toUpperCase();
      const key = value.key || value.actionKey || value.recipeKey;
      if (key && type === 'ACTION') actions.add(String(key));
      if (key && type === 'RECIPE') recipes.add(String(key));
      Object.values(value).forEach(visit);
    };
    visit(template?.actions);
    visit(template?.policy);
    return { actions, recipes };
  }

  function recipeActionKeys(recipe) {
    return new Set((Array.isArray(recipe?.steps) ? recipe.steps : []).map((step) => step?.action).filter(Boolean).map(String));
  }

  function selectedTemplate(templates) {
    const name = String($('nameInput')?.value || '').trim();
    const language = String($('languageInput')?.value || 'pt_BR').trim() || 'pt_BR';
    return templates.find((template) => template.name === name && String(template.language || 'pt_BR') === language) || null;
  }

  async function workspaceData() {
    if (!instanceName() || !apiKey()) throw new Error('Conecte uma instância antes de importar ou exportar.');
    const [templatesRaw, actionsRaw, recipesRaw] = await Promise.all([
      api(`/template/find/${encodeURIComponent(instanceName())}`),
      api(`/action/find/${encodeURIComponent(instanceName())}`).catch(() => []),
      api(`/recipe/find/${encodeURIComponent(instanceName())}`).catch(() => []),
    ]);
    return {
      templates: normalizeArray(templatesRaw),
      actions: normalizeArray(actionsRaw),
      recipes: normalizeArray(recipesRaw),
    };
  }

  async function buildExportBundle(scope) {
    const workspace = await workspaceData();
    const bundle = blankBundle();
    const current = selectedTemplate(workspace.templates);

    if (scope === 'TEMPLATE' || scope === 'SOLUTION') {
      if (!current) throw new Error('Selecione e salve um template antes de exportar este escopo.');
      bundle.templates = [cleanTemplate(current)];
      bundle.microApps = extractMicroApps(current);
      if (scope === 'SOLUTION') {
        const refs = referencedKeys(current);
        const recipeQueue = [...refs.recipes];
        const includedRecipes = new Map();
        const includedActions = new Map();
        for (const key of refs.actions) {
          const action = workspace.actions.find((item) => item.actionKey === key);
          if (action) includedActions.set(key, cleanAction(action));
        }
        for (const key of recipeQueue) {
          const recipe = workspace.recipes.find((item) => item.recipeKey === key);
          if (!recipe || includedRecipes.has(key)) continue;
          includedRecipes.set(key, cleanRecipe(recipe));
          for (const actionKey of recipeActionKeys(recipe)) {
            const action = workspace.actions.find((item) => item.actionKey === actionKey);
            if (action) includedActions.set(actionKey, cleanAction(action));
          }
        }
        bundle.actions = [...includedActions.values()];
        bundle.recipes = [...includedRecipes.values()];
      }
      return bundle;
    }

    if (scope === 'INTEGRATIONS') {
      bundle.actions = workspace.actions.map(cleanAction);
      bundle.recipes = workspace.recipes.map(cleanRecipe);
      return bundle;
    }

    if (scope === 'MICRO_APPS') {
      bundle.microApps = workspace.templates.flatMap(extractMicroApps);
      return bundle;
    }

    bundle.templates = workspace.templates.map(cleanTemplate);
    bundle.actions = workspace.actions.map(cleanAction);
    bundle.recipes = workspace.recipes.map(cleanRecipe);
    bundle.microApps = workspace.templates.flatMap(extractMicroApps);
    return bundle;
  }

  function csvEscape(value) {
    const text = String(value ?? '');
    return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
  }

  function toNdjson(bundle) {
    const rows = [{ kind: 'MANIFEST', data: { schema: bundle.schema, version: bundle.version, exportedAt: bundle.exportedAt, source: bundle.source } }];
    for (const item of bundle.templates) rows.push({ kind: 'TEMPLATE', data: item });
    for (const item of bundle.actions) rows.push({ kind: 'ACTION', data: item });
    for (const item of bundle.recipes) rows.push({ kind: 'RECIPE', data: item });
    for (const item of bundle.microApps) rows.push({ kind: 'MICRO_APP', data: item });
    return rows.map((row) => JSON.stringify(row)).join('\n');
  }

  function toCsv(bundle) {
    const rows = [['kind', 'key', 'payload']];
    const add = (kind, key, value) => rows.push([kind, key, JSON.stringify(value)]);
    bundle.templates.forEach((item) => add('TEMPLATE', `${item.name}:${item.language || 'pt_BR'}`, item));
    bundle.actions.forEach((item) => add('ACTION', item.actionKey, item));
    bundle.recipes.forEach((item) => add('RECIPE', item.recipeKey, item));
    bundle.microApps.forEach((item) => add('MICRO_APP', item.app?.key || item.templateRef || '', item));
    return rows.map((row) => row.map(csvEscape).join(',')).join('\r\n');
  }

  function metaPayload(bundle) {
    const template = bundle.templates[0];
    if (!template) throw new Error('O formato Meta JSON exige um template no escopo de exportação.');
    return {
      name: template.name,
      language: template.language,
      category: template.category,
      components: template.components,
    };
  }

  function download(name, content, type) {
    const blob = new Blob([content], { type });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = name;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  async function exportBundle() {
    setStatus('Preparando exportação...');
    const scope = $('transferExportScope').value;
    const format = $('transferExportFormat').value;
    const bundle = await buildExportBundle(scope);
    const base = `${slug(instanceName())}-${scope.toLowerCase()}-${new Date().toISOString().slice(0, 10)}`;

    if (format === 'NDJSON') download(`${base}.ndjson`, toNdjson(bundle), 'application/x-ndjson');
    else if (format === 'CSV') download(`${base}.csv`, toCsv(bundle), 'text/csv;charset=utf-8');
    else if (format === 'META_JSON') download(`${base}.meta.json`, pretty(metaPayload(bundle)), 'application/json');
    else if (format === 'ARGWS') download(`${base}.argws`, pretty(bundle), 'application/vnd.argws.connect+json');
    else download(`${base}.json`, pretty(bundle), 'application/json');

    setStatus(`Exportado: ${bundle.templates.length} template(s), ${bundle.actions.length} Action(s), ${bundle.recipes.length} Recipe(s), ${bundle.microApps.length} Micro App(s).`);
  }

  function slug(value) {
    return String(value || 'connect-api')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '') || 'connect-api';
  }

  function detectJson(value, sourceName = 'arquivo') {
    const bundle = blankBundle();
    const add = (kind, data) => {
      if (!data || typeof data !== 'object') return;
      if (kind === 'TEMPLATE') bundle.templates.push(cleanTemplate(data));
      else if (kind === 'ACTION') bundle.actions.push(cleanAction(data));
      else if (kind === 'RECIPE') bundle.recipes.push(cleanRecipe(data));
      else if (kind === 'MICRO_APP') {
        const normalized = data.app ? data : { kind: 'MICRO_APP', templateRef: data.templateRef, app: data };
        bundle.microApps.push(scrubSecrets(normalized));
      }
    };

    if (Array.isArray(value)) {
      value.forEach((item) => mergeBundle(bundle, detectJson(item, sourceName)));
      return bundle;
    }

    if (!value || typeof value !== 'object') throw new Error(`${sourceName}: conteúdo não reconhecido.`);
    if (value.schema === 'argws.connect.studio.bundle' || value.templates || value.actions || value.recipes || value.microApps) {
      normalizeArray(value.templates || []).forEach((item) => add('TEMPLATE', item));
      normalizeArray(value.actions || []).forEach((item) => add('ACTION', item));
      normalizeArray(value.recipes || []).forEach((item) => add('RECIPE', item));
      normalizeArray(value.microApps || []).forEach((item) => add('MICRO_APP', item));
      return bundle;
    }
    if (Array.isArray(value.data) && value.data.some((item) => item?.components)) {
      value.data.forEach((item) => add('TEMPLATE', item));
      return bundle;
    }
    if (value.kind && value.data) {
      if (String(value.kind).toUpperCase() !== 'MANIFEST') add(String(value.kind).toUpperCase(), value.data);
      return bundle;
    }
    if (value.actionKey) add('ACTION', value);
    else if (value.recipeKey) add('RECIPE', value);
    else if (value.pages && value.key) add('MICRO_APP', value);
    else if (value.name && value.components) add('TEMPLATE', value);
    else throw new Error(`${sourceName}: JSON sem tipo reconhecível.`);
    return bundle;
  }

  function mergeBundle(target, source) {
    target.templates.push(...(source.templates || []));
    target.actions.push(...(source.actions || []));
    target.recipes.push(...(source.recipes || []));
    target.microApps.push(...(source.microApps || []));
    return target;
  }

  function parseCsv(text, sourceName) {
    const rows = [];
    let row = [];
    let cell = '';
    let quoted = false;
    for (let i = 0; i < text.length; i += 1) {
      const char = text[i];
      if (quoted) {
        if (char === '"' && text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else if (char === '"') quoted = false;
        else cell += char;
      } else if (char === '"') quoted = true;
      else if (char === ',') {
        row.push(cell);
        cell = '';
      } else if (char === '\n') {
        row.push(cell.replace(/\r$/, ''));
        rows.push(row);
        row = [];
        cell = '';
      } else cell += char;
    }
    if (cell || row.length) {
      row.push(cell.replace(/\r$/, ''));
      rows.push(row);
    }
    const header = (rows.shift() || []).map((item) => item.trim().toLowerCase());
    const kindIndex = header.indexOf('kind');
    const payloadIndex = header.indexOf('payload');
    if (kindIndex < 0 || payloadIndex < 0) throw new Error(`${sourceName}: CSV precisa das colunas kind e payload.`);
    const bundle = blankBundle();
    for (const values of rows) {
      if (!values.some((item) => String(item).trim())) continue;
      const kind = String(values[kindIndex] || '').toUpperCase();
      let payload;
      try {
        payload = JSON.parse(values[payloadIndex] || '{}');
      } catch {
        throw new Error(`${sourceName}: payload JSON inválido no CSV.`);
      }
      mergeBundle(bundle, detectJson({ kind, data: payload }, sourceName));
    }
    return bundle;
  }

  async function parseFile(file) {
    const text = await file.text();
    const lower = file.name.toLowerCase();
    if (lower.endsWith('.ndjson') || lower.endsWith('.jsonl')) {
      const bundle = blankBundle();
      for (const [index, line] of text.split(/\r?\n/).entries()) {
        if (!line.trim()) continue;
        try {
          mergeBundle(bundle, detectJson(JSON.parse(line), `${file.name}:${index + 1}`));
        } catch (error) {
          throw new Error(`${file.name}, linha ${index + 1}: ${error.message}`);
        }
      }
      return bundle;
    }
    if (lower.endsWith('.csv')) return parseCsv(text, file.name);
    try {
      return detectJson(JSON.parse(text), file.name);
    } catch (error) {
      if (error instanceof SyntaxError) throw new Error(`${file.name}: JSON inválido.`);
      throw error;
    }
  }

  function validateBundle(bundle) {
    const errors = [];
    const warnings = [];
    const duplicate = (values, label) => {
      const seen = new Set();
      for (const value of values.filter(Boolean)) {
        if (seen.has(value)) errors.push(`${label} duplicado no pacote: ${value}`);
        seen.add(value);
      }
    };
    duplicate(bundle.templates.map((item) => `${item.name}:${item.language || 'pt_BR'}`), 'Template');
    duplicate(bundle.actions.map((item) => item.actionKey), 'Action');
    duplicate(bundle.recipes.map((item) => item.recipeKey), 'Recipe');
    duplicate(bundle.microApps.map((item) => `${item.templateRef || ''}:${item.app?.key || ''}`), 'Micro App');

    bundle.templates.forEach((item) => {
      if (!item.name || !Array.isArray(item.components)) errors.push('Template sem name/components válido.');
    });
    bundle.actions.forEach((item) => {
      if (!item.actionKey || !item.baseUrl || !item.method) errors.push(`Action inválida: ${item.actionKey || '(sem key)'}.`);
    });
    bundle.recipes.forEach((item) => {
      if (!item.recipeKey || !Array.isArray(item.steps)) errors.push(`Recipe inválida: ${item.recipeKey || '(sem key)'}.`);
    });
    bundle.microApps.forEach((item) => {
      if (!item.app?.key || !Array.isArray(item.app?.pages)) errors.push('Micro App sem key/pages válido.');
    });
    if (!bundle.templates.length && !bundle.actions.length && !bundle.recipes.length && !bundle.microApps.length) {
      errors.push('Nenhuma entidade importável foi encontrada.');
    }
    if (bundle.microApps.length && !bundle.templates.length) {
      warnings.push('Micro Apps sem template no pacote serão anexados ao template de referência existente ou ao template selecionado.');
    }
    return { errors, warnings };
  }

  async function analyzeFiles(files) {
    const bundle = blankBundle();
    for (const file of files) mergeBundle(bundle, await parseFile(file));
    state.bundle = bundle;
    const validation = validateBundle(bundle);
    renderImportSummary(bundle, validation);
    $('transferApplyImport').disabled = Boolean(validation.errors.length);
  }

  function renderImportSummary(bundle, validation) {
    const root = $('transferImportSummary');
    if (!root) return;
    root.innerHTML = `
      <div class="transfer-counts">
        <span><b>${bundle.templates.length}</b> Templates</span><span><b>${bundle.actions.length}</b> Actions</span><span><b>${bundle.recipes.length}</b> Recipes</span><span><b>${bundle.microApps.length}</b> Micro Apps</span>
      </div>
      ${validation.errors.map((message) => `<div class="transfer-message error">${esc(message)}</div>`).join('')}
      ${validation.warnings.map((message) => `<div class="transfer-message warning">${esc(message)}</div>`).join('')}
      ${!validation.errors.length ? '<div class="transfer-message success">Pacote analisado e pronto para importação.</div>' : ''}`;
  }

  function uniqueKey(base, used) {
    let index = 2;
    let candidate = `${base}_imported`;
    while (used.has(candidate)) candidate = `${base}_imported_${index++}`;
    used.add(candidate);
    return candidate;
  }

  function remapKeys(value, actionMap, recipeMap) {
    if (Array.isArray(value)) return value.map((item) => remapKeys(item, actionMap, recipeMap));
    if (!value || typeof value !== 'object') return value;
    const result = {};
    for (const [key, item] of Object.entries(value)) {
      if ((key === 'actionKey' || key === 'action') && typeof item === 'string') result[key] = actionMap.get(item) || item;
      else if (key === 'recipeKey' && typeof item === 'string') result[key] = recipeMap.get(item) || item;
      else if (key === 'key' && typeof item === 'string' && String(value.type || '').toUpperCase() === 'ACTION') result[key] = actionMap.get(item) || item;
      else if (key === 'key' && typeof item === 'string' && String(value.type || '').toUpperCase() === 'RECIPE') result[key] = recipeMap.get(item) || item;
      else result[key] = remapKeys(item, actionMap, recipeMap);
    }
    return result;
  }

  async function importBundle() {
    if (!state.bundle || state.importing) return;
    if (!instanceName() || !apiKey()) throw new Error('Conecte uma instância antes de importar.');
    state.importing = true;
    $('transferApplyImport').disabled = true;
    try {
      const strategy = $('transferConflictStrategy').value;
      const workspace = await workspaceData();
      const existingActions = new Set(workspace.actions.map((item) => item.actionKey));
      const existingRecipes = new Set(workspace.recipes.map((item) => item.recipeKey));
      const actionMap = new Map();
      const recipeMap = new Map();
      const report = [];

      for (const action of state.bundle.actions) {
        const original = action.actionKey;
        let key = original;
        if (existingActions.has(original)) {
          if (strategy === 'SKIP') {
            actionMap.set(original, original);
            report.push(`Action ${original}: ignorada`);
            continue;
          }
          if (strategy === 'RENAME') key = uniqueKey(original, existingActions);
        }
        actionMap.set(original, key);
        const payload = scrubSecrets({ ...action, actionKey: key });
        delete payload.kind;
        await api(`/action/create/${encodeURIComponent(instanceName())}`, { method: 'POST', body: payload });
        existingActions.add(key);
        report.push(`Action ${original}: ${key === original ? 'importada' : `importada como ${key}`}`);
      }

      for (const recipe of state.bundle.recipes) {
        const original = recipe.recipeKey;
        let key = original;
        if (existingRecipes.has(original)) {
          if (strategy === 'SKIP') {
            recipeMap.set(original, original);
            report.push(`Recipe ${original}: ignorada`);
            continue;
          }
          if (strategy === 'RENAME') key = uniqueKey(original, existingRecipes);
        }
        recipeMap.set(original, key);
        const payload = remapKeys(scrubSecrets({ ...recipe, recipeKey: key }), actionMap, recipeMap);
        delete payload.kind;
        await api(`/recipe/create/${encodeURIComponent(instanceName())}`, { method: 'POST', body: payload });
        existingRecipes.add(key);
        report.push(`Recipe ${original}: ${key === original ? 'importada' : `importada como ${key}`}`);
      }

      const templatesByRef = new Map(workspace.templates.map((item) => [`${item.name}:${item.language || 'pt_BR'}`, item]));
      for (const rawTemplate of state.bundle.templates) {
        const template = remapKeys(clone(rawTemplate), actionMap, recipeMap);
        const ref = `${template.name}:${template.language || 'pt_BR'}`;
        const existing = templatesByRef.get(ref);
        let name = template.name;
        if (existing) {
          const protectedTemplate = existing.isDefault === true || String(existing.origin || '').toUpperCase() === 'SYSTEM';
          if (strategy === 'SKIP' || protectedTemplate) {
            report.push(`Template ${ref}: ${protectedTemplate ? 'protegido e ignorado' : 'ignorado'}`);
            continue;
          }
          if (strategy === 'RENAME') {
            const names = new Set(workspace.templates.map((item) => item.name));
            name = uniqueKey(template.name, names);
          } else {
            await api(`/template/edit/${encodeURIComponent(instanceName())}`, {
              method: 'POST',
              body: {
                templateId: existing.id || existing.templateId || existing.externalTemplateId || existing.localId,
                name: template.name,
                language: template.language || 'pt_BR',
                category: template.category || 'UTILITY',
                components: template.components || [],
                actions: template.actions || { bindings: [] },
                policy: template.policy || {},
                enabled: template.enabled !== false,
              },
            });
            report.push(`Template ${ref}: substituído`);
            continue;
          }
        }
        await api(`/template/create/${encodeURIComponent(instanceName())}`, {
          method: 'POST',
          body: {
            name,
            language: template.language || 'pt_BR',
            category: template.category || 'UTILITY',
            allowCategoryChange: false,
            components: template.components || [],
            actions: template.actions || { bindings: [] },
            policy: template.policy || {},
            enabled: template.enabled !== false,
          },
        });
        report.push(`Template ${ref}: ${name === template.name ? 'importado' : `importado como ${name}`}`);
      }

      if (state.bundle.microApps.length) {
        const refreshed = await workspaceData();
        const map = new Map(refreshed.templates.map((item) => [`${item.name}:${item.language || 'pt_BR'}`, item]));
        const selected = selectedTemplate(refreshed.templates);
        const groups = new Map();
        for (const item of state.bundle.microApps) {
          const ref = item.templateRef && map.has(item.templateRef) ? item.templateRef : selected ? `${selected.name}:${selected.language || 'pt_BR'}` : '';
          if (!ref) throw new Error(`Micro App ${item.app?.key || ''}: não há template de destino selecionado.`);
          if (!groups.has(ref)) groups.set(ref, []);
          groups.get(ref).push(remapKeys(clone(item.app), actionMap, recipeMap));
        }
        for (const [ref, apps] of groups) {
          const target = map.get(ref);
          if (!target) continue;
          const policy = clone(target.policy || {});
          policy.microApps ||= { version: 1, apps: [] };
          policy.microApps.version = 1;
          policy.microApps.apps ||= [];
          for (const app of apps) {
            const index = policy.microApps.apps.findIndex((candidate) => candidate.key === app.key);
            if (index >= 0) {
              if (strategy === 'SKIP') continue;
              if (strategy === 'RENAME') {
                const used = new Set(policy.microApps.apps.map((candidate) => candidate.key));
                app.key = uniqueKey(app.key, used);
                policy.microApps.apps.push(app);
              } else policy.microApps.apps[index] = app;
            } else policy.microApps.apps.push(app);
          }
          await api(`/template/edit/${encodeURIComponent(instanceName())}`, {
            method: 'POST',
            body: {
              templateId: target.id || target.templateId || target.externalTemplateId || target.localId,
              policy,
              actions: target.actions || { bindings: [] },
            },
          });
          report.push(`Micro Apps: aplicados em ${ref}`);
        }
      }

      $('transferImportReport').textContent = report.join('\n') || 'Nenhuma alteração necessária.';
      setStatus('Importação concluída. Atualizando o workspace...');
      $('refreshButton')?.click();
      setTimeout(() => setStatus('Importação concluída com sucesso.'), 500);
    } finally {
      state.importing = false;
      $('transferApplyImport').disabled = !state.bundle || Boolean(validateBundle(state.bundle).errors.length);
    }
  }

  function setStatus(message) {
    const node = $('transferStatus');
    if (node) node.textContent = message;
  }

  function closeModal() {
    $('studioTransferModal')?.classList.remove('open');
    document.body.classList.remove('transfer-modal-open');
  }

  function openModal() {
    $('studioTransferModal')?.classList.add('open');
    document.body.classList.add('transfer-modal-open');
  }

  function injectUI() {
    if ($('studioTransferModal')) return;
    const button = document.createElement('button');
    button.id = 'studioTransferButton';
    button.type = 'button';
    button.className = 'button secondary transfer-launch';
    button.textContent = 'Importar / Exportar';
    const topActions = document.querySelector('.top-actions');
    topActions?.insertBefore(button, topActions.firstChild);

    const modal = document.createElement('div');
    modal.id = 'studioTransferModal';
    modal.className = 'transfer-modal';
    modal.innerHTML = `
      <div class="transfer-dialog" role="dialog" aria-modal="true" aria-labelledby="transferTitle">
        <header class="transfer-header"><div><span>PORTABILIDADE</span><h2 id="transferTitle">Importar e exportar</h2><p>Mova templates, integrações e Micro Apps sem transportar segredos.</p></div><button id="transferClose" type="button" aria-label="Fechar">×</button></header>
        <nav class="transfer-tabs"><button class="active" data-transfer-tab="export" type="button">Exportar</button><button data-transfer-tab="import" type="button">Importar</button><button data-transfer-tab="formats" type="button">Formatos</button></nav>
        <section class="transfer-panel active" data-transfer-panel="export">
          <div class="transfer-grid"><label><span>Escopo</span><select id="transferExportScope"><option value="SOLUTION">Solução atual (template + dependências)</option><option value="TEMPLATE">Template atual</option><option value="INTEGRATIONS">Integrações (Actions + Recipes)</option><option value="MICRO_APPS">Micro Apps</option><option value="WORKSPACE">Workspace completo</option></select></label><label><span>Formato</span><select id="transferExportFormat"><option value="ARGWS">ARGWS Package (.argws)</option><option value="JSON">JSON (.json)</option><option value="NDJSON">NDJSON (.ndjson)</option><option value="CSV">CSV (.csv)</option><option value="META_JSON">Meta Template JSON</option></select></label></div>
          <div class="transfer-note"><strong>Seguro por padrão.</strong> API keys, tokens, passwords, Authorization e cookies são removidos. Referências como <code>credentialRef</code> permanecem.</div>
          <div class="transfer-actions"><button id="transferExport" class="button primary" type="button">Exportar arquivo</button></div>
        </section>
        <section class="transfer-panel" data-transfer-panel="import">
          <label id="transferDrop" class="transfer-drop"><input id="transferFiles" type="file" multiple accept=".argws,.json,.ndjson,.jsonl,.csv,application/json,text/csv" /><strong>Arraste arquivos aqui ou clique para selecionar</strong><span>.argws · .json · .ndjson · .jsonl · .csv · Meta JSON</span></label>
          <div class="transfer-grid compact"><label><span>Quando já existir</span><select id="transferConflictStrategy"><option value="SKIP">Ignorar existente</option><option value="REPLACE">Substituir existente</option><option value="RENAME">Importar com novo nome/key</option></select></label><div class="transfer-inline-help">SYSTEM/default nunca é substituído ou removido pelo importador.</div></div>
          <div id="transferImportSummary" class="transfer-summary"><div class="transfer-empty">Selecione um ou mais arquivos para analisar.</div></div>
          <div class="transfer-actions"><button id="transferAnalyze" class="button secondary" type="button" disabled>Analisar arquivos</button><button id="transferApplyImport" class="button primary" type="button" disabled>Aplicar importação</button></div>
          <pre id="transferImportReport" class="transfer-report">Nenhuma importação executada.</pre>
        </section>
        <section class="transfer-panel" data-transfer-panel="formats">
          <div class="transfer-format-list">
            <article><strong>ARGWS Package</strong><span>Bundle canônico versionado para solução completa, templates, Actions, Recipes e Micro Apps.</span></article>
            <article><strong>JSON / Meta JSON</strong><span>Detecta bundle Connect|API, entidade individual e payload de template Meta.</span></article>
            <article><strong>NDJSON / JSONL</strong><span>Uma entidade por linha, útil para automação, versionamento e pipelines.</span></article>
            <article><strong>CSV</strong><span>Colunas kind, key e payload JSON; adequado para inventário e troca tabular sem perder estruturas aninhadas.</span></article>
          </div>
        </section>
        <footer class="transfer-footer"><span id="transferStatus">Pronto.</span><button id="transferDone" class="button secondary" type="button">Fechar</button></footer>
      </div>`;
    document.body.appendChild(modal);

    button.addEventListener('click', openModal);
    $('transferClose').addEventListener('click', closeModal);
    $('transferDone').addEventListener('click', closeModal);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closeModal();
    });
    modal.querySelectorAll('[data-transfer-tab]').forEach((tab) =>
      tab.addEventListener('click', () => {
        modal.querySelectorAll('[data-transfer-tab]').forEach((item) => item.classList.toggle('active', item === tab));
        modal.querySelectorAll('[data-transfer-panel]').forEach((panel) => panel.classList.toggle('active', panel.dataset.transferPanel === tab.dataset.transferTab));
      }),
    );
    $('transferExport').addEventListener('click', () => exportBundle().catch((error) => setStatus(`Erro: ${error.message}`)));
    $('transferFiles').addEventListener('change', (event) => {
      state.files = [...event.target.files];
      $('transferAnalyze').disabled = !state.files.length;
      setStatus(state.files.length ? `${state.files.length} arquivo(s) selecionado(s).` : 'Pronto.');
    });
    const drop = $('transferDrop');
    ['dragenter', 'dragover'].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.add('dragging'); }));
    ['dragleave', 'drop'].forEach((name) => drop.addEventListener(name, (event) => { event.preventDefault(); drop.classList.remove('dragging'); }));
    drop.addEventListener('drop', (event) => {
      state.files = [...event.dataTransfer.files];
      $('transferAnalyze').disabled = !state.files.length;
      setStatus(`${state.files.length} arquivo(s) recebido(s).`);
    });
    $('transferAnalyze').addEventListener('click', () => analyzeFiles(state.files).catch((error) => {
      state.bundle = null;
      $('transferApplyImport').disabled = true;
      $('transferImportSummary').innerHTML = `<div class="transfer-message error">${esc(error.message)}</div>`;
      setStatus('Falha ao analisar os arquivos.');
    }));
    $('transferApplyImport').addEventListener('click', () => importBundle().catch((error) => {
      $('transferImportReport').textContent = `ERRO\n${error.message}`;
      setStatus('Importação interrompida.');
    }));
    document.addEventListener('keydown', (event) => {
      if (event.key === 'Escape' && modal.classList.contains('open')) closeModal();
    });
  }

  injectUI();
})();
