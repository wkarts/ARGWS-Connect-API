const KEYS = {
  apiUrl: 'apiUrl', token: 'token', version: 'version', clientName: 'clientName', documentationUrl: 'documentationUrl',
  instanceId: 'instanceId', instanceName: 'instanceName', instanceToken: 'instanceToken', locale: 'managerLocale', theme: 'managerTheme'
};

// Credentials belong to this document lifetime, never persistent Web Storage.
// Remove values left by older Managers without changing any WhatsApp session.
let accessKey = '';
let selectedInstanceKey = '';
for (const key of [KEYS.token, KEYS.instanceToken]) {
  try { localStorage.removeItem(key); sessionStorage.removeItem(key); } catch { /* Storage can be unavailable. */ }
}

export const normalizeUrl = (value) => {
  const raw = String(value || '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    if (/^\/manager(?:\/|$)/.test(url.pathname)) url.pathname = '/';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/+$/, '');
  } catch {
    return raw.replace(/\/+$/, '');
  }
};

export function loadSession() {
  const apiUrl = localStorage.getItem(KEYS.apiUrl) || '';
  if (!apiUrl || !accessKey) return null;
  return { apiUrl, apiKey: accessKey, version: localStorage.getItem(KEYS.version) || '', clientName: localStorage.getItem(KEYS.clientName) || '', documentationUrl: localStorage.getItem(KEYS.documentationUrl) || '' };
}
export function saveSession(session) {
  accessKey = String(session.apiKey || '').trim();
  localStorage.removeItem(KEYS.token);
  localStorage.setItem(KEYS.apiUrl, normalizeUrl(session.apiUrl));
  if (session.version) localStorage.setItem(KEYS.version, session.version);
  if (session.clientName) localStorage.setItem(KEYS.clientName, session.clientName);
  session.documentationUrl ? localStorage.setItem(KEYS.documentationUrl, session.documentationUrl) : localStorage.removeItem(KEYS.documentationUrl);
}
export function clearSession() {
  accessKey = '';
  selectedInstanceKey = '';
  Object.values(KEYS).slice(0, 8).forEach((key) => localStorage.removeItem(key));
}
export function saveSelectedInstance(instance) {
  selectedInstanceKey = String(instance.token || '');
  localStorage.removeItem(KEYS.instanceToken);
  localStorage.setItem(KEYS.instanceId, instance.id || '');
  localStorage.setItem(KEYS.instanceName, instance.name || '');
}
export function loadSelectedInstance() {
  const id = localStorage.getItem(KEYS.instanceId) || '';
  const name = localStorage.getItem(KEYS.instanceName) || '';
  return id || name ? { id, instanceId: id, name, instanceName: name, token: selectedInstanceKey } : null;
}
export function getTheme() { return localStorage.getItem(KEYS.theme) === 'dark' ? 'dark' : 'light'; }
export function setTheme(theme) { localStorage.setItem(KEYS.theme, theme); document.documentElement.dataset.theme = theme; }
export function getLocale() { return localStorage.getItem(KEYS.locale) || ''; }
export function setLocale(locale) { localStorage.setItem(KEYS.locale, locale); }
