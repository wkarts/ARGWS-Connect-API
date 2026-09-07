import { badge, button, el } from '../core/dom.js';
import { link, navigate } from '../core/router.js';
import { runtimeConfig } from '../core/runtime-config.js';
import { clearSession, getLocale, getTheme, loadSession, setLocale, setTheme } from '../core/session.js';

export function header(instance) {
  const session = loadSession();
  const theme = getTheme();
  const container = el('header', { class: 'topbar' });
  const brand = el(
    'a',
    { class: 'brand', href: '/manager/', dataset: { nav: '1' } },
    el('img', {
      src:
        theme === 'dark'
          ? '/assets/images/argws-connect-logo-dark.svg'
          : '/assets/images/argws-connect-logo-horizontal.svg',
      alt: 'Connect|API',
    }),
  );
  container.append(
    brand,
    el(
      'div',
      { class: 'topbar-meta' },
      instance ? el('span', { class: 'instance-pill', text: instance.name }) : null,
      el('span', { class: 'version-pill', text: `v${session?.version || '—'}` }),
    ),
    el('div', { class: 'topbar-spacer' }),
  );
  const actions = el('div', { class: 'topbar-actions' });
  if (runtimeConfig.locale.extraLocalesEnabled && runtimeConfig.locale.enabledLocales.length > 1) {
    const current = getLocale() || runtimeConfig.locale.defaultLocale;
    const selector = el('select', { class: 'input compact' });
    runtimeConfig.locale.enabledLocales.forEach((locale) =>
      selector.append(el('option', { value: locale, text: locale, selected: locale === current })),
    );
    selector.onchange = () => {
      setLocale(selector.value);
      location.reload();
    };
    actions.append(selector);
  }
  actions.append(
    button(theme === 'dark' ? '☀' : '☾', {
      class: 'icon-btn',
      onclick: () => {
        setTheme(theme === 'dark' ? 'light' : 'dark');
        location.reload();
      },
    }),
    button('↪', {
      class: 'icon-btn danger',
      onclick: () => {
        clearSession();
        navigate('/manager/login');
      },
    }),
  );
  container.append(actions);
  return container;
}

function navigationGroups(instance) {
  const principal = [
    ['Visão geral', 'dashboard', '◫'],
    ['Chat', 'chat', '◉'],
  ];
  if (instance.integration === 'WHATSAPP-ZAPO') {
    principal.push(['Chamadas WhatsApp', 'calls', '☎'], ['VoIP', 'voip', '◍']);
  }
  return [
    ['Principal', principal],
    ['Configurações', [['Comportamento', 'settings', '⚙'], ['Proxy', 'proxy', '⇄']]],
    ['Eventos', [['Webhook', 'webhook', '⌁'], ['WebSocket', 'websocket', '◌'], ['RabbitMQ', 'rabbitmq', '▤'], ['SQS', 'sqs', '▦']]],
    ['Integrações', [['Chatwoot', 'chatwoot', '⌘'], ['Typebot', 'typebot', '◆'], ['OpenAI', 'openai', '◆'], ['Dify', 'dify', '◆'], ['n8n', 'n8n', '◆'], ['ConnectAI', 'connectAI', '◆'], ['ConnectBot', 'connectBot', '◆'], ['Flowise', 'flowise', '◆']]],
  ];
}

export function sidebar(instance, active) {
  const session = loadSession();
  const aside = el('aside', { class: 'sidebar' });
  navigationGroups(instance).forEach(([title, items]) => {
    const section = el('section', {}, el('h4', { text: title }));
    items.forEach(([label, path, icon]) => {
      const a = link(
        '',
        `/manager/instance/${instance.id || instance.instanceId}/${path}`,
        `nav-item ${active === path ? 'active' : ''}`,
      );
      a.append(el('span', { class: 'nav-icon', text: icon }), el('span', { text: label }));
      section.append(a);
    });
    aside.append(section);
  });
  const docs = runtimeConfig.documentationUrl || session?.documentationUrl;
  if (docs) {
    aside.append(
      el(
        'a',
        { class: 'nav-item docs-link', href: docs, target: '_blank', rel: 'noreferrer' },
        el('span', { text: '↗' }),
        el('span', { text: 'Documentação' }),
      ),
    );
  }
  return aside;
}

export function pageHeader(title, description, actions = []) {
  return el(
    'div',
    { class: 'page-header' },
    el('div', {}, el('h1', { text: title }), el('p', { text: description || '' })),
    el('div', { class: 'actions' }, ...actions),
  );
}
export function managerShell(content) {
  return el('div', { class: 'app' }, header(), el('main', { class: 'manager-main' }, content));
}
export function instanceShell(instance, active, content) {
  return el(
    'div',
    { class: 'app' },
    header(instance),
    el('div', { class: 'instance-layout' }, sidebar(instance, active), el('main', { class: 'instance-main' }, content)),
  );
}
export function instanceStatus(instance) {
  return badge(instance.connectionStatus);
}
