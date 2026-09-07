const THEME_KEY = 'connectManagerTheme';
let auth = null;
export function setAuth(value) { auth = value; }
export function getAuth() { return auth; }
export function clearAuth() { auth = null; }
export function hasPermission(permission) {
  const permissions = auth?.permissions || [];
  return permissions.includes('*') || permissions.includes(permission);
}
export function getTheme() { return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : 'light'; }
export function setTheme(theme) {
  localStorage.setItem(THEME_KEY, theme === 'dark' ? 'dark' : 'light');
  document.documentElement.dataset.theme = theme === 'dark' ? 'dark' : 'light';
}
