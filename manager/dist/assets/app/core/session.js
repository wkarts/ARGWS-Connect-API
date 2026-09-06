const KEYS = {
  apiUrl: 'apiUrl', token: 'token', version: 'version', clientName: 'clientName', documentationUrl: 'documentationUrl',
  instanceId: 'instanceId', instanceName: 'instanceName', instanceToken: 'instanceToken', locale: 'managerLocale', theme: 'managerTheme'
};
export const normalizeUrl = (value) => String(value || '').trim().replace(/\/+$/, '');
export function loadSession() {
  const apiUrl = localStorage.getItem(KEYS.apiUrl) || '';
  const apiKey = localStorage.getItem(KEYS.token) || '';
  if (!apiUrl || !apiKey) return null;
  return { apiUrl, apiKey, version: localStorage.getItem(KEYS.version) || '', clientName: localStorage.getItem(KEYS.clientName) || '', documentationUrl: localStorage.getItem(KEYS.documentationUrl) || '' };
}
export function saveSession(session) {
  localStorage.setItem(KEYS.apiUrl, normalizeUrl(session.apiUrl));
  localStorage.setItem(KEYS.token, session.apiKey);
  if (session.version) localStorage.setItem(KEYS.version, session.version);
  if (session.clientName) localStorage.setItem(KEYS.clientName, session.clientName);
  session.documentationUrl ? localStorage.setItem(KEYS.documentationUrl, session.documentationUrl) : localStorage.removeItem(KEYS.documentationUrl);
}
export function clearSession() { Object.values(KEYS).slice(0, 8).forEach((key) => localStorage.removeItem(key)); }
export function saveSelectedInstance(instance) {
  localStorage.setItem(KEYS.instanceId, instance.id || ''); localStorage.setItem(KEYS.instanceName, instance.name || ''); localStorage.setItem(KEYS.instanceToken, instance.token || '');
}
export function loadSelectedInstance() {
  const id = localStorage.getItem(KEYS.instanceId) || '';
  const name = localStorage.getItem(KEYS.instanceName) || '';
  const token = localStorage.getItem(KEYS.instanceToken) || '';
  return id || name ? { id, instanceId: id, name, instanceName: name, token } : null;
}
export function getTheme() { return localStorage.getItem(KEYS.theme) === 'dark' ? 'dark' : 'light'; }
export function setTheme(theme) { localStorage.setItem(KEYS.theme, theme); document.documentElement.dataset.theme = theme; }
export function getLocale() { return localStorage.getItem(KEYS.locale) || ''; }
export function setLocale(locale) { localStorage.setItem(KEYS.locale, locale); }
