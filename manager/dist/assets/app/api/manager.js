export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

let csrfToken = '';

function messageFrom(data, fallback) {
  const value = data?.message ?? data?.response?.message ?? data?.error ?? fallback;
  return Array.isArray(value) ? value.join(', ') : String(value || fallback || 'Falha na comunicação com a Manager.');
}

async function raw(path, { method = 'GET', data, params, timeout = 30000, headers = {} } = {}) {
  const url = new URL(path, location.origin);
  if (params) Object.entries(params).forEach(([key, value]) => value != null && url.searchParams.set(key, String(value)));
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(url, {
      method,
      credentials: 'same-origin',
      signal: controller.signal,
      headers: {
        ...(data !== undefined ? { 'content-type': 'application/json' } : {}),
        ...(csrfToken && !['GET', 'HEAD'].includes(method) ? { 'x-csrf-token': csrfToken } : {}),
        ...headers,
      },
      body: data !== undefined ? JSON.stringify(data) : undefined,
    });
    const text = await response.text();
    let payload = null;
    try { payload = text ? JSON.parse(text) : null; } catch { payload = text; }
    if (!response.ok) throw new ApiError(messageFrom(payload, response.statusText), response.status, payload);
    return payload;
  } finally {
    clearTimeout(timer);
  }
}

export const api = {
  status: () => raw('/manager-api/v1/status'),
  setup: (data, setupToken) => raw('/manager-api/v1/setup', { method: 'POST', data, headers: { 'x-setup-token': setupToken } }),
  async login(email, password) {
    const data = await raw('/manager-api/v1/auth/login', { method: 'POST', data: { email, password } });
    csrfToken = data?.csrf || '';
    return data;
  },
  async verifyTwoFactor(code = '', recoveryCode = '') {
    const data = await raw('/manager-api/v1/auth/2fa/verify', { method: 'POST', data: recoveryCode ? { recoveryCode } : { code } });
    csrfToken = data?.csrf || '';
    return data;
  },
  async me() {
    const data = await raw('/manager-api/v1/auth/me');
    csrfToken = data?.csrf || '';
    return data;
  },
  async logout() {
    try { return await raw('/manager-api/v1/auth/logout', { method: 'POST' }); }
    finally { csrfToken = ''; }
  },
  security: () => raw('/manager-api/v1/auth/security'),
  setupTwoFactor: (password) => raw('/manager-api/v1/auth/2fa/setup', { method: 'POST', data: { password } }),
  async confirmTwoFactor(code) {
    const data = await raw('/manager-api/v1/auth/2fa/confirm', { method: 'POST', data: { code } });
    csrfToken = data?.csrf || csrfToken;
    return data;
  },
  regenerateRecoveryCodes: (password) => raw('/manager-api/v1/auth/2fa/recovery/regenerate', { method: 'POST', data: { password } }),
  disableTwoFactor: (password) => raw('/manager-api/v1/auth/2fa', { method: 'DELETE', data: { password } }),
  changePassword: (currentPassword, newPassword) => raw('/manager-api/v1/auth/password/change', { method: 'POST', data: { currentPassword, newPassword } }),
  dashboard: () => raw('/manager-api/v1/dashboard'),
  instances: () => raw('/manager-api/v1/instances'),
  instance: (ref) => raw(`/manager-api/v1/instances/${encodeURIComponent(ref)}`),
  createInstance: (data) => raw('/manager-api/v1/instances', { method: 'POST', data }),
  restartInstance: (ref) => raw(`/manager-api/v1/instances/${encodeURIComponent(ref)}/restart`, { method: 'POST' }),
  logoutInstance: (ref) => raw(`/manager-api/v1/instances/${encodeURIComponent(ref)}/logout`, { method: 'POST' }),
  connectInstance: (ref, data = {}) => raw(`/manager-api/v1/instances/${encodeURIComponent(ref)}/connect`, { method: 'POST', data }),
  deleteInstance: (ref) => raw(`/manager-api/v1/instances/${encodeURIComponent(ref)}`, { method: 'DELETE' }),
  chats: (ref) => raw(`/manager-api/v1/instances/${encodeURIComponent(ref)}/chats`),
  messages: (ref, remoteJid = '') => raw(`/manager-api/v1/instances/${encodeURIComponent(ref)}/messages`, { params: remoteJid ? { remoteJid } : undefined }),
  sendText: (ref, number, text) => raw(`/manager-api/v1/instances/${encodeURIComponent(ref)}/messages/text`, { method: 'POST', data: { number, text } }),
  calls: (ref) => raw(`/manager-api/v1/instances/${encodeURIComponent(ref)}/calls`),
  callAction: (ref, action, data = {}) => raw(`/manager-api/v1/instances/${encodeURIComponent(ref)}/calls/${encodeURIComponent(action)}`, { method: 'POST', data }),
  config: (ref, kind) => raw(`/manager-api/v1/instances/${encodeURIComponent(ref)}/config/${encodeURIComponent(kind)}`),
  saveConfig: (ref, kind, data) => raw(`/manager-api/v1/instances/${encodeURIComponent(ref)}/config/${encodeURIComponent(kind)}`, { method: 'PUT', data }),
  integrations: (ref, kind) => raw(`/manager-api/v1/instances/${encodeURIComponent(ref)}/integrations/${encodeURIComponent(kind)}`),
  createIntegration: (ref, kind, data) => raw(`/manager-api/v1/instances/${encodeURIComponent(ref)}/integrations/${encodeURIComponent(kind)}`, { method: 'POST', data }),
  updateIntegration: (ref, kind, id, data) => raw(`/manager-api/v1/instances/${encodeURIComponent(ref)}/integrations/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { method: 'PUT', data }),
  deleteIntegration: (ref, kind, id) => raw(`/manager-api/v1/instances/${encodeURIComponent(ref)}/integrations/${encodeURIComponent(kind)}/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  users: () => raw('/manager-api/v1/users'),
  roles: () => raw('/manager-api/v1/roles'),
  createUser: (data) => raw('/manager-api/v1/users', { method: 'POST', data }),
  updateUser: (id, data) => raw(`/manager-api/v1/users/${encodeURIComponent(id)}`, { method: 'PUT', data }),
  deleteUser: (id) => raw(`/manager-api/v1/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  resetUserTwoFactor: (id) => raw(`/manager-api/v1/users/${encodeURIComponent(id)}/2fa/reset`, { method: 'POST' }),
  audit: (limit = 200) => raw('/manager-api/v1/audit', { params: { limit } }),
  health: () => raw('/manager-api/v1/system/health'),
  license: () => raw('/manager-api/v1/license'),
  updates: () => raw('/manager-api/v1/updates'),
  telemetryHeartbeat: () => raw('/manager-api/v1/telemetry/heartbeat', { method: 'POST' }),
};
