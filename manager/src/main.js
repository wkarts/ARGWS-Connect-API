import { alertBox, clear, el, spinner } from './core/dom.js';
import { installRouter, navigate, setRenderer } from './core/router.js';
import {
  getTheme,
  loadSelectedInstance,
  loadSession,
  saveSelectedInstance,
  setTheme,
} from './core/session.js';
import { fetchInstances } from './api/instances.js';
import { renderLogin } from './pages/login.js';
import { renderInstances } from './pages/instances.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderChat } from './pages/chat.js';
import { renderConfig } from './pages/config.js';
import { renderIntegration } from './pages/integration.js';

const root = document.getElementById('root');
setTheme(getTheme());

const configKinds = new Set([
  'settings',
  'proxy',
  'webhook',
  'websocket',
  'rabbitmq',
  'sqs',
  'chatwoot',
]);

const integrationKinds = new Set([
  'typebot',
  'openai',
  'dify',
  'n8n',
  'connectAI',
  'connectBot',
  'flowise',
]);

async function render() {
  clear(root);
  const path = location.pathname;

  if (path === '/' || path === '') {
    navigate('/manager/login', true);
    return;
  }

  if (path === '/manager/login') {
    root.append(renderLogin());
    return;
  }

  const session = loadSession();
  if (!session) {
    navigate('/manager/login', true);
    return;
  }

  if (path === '/manager' || path === '/manager/') {
    root.append(renderInstances());
    return;
  }

  if (path.startsWith('/manager/embed-chat')) {
    const selected = loadSelectedInstance();
    if (!selected) {
      navigate('/manager/', true);
      return;
    }

    const encodedJid = path.split('/').slice(3).join('/');
    root.append(
      renderChat(selected, encodedJid ? decodeURIComponent(encodedJid) : '', {
        embedded: true,
      }),
    );
    return;
  }

  const match = path.match(/^\/manager\/instance\/([^/]+)(?:\/([^/]+))?(?:\/(.+))?$/);
  if (!match) {
    navigate('/manager/', true);
    return;
  }

  const [, instanceId, section = 'dashboard', tail = ''] = match;
  root.append(el('div', { class: 'center' }, spinner()));

  try {
    const instance = (await fetchInstances(session, instanceId))[0];
    if (!instance) throw new Error('Instância não encontrada');

    saveSelectedInstance(instance);

    const reload = async () => {
      const fresh = (await fetchInstances(session, instanceId))[0];
      if (!fresh) return;
      saveSelectedInstance(fresh);
      void render();
    };

    clear(root);

    if (section === 'dashboard') {
      root.append(renderDashboard(instance, reload));
    } else if (section === 'chat') {
      root.append(renderChat(instance, tail ? decodeURIComponent(tail) : ''));
    } else if (configKinds.has(section)) {
      root.append(renderConfig(instance, section));
    } else if (integrationKinds.has(section)) {
      root.append(renderIntegration(instance, section));
    } else {
      root.append(renderDashboard(instance, reload));
    }
  } catch (error) {
    clear(root).append(alertBox(error.message || String(error)));
  }
}

setRenderer(render);
installRouter();
void render();
