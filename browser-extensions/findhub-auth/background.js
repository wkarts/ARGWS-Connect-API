import { VERSION, GOOGLE_ORIGIN, GOOGLE_PERMISSION, safeOrigin, beginRequest, unlockUrl, safeVault, vaultPageUrl, vaultScriptMatches } from './policy.js';

// Session secrets exist only in this worker and the originating authenticated page.
// A worker restart aborts the attempt rather than persisting credentials.
let active = null;
const VAULT_SCRIPT_PREFIX = 'connect-findhub-vault-';
// No registrations survive an abandoned worker/session. No credentials are persisted.
const registrationsReady = chrome.scripting.getRegisteredContentScripts().then(scripts => {
  const ids = scripts.filter(script => script.id.startsWith(VAULT_SCRIPT_PREFIX)).map(script => script.id);
  return ids.length ? chrome.scripting.unregisterContentScripts({ ids }) : undefined;
});
function removeVaultScripts(attempt) {
  const ids = attempt.vaultScriptIds;
  if (ids?.length) void chrome.scripting.unregisterContentScripts({ ids }).catch(() => {});
}
function armVaultBridgeDeadline(attempt) {
  clearTimeout(attempt.bridgeTimer);
  attempt.bridgeTimer = setTimeout(() => {
    if (active === attempt && attempt.stage === 'VAULT' && !attempt.vaultReady) {
      cleanup(attempt, '[FH-EXT-VAULT-BRIDGE] Não foi possível preparar o retorno seguro do desbloqueio Google. Atualize a extensão e inicie novamente.');
    }
  }, 30000);
}
function vaultClosed(attempt) {
  if (active !== attempt || attempt.stage !== 'VAULT' || attempt.closeTimer) return;
  // closeView/#close may follow the key callback in the same task. A close signal is never authentication.
  attempt.closeTimer = setTimeout(() => {
    if (active === attempt && attempt.stage === 'VAULT') {
      cleanup(attempt, '[FH-EXT-VAULT-NOKEY] O Google encerrou o desbloqueio sem entregar uma chave Find Hub válida. A conta não foi vinculada. Inicie uma nova tentativa.');
    }
  }, 2000);
}
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
  clearTimeout(attempt.closeTimer);
  clearTimeout(attempt.bridgeTimer);
  removeVaultScripts(attempt);
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

async function prepareVaultBridge(attempt, url) {
  await registrationsReady;
  if (active !== attempt) return;
  attempt.kdi = new URL(url).searchParams.get('kdi');
  attempt.vaultScriptIds = [VAULT_SCRIPT_PREFIX + attempt.nonce + '-page', VAULT_SCRIPT_PREFIX + attempt.nonce + '-relay'];
  const shared = { matches: vaultScriptMatches(url), runAt: 'document_start', allFrames: false, persistAcrossSessions: false };
  // Install BEFORE navigating: executeScript on tabs.onUpdated was too late and ignored the KLS redirect.
  await chrome.scripting.registerContentScripts([
    { ...shared, id: attempt.vaultScriptIds[0], js: ['vault-page.js'], world: 'MAIN' },
    { ...shared, id: attempt.vaultScriptIds[1], js: ['vault-relay.js'], world: 'ISOLATED' },
  ]);
  if (active !== attempt) { removeVaultScripts(attempt); return; }
  attempt.vaultReady = false;
  armVaultBridgeDeadline(attempt);
  await chrome.tabs.update(attempt.googleTab, { url, active: true });
  send(attempt, { type: 'WAITING_VAULT_KEY' });
}
chrome.tabs.onUpdated.addListener((id, change) => {
  const attempt = active;
  if (!attempt || id !== attempt.googleTab) return;
  if (attempt.stage === 'LOGIN' && change.status === 'complete') void readLoginCookie(attempt);
  if (attempt.stage === 'VAULT' && change.url && vaultPageUrl(change.url, attempt.kdi) && new URL(change.url).hash === '#close') {
    vaultClosed(attempt);
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
        await prepareVaultBridge(owned, url);
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
  const isVaultPage = sender.id === chrome.runtime.id && sender.tab?.id === attempt.googleTab && sender.frameId === 0 &&
    typeof sender.documentId === 'string' && vaultPageUrl(sender.url, attempt.kdi);
  if (message.type === 'VAULT_BIND' && isVaultPage && attempt.stage === 'VAULT') {
    if (attempt.vaultDocument !== sender.documentId) {
      attempt.vaultDocument = sender.documentId;
      attempt.vaultReady = false;
      // A redirected document must prove its own MAIN callback is installed. Binding ISOLATED alone is insufficient.
      armVaultBridgeDeadline(attempt);
    }
    reply({ ok: true, nonce: attempt.nonce, kdi: attempt.kdi });
    return false;
  }
  const isVaultDocument = isVaultPage && sender.documentId === attempt.vaultDocument && message.nonce === attempt.nonce;
  if (message.type === 'VAULT_READY' && isVaultDocument && ['VAULT', 'VERIFYING'].includes(attempt.stage)) {
    attempt.vaultReady = true;
    clearTimeout(attempt.bridgeTimer);
    reply({ ok: true });
    return false;
  }
  if (message.type === 'VAULT_RELAY_ERROR' && isVaultDocument && ['VAULT', 'VERIFYING'].includes(attempt.stage)) {
    reply({ ok: true });
    // If keys already reached the backend, a lost acknowledgement must not cancel its final verification.
    if (attempt.stage === 'VAULT') {
      cleanup(attempt, '[FH-EXT-VAULT-DELIVERY] A extensão não conseguiu entregar o retorno do desbloqueio. A conta não foi vinculada. Recarregue a extensão e inicie uma nova tentativa.');
    }
    return false;
  }
  if (message.type === 'VAULT_CLOSED' && isVaultDocument && attempt.stage === 'VAULT') {
    reply({ ok: true }); vaultClosed(attempt); return false;
  }
  if (message.type === 'VAULT_KEYS' && isVaultDocument && attempt.stage === 'VAULT') {
    try {
      const vaultKeys = safeVault(message.vaultKeys);
      attempt.stage = 'VERIFYING'; clearTimeout(attempt.closeTimer); clearTimeout(attempt.bridgeTimer);
      reply({ ok: true }); send(attempt, { type: 'VAULT_KEYS', vaultKeys });
    } catch { reply({ error: 'Resposta inválida.' }); cleanup(attempt, 'O Google não retornou uma chave Find Hub válida.'); }
    return false;
  }
  reply({ error: 'Solicitação não autorizada.' });
  return false;
});
