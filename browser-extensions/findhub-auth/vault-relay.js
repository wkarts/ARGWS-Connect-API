// Authenticate this exact tab/frame/document with the worker before forwarding the native callback.
(() => {
  const origin = 'https://accounts.google.com';
  const url = new URL(location.href);
  const kdi = url.searchParams.get('kdi');
  if (window !== window.top || url.origin !== origin || !kdi || url.searchParams.getAll('kdi').length !== 1 ||
      !(url.pathname === '/encryption/unlock/android' ||
        (url.pathname.startsWith('/v3/signin/') && url.searchParams.get('flowName') === 'EncryptionUnlockAndroid'))) return;
  let nonce = null, sent = false, disposed = false;
  const closed = () => {
    if (nonce && !disposed) void chrome.runtime.sendMessage({ type: 'VAULT_CLOSED', nonce }).catch(() => {});
  };
  const bindPage = () => {
    if (nonce && !disposed) window.postMessage({ source: 'CONNECT_FINDHUB_VAULT_BIND', kdi, nonce }, origin);
  };
  const receive = event => {
    if (!disposed && event.source === window && event.origin === origin &&
        event.data?.source === 'CONNECT_FINDHUB_VAULT_READY' && event.data.kdi === kdi) { bindPage(); return; }
    if (disposed || !nonce || event.source !== window || event.origin !== origin ||
        event.data?.source !== 'CONNECT_FINDHUB_VAULT' || event.data.nonce !== nonce || event.data.kdi !== kdi) return;
    if (event.data.type === 'CLOSED') { closed(); return; }
    if (event.data.type !== 'KEYS' || sent || typeof event.data.vaultKeys !== 'string' || event.data.vaultKeys.length > 65536) return;
    sent = true;
    void chrome.runtime.sendMessage({ type: 'VAULT_KEYS', nonce, vaultKeys: event.data.vaultKeys }).catch(() => {});
  };
  window.addEventListener('message', receive);
  const hashChanged = () => { if (location.hash === '#close') closed(); };
  window.addEventListener('hashchange', hashChanged);
  window.addEventListener('pagehide', () => {
    disposed = true; nonce = null; window.removeEventListener('message', receive);
    window.removeEventListener('hashchange', hashChanged);
  }, { once: true });
  chrome.runtime.sendMessage({ type: 'VAULT_BIND' }).then(reply => {
    if (disposed || !reply?.ok || reply.kdi !== kdi || typeof reply.nonce !== 'string') return;
    nonce = reply.nonce;
    bindPage();
    hashChanged();
  }).catch(() => { /* Closed or unowned documents must not send any data. */ });
})();
