// Session-scoped document_start native callback, installed only for the exact unlock kdi.
// Never reads forms, inputs, cookies, passwords or PINs. No network calls or persistent storage.
(() => {
  const origin = 'https://accounts.google.com';
  const url = new URL(location.href);
  const kdi = url.searchParams.get('kdi');
  if (window !== window.top || url.origin !== origin || !kdi || url.searchParams.getAll('kdi').length !== 1 ||
      !(url.pathname === '/encryption/unlock/android' ||
        (url.pathname.startsWith('/v3/signin/') && url.searchParams.get('flowName') === 'EncryptionUnlockAndroid'))) return;
  let nonce = null, pending = null, closed = false, disposed = false;
  const previous = Object.getOwnPropertyDescriptor(window, 'mm');
  // Do not replace an existing native interface supplied by the browser/platform.
  if (previous && (previous.configurable === false || window.mm != null)) return;
  const post = (type, extra = {}) => {
    if (nonce && !disposed) window.postMessage({ source: 'CONNECT_FINDHUB_VAULT', nonce, kdi, type, ...extra }, origin);
  };
  const flush = () => {
    if (!nonce || disposed) return;
    if (pending) { const value = pending; pending = null; post('KEYS', { vaultKeys: value }); }
    if (closed) post('CLOSED');
  };
  const native = {
    setVaultSharedKeys: (_account, value) => {
      if (disposed || pending) return;
      try {
        if (typeof value === 'string' && value.length > 65536) return;
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        if (!Array.isArray(parsed?.finder_hw) || !parsed.finder_hw.length || parsed.finder_hw.length > 32) return;
        // Filter BEFORE crossing the MAIN/ISOLATED boundary. Never relay another Google security domain.
        const selected = JSON.stringify({ finder_hw: parsed.finder_hw });
        if (selected.length > 65536) return;
        pending = selected;
        flush();
      } catch { /* Malformed callback is not an authenticated account. */ }
    },
    closeView: () => { closed = true; flush(); },
  };
  const receive = event => {
    if (event.source !== window || event.origin !== origin || event.data?.source !== 'CONNECT_FINDHUB_VAULT_BIND' ||
        event.data.kdi !== kdi || typeof event.data.nonce !== 'string' || !/^[a-f0-9-]{36}$/i.test(event.data.nonce)) return;
    if (nonce && nonce !== event.data.nonce) return;
    nonce = event.data.nonce;
    // Acknowledge installation before flushing an early callback; ISOLATED may bind before MAIN exists.
    post('BOUND');
    flush();
  };
  window.addEventListener('message', receive);
  Object.defineProperty(window, 'mm', { configurable: true, writable: true, value: native });
  // MAIN and ISOLATED scripts have no cross-world execution-order guarantee.
  window.postMessage({ source: 'CONNECT_FINDHUB_VAULT_READY', kdi }, origin);
  window.addEventListener('pagehide', () => {
    disposed = true; pending = null; nonce = null; window.removeEventListener('message', receive);
    if (window.mm === native) {
      if (previous) Object.defineProperty(window, 'mm', previous);
      else delete window.mm;
    }
  }, { once: true });
})();
