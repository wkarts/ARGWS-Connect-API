import { VERSION, GOOGLE_ORIGIN, GOOGLE_PERMISSION, safeOrigin, beginRequest, unlockUrl, safeVault } from './policy.js';

// Session secrets exist only in this worker and the originating authenticated page.
// A worker restart aborts the attempt rather than persisting credentials.
let active = null;
function send(attempt, message) {
  if (active !== attempt) return;
  try { attempt.port.postMessage({ ...message, sessionId: attempt.sessionId }); } catch { cleanup(attempt); }
}
function cleanup(attempt, reason) {
  if (active !== attempt) return;
  if (reason) send(attempt, { type: 'ERROR', message: reason });
  active = null;
  chrome.cookies?.onChanged?.removeListener(cookieChanged);
  clearTimeout(attempt.timer);
  attempt.baseline = undefined;
  for (const id of [attempt.googleTab, attempt.approvalTab]) {
    if (Number.isInteger(id)) chrome.tabs.remove(id).catch(() => {});
  }
  try { attempt.port.disconnect(); } catch { /* already closed */ }
}
async function newCookie(attempt, cookie) {
  if (active !== attempt || attempt.stage !== 'LOGIN' || attempt.reading || !cookie.value || cookie.value === attempt.baseline) return;
  attempt.reading = true;
  try {
    const tab = await chrome.tabs.get(attempt.googleTab);
    if (!tab?.url) return;
    const window = await chrome.windows.get(tab.windowId);
    // Do not collect an artifact from unrelated/background Google activity.
    if (active !== attempt || !tab.active || !window.focused || new URL(tab.url).origin !== GOOGLE_ORIGIN) return;
    attempt.stage = 'EXCHANGE';
    attempt.baseline = undefined;
    send(attempt, { type: 'OAUTH_TOKEN', oauthToken: cookie.value });
  } catch { cleanup(attempt, 'A aba de autenticação foi encerrada.'); }
  finally { attempt.reading = false; }
}
async function readLoginCookie(attempt) {
  if (active !== attempt || attempt.stage !== 'LOGIN' || attempt.reading) return;
  try {
    const tab = await chrome.tabs.get(attempt.googleTab);
    if (!tab?.url) return;
    const window = await chrome.windows.get(tab.windowId);
    if (active !== attempt || !tab.active || !window.focused || new URL(tab.url).origin !== GOOGLE_ORIGIN) return;
    const cookie = await chrome.cookies.get({ url: tab.url, name: 'oauth_token' });
    if (cookie) await newCookie(attempt, cookie);
  } catch { cleanup(attempt, 'Não foi possível ler o resultado do login na aba Google autorizada.'); }
}
function cookieChanged(change) {
  const attempt = active;
  if (!attempt || change.removed || change.cookie?.name !== 'oauth_token' ||
      !['accounts.google.com', '.accounts.google.com'].includes(change.cookie.domain)) return;
  void newCookie(attempt, change.cookie);
}

