(() => {
  'use strict';
  if (window.__ARGWS_TEMPLATE_EDITOR_LAUNCHER__) return;
  window.__ARGWS_TEMPLATE_EDITOR_LAUNCHER__ = true;

  const style = document.createElement('style');
  style.textContent = `
    #argws-template-studio-launcher {
      position: fixed; right: 18px; bottom: 18px; z-index: 99990;
      border: 1px solid rgba(31,95,214,.28); border-radius: 999px;
      background: #1f5fd6; color: #fff; padding: 10px 14px;
      box-shadow: 0 10px 28px rgba(31,95,214,.24);
      font: 700 12px/1.2 Inter, ui-sans-serif, system-ui, sans-serif;
      cursor: pointer; display: none;
    }
    #argws-template-studio-launcher:hover { background: #174ab0; }
  `;
  document.head.appendChild(style);

  const button = document.createElement('button');
  button.id = 'argws-template-studio-launcher';
  button.type = 'button';
  button.textContent = 'Templates';
  button.title = 'Abrir Connect|API Template Studio';
  document.body.appendChild(button);

  const routeState = () => {
    const match = window.location.pathname.match(/\/manager\/instance\/([^/]+)/i);
    return { instanceId: match ? decodeURIComponent(match[1]) : '' };
  };

  const hasSession = () => {
    if (/\/manager\/instance\//i.test(window.location.pathname)) return true;
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i);
      const value = key ? localStorage.getItem(key) : '';
      if (key && /(api.?key|token)/i.test(key) && value && value.length >= 8) return true;
    }
    return false;
  };

  const sync = () => { button.style.display = hasSession() ? 'block' : 'none'; };
  button.addEventListener('click', () => {
    const { instanceId } = routeState();
    const params = new URLSearchParams();
    if (instanceId) params.set('instanceId', instanceId);
    const target = `/template-editor.html${params.toString() ? `?${params}` : ''}`;
    window.location.assign(target);
  });

  sync();
  const observer = new MutationObserver(sync);
  observer.observe(document.documentElement, { subtree: true, childList: true });
  window.addEventListener('popstate', sync);
  window.setInterval(sync, 2000);
})();
