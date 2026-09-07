export class EngineClient {
  constructor(baseUrl, apiKey) {
    this.baseUrl = String(baseUrl || 'http://api:8080').replace(/\/+$/, '');
    this.apiKey = String(apiKey || '');
  }

  async request(path, { method = 'GET', body, token, timeout = 20000, headers = {} } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeout);
    try {
      const response = await fetch(`${this.baseUrl}${path}`, {
        method,
        signal: controller.signal,
        headers: {
          ...(body !== undefined ? { 'content-type': 'application/json' } : {}),
          apikey: token || this.apiKey,
          ...headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const text = await response.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch { data = text; }
      if (!response.ok) {
        const error = new Error(data?.response?.message || data?.message || data?.error || response.statusText || 'Falha no Engine');
        error.status = response.status;
        error.data = data;
        throw error;
      }
      return data;
    } finally {
      clearTimeout(timer);
    }
  }

  root() { return this.request('/'); }
  health() { return this.request('/health'); }
  instances() { return this.request('/instance/fetchInstances'); }

  async instance(nameOrId) {
    const items = await this.instances();
    const list = Array.isArray(items) ? items : items ? [items] : [];
    return list.find((item) => item.id === nameOrId || item.instanceId === nameOrId || item.name === nameOrId || item.instanceName === nameOrId) || null;
  }

  async instanceRequest(ref, path, options = {}) {
    const instance = await this.instance(ref);
    if (!instance) {
      const error = new Error('Instância não encontrada.');
      error.status = 404;
      throw error;
    }
    const name = encodeURIComponent(instance.name || instance.instanceName);
    return this.request(path.replace(':instanceName', name), { ...options, token: instance.token });
  }
}