async function installVaultBridge(attempt) {
  if (active !== attempt || attempt.stage !== 'VAULT') return;
  const tab = await chrome.tabs.get(attempt.googleTab);
  if (!tab.url?.startsWith(GOOGLE_ORIGIN + '/encryption/unlock/android')) return;
  const target = { tabId: attempt.googleTab, frameIds: [0] };
  // Isolated-world receiver: validates the page origin and forwards only finder_hw.
  await chrome.scripting.executeScript({ target, world: 'ISOLATED', args: [attempt.nonce], func: (nonce) => {
    if (window.__connectFindHubReceiver === nonce) return;
    window.__connectFindHubReceiver = nonce;
    window.addEventListener('message', (event) => {
      if (event.source !== window || event.origin !== 'https://accounts.google.com' ||
          event.data?.source !== 'CONNECT_FINDHUB_VAULT' || event.data.nonce !== nonce) return;
      const vaultKeys = event.data.vaultKeys;
      if (typeof vaultKeys !== 'string' || vaultKeys.length > 65536) return;
      chrome.runtime.sendMessage({ type: 'VAULT_KEYS', nonce, vaultKeys }).catch(() => {});
    });
  }});
  // The Google unlock page calls this native-interface-shaped callback after user approval.
  // No password/PIN interception, no captcha bypass, no form replacement.
  await chrome.scripting.executeScript({ target, world: 'MAIN', args: [attempt.nonce], func: (nonce) => {
    if (window.mm?.__connectFindHubNonce === nonce) return;
    const previous = window.mm;
    window.mm = {
      __connectFindHubNonce: nonce,
      setVaultSharedKeys: (_account, value) => {
        const text = typeof value === 'string' ? value : JSON.stringify(value);
        window.postMessage({ source: 'CONNECT_FINDHUB_VAULT', nonce, vaultKeys: text }, 'https://accounts.google.com');
      },
      closeView: () => {},
    };
    // Restore the native interface when the linking tab is discarded.
    window.addEventListener('pagehide', () => { window.mm = previous; }, { once: true });
  }});
}
chrome.tabs.onUpdated.addListener((id, change) => {
  const attempt = active;
  if (!attempt || id !== attempt.googleTab) return;
  if (attempt.stage === 'LOGIN' && change.status === 'complete') void readLoginCookie(attempt);
  if (attempt.stage === 'VAULT' && (change.status === 'complete' || change.status === 'loading')) {
    void installVaultBridge(attempt).catch(() => cleanup(attempt, 'O navegador não permitiu concluir o desbloqueio.'));
  }
});
chrome.tabs.onActivated?.addListener(({ tabId }) => {
  if (active?.googleTab === tabId) void readLoginCookie(active);
});
chrome.windows.onFocusChanged?.addListener(() => { if (active) void readLoginCookie(active); });
chrome.tabs.onRemoved.addListener((id) => {
  const attempt = active;
  if (attempt && (id === attempt.googleTab || id === attempt.approvalTab)) cleanup(attempt, 'Vinculação cancelada pelo usuário.');
});
chrome.runtime.onConnectExternal.addListener((port) => {
  if (port.name !== 'connect-findhub-auth-v1') { port.disconnect(); return; }
  try { safeOrigin(port.sender?.url || ''); } catch { port.disconnect(); return; }
  let owned = null;
  port.onMessage.addListener((message) => {
    void (async () => {
      if (message?.type === 'PING') { port.postMessage({ type: 'PONG', version: VERSION }); return; }
      if (message?.type === 'BEGIN') {
        if (active || owned) throw new Error('Já existe uma vinculação aberta.');
        const request = beginRequest(message, port.sender);
        const attempt = { ...request, port, stage: 'CONSENT', nonce: crypto.randomUUID(), googleTab: null, approvalTab: null };
        attempt.timer = setTimeout(() => cleanup(attempt, 'A vinculação expirou. Inicie novamente no Manager.'), 10 * 60 * 1000);
        active = owned = attempt;
        const tab = await chrome.tabs.create({ url: chrome.runtime.getURL('approve.html'), active: true });
        if (active !== attempt) { await chrome.tabs.remove(tab.id); return; }
        attempt.approvalTab = tab.id;
        send(attempt, { type: 'WAITING_CONSENT' });
        return;
      }
      if (!owned || active !== owned || message.sessionId !== owned.sessionId) throw new Error('Sessão de vinculação inválida.');
      if (message.type === 'CANCEL' || message.type === 'DONE') { cleanup(owned); return; }
      if (message.type === 'UNLOCK' && owned.stage === 'EXCHANGE') {
        const url = unlockUrl(message.unlockUrl);
        owned.stage = 'VAULT';
        await chrome.tabs.update(owned.googleTab, { url, active: true });
        send(owned, { type: 'WAITING_VAULT_KEY' });
      }
    })().catch(() => {
      if (owned) cleanup(owned, 'Não foi possível continuar a vinculação. Inicie novamente.');
      else { try { port.postMessage({ type: 'ERROR', message: 'Não foi possível abrir uma nova vinculação.' }); } finally { port.disconnect(); } }
    });
  });
  port.onDisconnect.addListener(() => { if (owned) cleanup(owned); });
});
chrome.runtime.onMessage.addListener((message, sender, reply) => {
  const attempt = active;
  if (!attempt) { reply({ error: 'Nenhuma vinculação ativa. Volte ao Manager.' }); return false; }
  const isApproval = sender.id === chrome.runtime.id && sender.url === chrome.runtime.getURL('approve.html') && sender.tab?.id === attempt.approvalTab;
  if (message.type === 'INFO' && isApproval) {
    reply({ origin: attempt.origin, apiOrigin: attempt.apiOrigin, email: attempt.email, stage: attempt.stage }); return false;
  }
  if (message.type === 'DENY' && isApproval) { reply({ ok: true }); cleanup(attempt, 'Autorização recusada.'); return false; }
  if (message.type === 'APPROVE' && isApproval && attempt.stage === 'CONSENT') {
    // Accept the command synchronously. Completion and errors use the existing session-bound port.
    // Never hold sendResponse while a fast auth failure can remove the originating approval tab.
    attempt.stage = 'STARTING_LOGIN';
    reply({ ok: true, accepted: true });
    void (async () => {
      if (!await chrome.permissions.contains({ permissions: ['cookies'], origins: [GOOGLE_PERMISSION] })) throw new Error('permission');
      if (active !== attempt) return;
      chrome.cookies.onChanged.addListener(cookieChanged);
      attempt.baseline = (await chrome.cookies.get({ url: GOOGLE_ORIGIN, name: 'oauth_token' }))?.value;
      if (active !== attempt) return;
      const tab = await chrome.tabs.create({ url: GOOGLE_ORIGIN + '/EmbeddedSetup', active: true });
      if (active !== attempt) { await chrome.tabs.remove(tab.id); throw new Error('cancelled'); }
      attempt.googleTab = tab.id;
      attempt.stage = 'LOGIN';
      send(attempt, { type: 'WAITING_USER' });
      // A fast Google response can set the cookie before tabs.create resolves. Recheck after ownership is set.
      await readLoginCookie(attempt);
    })().catch(() => { cleanup(attempt, 'Não foi possível iniciar o login Google. Verifique a permissão da extensão.'); });
    return false;
  }
  if (message.type === 'VAULT_KEYS' && sender.id === chrome.runtime.id && sender.tab?.id === attempt.googleTab && sender.frameId === 0 &&
      sender.url?.startsWith(GOOGLE_ORIGIN + '/encryption/unlock/android') && message.nonce === attempt.nonce && attempt.stage === 'VAULT') {
    try { const vaultKeys = safeVault(message.vaultKeys); attempt.stage = 'VERIFYING'; reply({ ok: true }); send(attempt, { type: 'VAULT_KEYS', vaultKeys }); }
    catch { reply({ error: 'Resposta inválida.' }); cleanup(attempt, 'O Google não retornou uma chave Find Hub válida.'); }
    return false;
  }
  reply({ error: 'Solicitação não autorizada.' });
  return false;
});
