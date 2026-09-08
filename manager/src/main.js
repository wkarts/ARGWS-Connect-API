import { api } from './api/manager.js';
import { clear, el, spinner } from './core/dom.js';
import { installRouter, navigate, setRenderer } from './core/router.js';
import { getAuth, getTheme, setAuth, setTheme } from './core/session.js';
import { renderLogin } from './pages/login.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderInstances } from './pages/instances.js';
import { renderInstance } from './pages/instance.js';
import { renderChannels } from './pages/channels.js';
import { renderConversations } from './pages/conversations.js';
import { renderVoice } from './pages/voice.js';
import { renderStudio } from './pages/studio.js';
import { renderIntegrations } from './pages/integrations.js';
import { renderUsers } from './pages/users.js';
import { renderSecurity } from './pages/security.js';
import { renderAudit } from './pages/audit.js';
import { renderSystem } from './pages/system.js';
import { renderLicense } from './pages/license.js';
import { renderUpdates } from './pages/updates.js';

const root = document.getElementById('root');
setTheme(getTheme());
let authChecked = false;

function requiresHttpsRedirect() {
  if (location.protocol !== 'http:') return false;
  return !['localhost', '127.0.0.1', '::1'].includes(location.hostname);
}

async function ensureAuth() {
  if (getAuth()) return true;
  if (authChecked) return false;
  authChecked = true;
  try { setAuth(await api.me()); return true; } catch { return false; }
}

async function render() {
  if (requiresHttpsRedirect()) {
    location.replace(`https://${location.host}${location.pathname}${location.search}${location.hash}`);
    return;
  }

  document.body.classList.remove('sidebar-open');
  clear(root);
  const path = location.pathname.replace(/\/+$/, '') || '/';
  if (path === '/') { navigate('/manager/', true); return; }
  if (path === '/manager/login') {
    if (await ensureAuth()) { navigate('/manager/', true); return; }
    root.append(renderLogin()); return;
  }
  root.append(el('div', { class: 'boot' }, spinner()));
  if (!await ensureAuth()) { navigate('/manager/login', true); return; }
  clear(root);
  if (getAuth()?.security?.enrollmentRequired && path !== '/manager/security') { navigate('/manager/security', true); return; }

  if (path === '/manager/' || path === '/manager') root.append(renderDashboard());
  else if (path === '/manager/instances') root.append(renderInstances());
  else {
    const match = path.match(/^\/manager\/instances\/([^/]+)$/);
    if (match) root.append(renderInstance(decodeURIComponent(match[1])));
    else if (path === '/manager/channels') root.append(renderChannels());
    else if (path === '/manager/conversations') root.append(renderConversations());
    else if (path === '/manager/voice') root.append(renderVoice());
    else if (path === '/manager/studio') root.append(renderStudio());
    else if (path === '/manager/integrations') root.append(renderIntegrations());
    else if (path === '/manager/users') root.append(renderUsers());
    else if (path === '/manager/security') root.append(renderSecurity());
    else if (path === '/manager/audit') root.append(renderAudit());
    else if (path === '/manager/system') root.append(renderSystem());
    else if (path === '/manager/license') root.append(renderLicense());
    else if (path === '/manager/updates') root.append(renderUpdates());
    else navigate('/manager/', true);
  }
}

setRenderer(render);
installRouter();
void render();
