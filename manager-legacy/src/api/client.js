export class ApiError extends Error { constructor(message, status = 0, data = null) { super(message); this.name = 'ApiError'; this.status = status; this.data = data; } }
function messageFrom(data, fallback) { const value = data?.response?.message ?? data?.message ?? data?.error ?? fallback; return Array.isArray(value) ? value.join(', ') : String(value || fallback || 'Erro na comunicação com a API'); }
export async function rawRequest(url, options = {}) {
  const response = await fetch(url, options); const text = await response.text(); let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  if (!response.ok) throw new ApiError(messageFrom(data, response.statusText), response.status, data);
  return data;
}
export async function fetchRoot(apiUrl) { return rawRequest(`${apiUrl.replace(/\/$/, '')}/`, { signal: AbortSignal.timeout(15000) }); }
export async function verifyCredentials(apiUrl, apiKey) { return rawRequest(`${apiUrl.replace(/\/$/, '')}/verify-creds`, { method: 'POST', headers: { apikey: apiKey }, signal: AbortSignal.timeout(15000) }); }
export async function request(session, path, { method = 'GET', data, params, headers = {}, timeout = 30000 } = {}, instanceToken = '') {
  const url = new URL(`${session.apiUrl}${path}`); if (params) Object.entries(params).forEach(([key, value]) => value != null && url.searchParams.set(key, String(value)));
  const config = { method, headers: { apikey: instanceToken || session.apiKey, ...headers }, signal: AbortSignal.timeout(timeout) };
  if (data !== undefined) { config.body = JSON.stringify(data); config.headers['content-type'] = config.headers['content-type'] || 'application/json'; }
  return rawRequest(url.toString(), config);
}

export async function requestForm(session, path, formData, { params, timeout = 60000 } = {}, instanceToken = '') {
  const url = new URL(`${session.apiUrl}${path}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value != null) url.searchParams.set(key, String(value));
    });
  }
  return rawRequest(url.toString(), {
    method: 'POST',
    headers: { apikey: instanceToken || session.apiKey },
    body: formData,
    signal: AbortSignal.timeout(timeout),
  });
}
