(() => {
  const host = window.location.hostname;
  const protocol = window.location.protocol === 'http:' ? 'http:' : 'https:';

  // No domínio próprio da interface, use automaticamente o domínio irmão da API.
  // Em /manager/ no próprio domínio da API, preserve a mesma origem.
  const apiHost = host.includes('.manager.')
    ? host.replace('.manager.', '.api.')
    : host.startsWith('manager.')
      ? host.replace(/^manager\./, 'api.')
      : host;

  const detectedApiBaseUrl = `${protocol}//${apiHost}${window.location.port ? `:${window.location.port}` : ''}`;
  const explicitApiBaseUrl = String(window.__CONNECT_API_BASE_URL__ || '').trim();

  window.__CONNECT_WEB__ = Object.freeze({
    compatibility: 'current',
    apiBaseUrl: explicitApiBaseUrl || detectedApiBaseUrl,
    serviceBasePath: '/manager-api/v1',
    requestTimeoutMs: 30000,
    authMode: 'access-code',
    features: Object.freeze({
      voice: true,
      studio: true,
      // Fail closed when no API runtime configuration is available.
      conversations: false,
      contacts: false,
      messages: false,
      instanceTestMessage: true,
      testMessageContacts: false,
      users: false,
      permissions: false,
      audit: false,
      security: false,
      updates: true,
      settings: true,
    }),
  });
})();
