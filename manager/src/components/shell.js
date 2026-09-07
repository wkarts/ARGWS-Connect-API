import { api } from '../api/manager.js';
import { button, el } from '../core/dom.js';
import { navigate } from '../core/router.js';
import { clearAuth, getAuth, getTheme, hasPermission, setTheme } from '../core/session.js';

const groups = [
  ['Principal', [['Visão Geral', '/manager/', '⌂', 'dashboard.read']]],
  ['Comunicação', [
    ['Instâncias', '/manager/instances', '◉', 'instances.read'],
    ['Canais', '/manager/channels', '⌁', 'instances.read'],
    ['Conversas', '/manager/conversations', '◌', 'messages.read'],
  ]],
  ['Voz', [['Chamadas & VoIP', '/manager/voice', '☎', 'pbx.read']]],
  ['Studio', [
    ['Automações', '/manager/studio', '◇', 'studio.read'],
    ['Integrações', '/manager/integrations', '⌘', 'integrations.read'],
  ]],
  ['Administração', [
    ['Segurança da conta', '/manager/security', '◆', null],
    ['Usuários e Acessos', '/manager/users', '♙', 'users.read'],
    ['Auditoria', '/manager/audit', '☷', 'audit.read'],
  ]],
  ['Sistema', [
    ['Saúde', '/manager/system', '◎', 'dashboard.read'],
    ['Licença', '/manager/license', '◇', 'dashboard.read'],
    ['Atualizações', '/manager/updates', '↻', 'dashboard.read'],
  ]],
];

function activeFor(path, href) {
  if (href === '/manager/') return path === '/manager/' || path === '/manager';
  return path === href || path.startsWith(`${href}/`);
}

export function appShell(content, options = {}) {
  const auth = getAuth();
  const path = location.pathname;
  const app = el('div', { class: 'app-shell' });
  const sidebar = el('aside', { class: 'sidebar', id: 'app-sidebar' });
  const brand = el('a', { class: 'brand', href: '/manager/', dataset: { nav: '1' } }, el('img', { src: getTheme() === 'dark' ? '/manager/assets/images/argws-connect-logo-dark.svg' : '/manager/assets/images/argws-connect-logo-horizontal.svg', alt: 'Connect|API' }));
  sidebar.append(brand, el('nav', { class: 'nav' }));
  const nav = sidebar.querySelector('.nav');
  groups.forEach(([title, items]) => {
    const visible = items.filter(([, , , permission]) => !permission || hasPermission(permission));
    if (!visible.length) return;
    const group = el('section', { class: 'nav-group' }, el('h4', { text: title }));
    visible.forEach(([label, href, icon]) => group.append(el('a', { class: `nav-item ${activeFor(path, href) ? 'active' : ''}`, href, dataset: { nav: '1' } }, el('span', { class: 'nav-icon', text: icon }), el('span', { text: label }))));
    nav.append(group);
  });

  const topbar = el('header', { class: 'topbar' });
  const menuButton = button('☰', { class: 'icon-btn mobile-menu', onclick: () => document.body.classList.toggle('sidebar-open') });
  const title = el('div', { class: 'topbar-title' }, el('strong', { text: options.title || 'Connect|API' }), options.subtitle ? el('span', { text: options.subtitle }) : null);
  const themeButton = button(getTheme() === 'dark' ? '☀' : '☾', { class: 'icon-btn ghost', onclick: () => { setTheme(getTheme() === 'dark' ? 'light' : 'dark'); location.reload(); } });
  const profile = el('div', { class: 'profile-menu' }, el('div', { class: 'avatar', text: (auth?.user?.name || auth?.user?.email || 'U')[0]?.toUpperCase() || 'U' }), el('div', { class: 'profile-copy' }, el('strong', { text: auth?.user?.name || 'Usuário' }), el('span', { text: auth?.user?.email || '' })), button('Sair', { class: 'ghost compact', onclick: async () => { await api.logout().catch(() => null); clearAuth(); navigate('/manager/login'); } }));
  topbar.append(menuButton, title, el('div', { class: 'topbar-spacer' }), el('span', { class: 'system-pill' }, el('span', { class: 'status-dot' }), 'Administração local'), themeButton, profile);

  const main = el('main', { class: 'main' }, content);
  const overlay = el('div', { class: 'sidebar-overlay', onclick: () => document.body.classList.remove('sidebar-open') });
  app.append(sidebar, el('div', { class: 'workspace' }, topbar, main), overlay);
  return app;
}

export function pageHeader(title, description, actions = []) {
  return el('div', { class: 'page-header' }, el('div', {}, el('h1', { text: title }), description ? el('p', { text: description }) : null), el('div', { class: 'actions' }, ...actions));
}

export function sectionHeader(title, description = '') {
  return el('div', { class: 'section-header' }, el('div', {}, el('h2', { text: title }), description ? el('p', { text: description }) : null));
}
