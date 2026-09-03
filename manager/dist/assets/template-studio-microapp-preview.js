(() => {
  'use strict';
  if (window.__ARGWS_MICROAPP_PREVIEW__) return;
  window.__ARGWS_MICROAPP_PREVIEW__ = true;

  const $ = (id) => document.getElementById(id);
  const esc = (value) =>
    String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#039;' })[char]);
  let pageIndex = 0;
  let lastSignature = '';
  let clockTimer = null;

  function parse(value, fallback = {}) {
    try {
      return JSON.parse(String(value || '').trim() || JSON.stringify(fallback));
    } catch {
      return fallback;
    }
  }

  function policy() {
    return parse($('policyJsonInput')?.value, {});
  }

  function variables() {
    return parse($('variablesInput')?.value, {});
  }

  function testNumber() {
    return String($('testNumberInput')?.value || '').replace(/\D/g, '');
  }

  function readPath(object, path) {
    return String(path || '')
      .split('.')
      .filter(Boolean)
      .reduce((current, key) => (current == null ? undefined : current[key]), object);
  }

  function previewContext() {
    const current = variables();
    const now = new Date();
    const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'America/Bahia';
    const number = current?.contact?.whatsapp || testNumber() || '5575988881111';
    return {
      ...current,
      contact: {
        ...(current.contact || {}),
        name: current?.contact?.name || 'Contato WhatsApp',
        whatsapp: number,
        remoteJid: current?.contact?.remoteJid || `${number}@s.whatsapp.net`,
      },
      system: {
        ...(current.system || {}),
        date: now.toLocaleDateString('pt-BR'),
        time: now.toLocaleTimeString('pt-BR'),
        dateTime: `${now.toLocaleDateString('pt-BR')} ${now.toLocaleTimeString('pt-BR')}`,
        timezone,
      },
      microApp: {
        ...(current.microApp || {}),
        url: current?.microApp?.url || 'https://connect-api/micro-app/preview',
      },
    };
  }

  function interpolate(value, context) {
    return String(value ?? '').replace(/{{\s*([A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*)\s*}}/g, (match, path) => {
      const resolved = readPath(context, path);
      return resolved === undefined || resolved === null || resolved === '' ? match : String(resolved);
    });
  }

  function microAppConfig() {
    const current = policy();
    const microApps = current?.microApps;
    if (!microApps || typeof microApps !== 'object') return null;
    const autoLaunch = microApps.autoLaunch;
    if (!autoLaunch || autoLaunch.enabled !== true) return null;
    const apps = Array.isArray(microApps.apps) ? microApps.apps : [];
    const app = apps.find((candidate) => String(candidate?.key || '') === String(autoLaunch.appKey || '')) || apps[0];
    if (!app) return null;
    return { autoLaunch, app };
  }

  function ensureUi() {
    const panel = document.querySelector('.preview-panel');
    if (!panel || $('microAppStudioPreview')) return;
    const root = document.createElement('section');
    root.id = 'microAppStudioPreview';
    root.className = 'microapp-studio-preview';
    root.hidden = true;
    root.innerHTML = `
      <div class="microapp-preview-heading">
        <div><span>MICRO APP PREVIEW</span><strong id="microAppPreviewTitle">Micro App</strong></div>
        <span class="microapp-preview-chip">Interativo</span>
      </div>
      <div id="microAppPreviewPages" class="microapp-preview-pages"></div>
      <div id="microAppPreviewDevice" class="microapp-preview-device"></div>
      <div class="microapp-preview-note">Prévia estrutural. GPS e submits reais só são executados ao abrir a sessão gerada.</div>`;
    panel.appendChild(root);

    const style = document.createElement('style');
    style.id = 'microAppStudioPreviewStyle';
    style.textContent = `
      .microapp-studio-preview{margin-top:14px;border:1px solid #d9e3ef;border-radius:16px;background:#fff;padding:12px;box-shadow:0 8px 24px rgba(31,55,85,.06)}
      .microapp-preview-heading{display:flex;align-items:flex-start;justify-content:space-between;gap:8px;margin-bottom:10px}.microapp-preview-heading div{display:grid;gap:2px}.microapp-preview-heading span{font-size:8px;font-weight:900;letter-spacing:.08em;color:#1f5fd6}.microapp-preview-heading strong{font-size:12px;color:#172033}.microapp-preview-chip{padding:4px 7px;border-radius:999px;background:#e9f7ef!important;color:#157347!important;letter-spacing:0!important}
      .microapp-preview-pages{display:flex;gap:5px;overflow-x:auto;padding-bottom:7px}.microapp-preview-pages button{border:1px solid #d8e1ec;background:#fff;border-radius:8px;padding:5px 7px;font-size:9px;font-weight:800;color:#667085;white-space:nowrap;cursor:pointer}.microapp-preview-pages button.active{border-color:#1f5fd6;background:#eef4ff;color:#174ea6}
      .microapp-preview-device{border:1px solid #dce4ee;background:#f7f9fc;border-radius:14px;padding:10px;min-height:190px}.microapp-preview-card{background:#fff;border:1px solid #dde5ef;border-radius:12px;padding:12px;display:grid;gap:9px}.microapp-preview-card h4{margin:0;font-size:13px}.microapp-preview-card p{margin:0;font-size:9px;line-height:1.4;color:#667085}.microapp-preview-field{display:grid;gap:4px;font-size:9px;color:#475467}.microapp-preview-field b{font-size:9px}.microapp-preview-control{border:1px solid #d4dde8;border-radius:8px;background:#fff;padding:8px;font-size:9px;color:#667085}.microapp-preview-contact{border:1px solid #d8e2ed;border-radius:9px;padding:8px;font-size:9px}.microapp-preview-clock{font-size:18px;font-weight:900;color:#172033}.microapp-preview-status{font-size:9px;color:#157347}.microapp-preview-location{border:1px dashed #b9c8d9;border-radius:9px;padding:8px;font-size:9px;color:#667085}.microapp-preview-next{border:0;border-radius:8px;background:#1f5fd6;color:#fff;padding:8px;font-weight:900;font-size:9px}.microapp-preview-note{margin-top:8px;font-size:8px;line-height:1.35;color:#8a94a5}
      #messagePreview .microapp-launch-preview{margin-top:7px;border-top:1px solid #dce4e9;padding:7px 3px 1px;text-align:center;color:#1677d2;font-size:10px;font-weight:800}
      @media(max-width:1180px){.microapp-studio-preview{margin:10px 12px}.microapp-preview-device{min-height:160px}}
    `;
    document.head.appendChild(style);
  }

  function componentHtml(component, context) {
    const type = String(component?.type || 'TEXT').toUpperCase();
    const label = interpolate(component?.label || component?.title || '', context);
    if (type === 'TEXT') return `<p>${esc(interpolate(component.text || '', context))}</p>`;
    if (type === 'CONTACT') return `<div class="microapp-preview-contact"><b>${esc(label || 'Contato')}</b><div>${esc(interpolate(component.text || '{{contact.name}} · {{contact.whatsapp}}', context))}</div></div>`;
    if (type === 'CLOCK') return `<div class="microapp-preview-field"><b>${esc(label || 'Relógio')}</b><div class="microapp-preview-clock" data-preview-clock>${esc(context.system.time)}</div><span data-preview-date>${esc(context.system.date)}</span></div>`;
    if (type === 'STATUS') return `<div class="microapp-preview-status">● Online · sincronização disponível</div>`;
    if (type === 'LOCATION') return `<div class="microapp-preview-location"><b>${esc(label || 'Localização')}</b><div>GPS será solicitado ao abrir o Mini App.</div></div>`;
    if (type === 'CHECKBOX') return `<div class="microapp-preview-control">☐ ${esc(label)}</div>`;
    if (type === 'SELECT' || type === 'LIST') {
      const first = Array.isArray(component.options) ? component.options[0] : null;
      const text = first?.label || first?.title || first?.name || 'Selecione...';
      return `<div class="microapp-preview-field"><b>${esc(label)}</b><div class="microapp-preview-control">${esc(text)} ▾</div></div>`;
    }
    if (type === 'DATE') return `<div class="microapp-preview-field"><b>${esc(label)}</b><div class="microapp-preview-control">${esc(context.system.date)}</div></div>`;
    if (type === 'TIME') return `<div class="microapp-preview-field"><b>${esc(label)}</b><div class="microapp-preview-control">${esc(context.system.time.slice(0, 5))}</div></div>`;
    if (type === 'IMAGE') return `<div class="microapp-preview-control">Imagem · ${esc(component.alt || label || '')}</div>`;
    return `<div class="microapp-preview-field"><b>${esc(label || component.id || 'Campo')}</b><div class="microapp-preview-control">${esc(component.placeholder || 'Campo de entrada')}</div></div>`;
  }

  function renderMicroAppPreview(config) {
    const root = $('microAppStudioPreview');
    if (!root) return;
    if (!config) {
      root.hidden = true;
      return;
    }
    root.hidden = false;
    const { app, autoLaunch } = config;
    const pages = Array.isArray(app.pages) ? app.pages : [];
    if (!pages.length) return;
    pageIndex = Math.min(pageIndex, pages.length - 1);
    const page = pages[pageIndex];
    const context = previewContext();
    $('microAppPreviewTitle').textContent = app.title || app.key || 'Micro App';
    $('microAppPreviewPages').innerHTML = pages
      .map((item, index) => `<button type="button" class="${index === pageIndex ? 'active' : ''}" data-microapp-page="${index}">${index + 1}. ${esc(item.title || item.key)}</button>`)
      .join('');
    $('microAppPreviewPages').querySelectorAll('[data-microapp-page]').forEach((button) =>
      button.addEventListener('click', () => {
        pageIndex = Number(button.dataset.microappPage || 0);
        refresh(true);
      }),
    );
    $('microAppPreviewDevice').innerHTML = `<div class="microapp-preview-card"><h4>${esc(interpolate(page.title || app.title || 'Micro App', context))}</h4>${page.description ? `<p>${esc(interpolate(page.description, context))}</p>` : ''}${(page.components || []).map((component) => componentHtml(component, context)).join('')}<button class="microapp-preview-next" type="button">${pageIndex === pages.length - 1 ? 'Concluir' : 'Continuar'}</button></div>`;

    const messagePreview = $('messagePreview');
    if (messagePreview && !messagePreview.querySelector('.microapp-launch-preview')) {
      const launch = document.createElement('div');
      launch.className = 'microapp-launch-preview';
      launch.textContent = autoLaunch.buttonText || 'Abrir Mini App';
      messagePreview.appendChild(launch);
    }
    updateClock();
  }

  function updateClock() {
    const now = new Date();
    document.querySelectorAll('[data-preview-clock]').forEach((node) => (node.textContent = now.toLocaleTimeString('pt-BR')));
    document.querySelectorAll('[data-preview-date]').forEach((node) => (node.textContent = now.toLocaleDateString('pt-BR')));
  }

  function refresh(force = false) {
    ensureUi();
    const config = microAppConfig();
    const signature = JSON.stringify({ policy: policy(), variables: variables(), number: testNumber(), pageIndex });
    if (!force && signature === lastSignature) {
      const message = $('messagePreview');
      if (config && message && !message.querySelector('.microapp-launch-preview')) renderMicroAppPreview(config);
      return;
    }
    lastSignature = signature;
    renderMicroAppPreview(config);
  }

  function boot() {
    ensureUi();
    ['policyJsonInput', 'variablesInput', 'testNumberInput', 'nameInput'].forEach((id) => {
      $(id)?.addEventListener('input', () => setTimeout(() => refresh(true), 0));
      $(id)?.addEventListener('change', () => setTimeout(() => refresh(true), 0));
    });
    $('templateList')?.addEventListener('click', () => setTimeout(() => { pageIndex = 0; refresh(true); }, 80));
    document.addEventListener('click', (event) => {
      if (event.target?.matches?.('.tab,[data-tab]')) setTimeout(() => refresh(true), 40);
    });
    setInterval(refresh, 350);
    clockTimer = setInterval(updateClock, 1000);
    refresh(true);
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();