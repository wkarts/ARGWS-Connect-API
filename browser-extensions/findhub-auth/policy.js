// Pure validation functions shared by the worker and its tests.
export const VERSION = '0.1.6';
export const GOOGLE_ORIGIN = 'https://accounts.google.com';
export const GOOGLE_PERMISSION = GOOGLE_ORIGIN + '/*';
export function safeOrigin(value) {
  const url = new URL(value);
  const local = ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(local && url.protocol === 'http:')) || url.username || url.password) {
    throw new Error('Origem de vinculação inválida.');
  }
  return url.origin;
}
export function beginRequest(data, sender) {
  const origin = safeOrigin(sender?.url || '');
  if (sender?.id || sender?.frameId !== 0 || !Number.isInteger(sender?.tab?.id)) throw new Error('Abra a vinculação em uma aba principal.');
  if (data?.type !== 'BEGIN' || !/^[a-f0-9-]{36}$/i.test(data.sessionId || '') ||
      typeof data.email !== 'string' || data.email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(data.email)) {
    throw new Error('Solicitação de vinculação inválida.');
  }
  const apiOrigin = safeOrigin(data.apiOrigin);
  return { sessionId: data.sessionId, email: data.email, origin, apiOrigin };
}
export function unlockUrl(value) {
  const url = new URL(value);
  if (url.origin !== GOOGLE_ORIGIN || url.pathname !== '/encryption/unlock/android' ||
      url.username || url.password || !url.searchParams.get('kdi') || url.href.length > 4096 ||
      [...url.searchParams.keys()].some((key) => !['kdi', 'authuser'].includes(key))) {
    throw new Error('Endereço de desbloqueio inválido.');
  }
  return url.href;
}
export function safeVault(value) {
  if (typeof value !== 'string' || value.length > 65536) throw new Error('Resposta do cofre inválida.');
  const parsed = JSON.parse(value);
  if (!Array.isArray(parsed?.finder_hw) || !parsed.finder_hw.length || parsed.finder_hw.length > 32) throw new Error('Chave Find Hub ausente.');
  // Never export other Google vault/security domains.
  return JSON.stringify({ finder_hw: parsed.finder_hw });
}

// Google keeps kdi while redirecting the Android unlock flow to /v3/signin/challenge/kls.
// Never accept a generic login page, another session, duplicate kdi, subframe, or another origin.
export function vaultPageUrl(value, expectedKdi) {
  try {
    const url = new URL(value);
    if (url.origin !== GOOGLE_ORIGIN || url.username || url.password || url.href.length > 8192 ||
        !expectedKdi || url.searchParams.getAll('kdi').length !== 1 || url.searchParams.get('kdi') !== expectedKdi) return false;
    return url.pathname === '/encryption/unlock/android' ||
      (url.pathname.startsWith('/v3/signin/') && url.searchParams.getAll('flowName').length === 1 &&
       url.searchParams.get('flowName') === 'EncryptionUnlockAndroid');
  } catch { return false; }
}
export function vaultScriptMatches(value) {
  const url = new URL(unlockUrl(value));
  const kdi = url.searchParams.get('kdi');
  if (url.searchParams.getAll('kdi').length !== 1 || !/^[A-Za-z0-9+/_-]+={0,2}$/.test(kdi)) {
    throw new Error('Contexto de desbloqueio inválido.');
  }
  // Match patterns include the query string. Only this one-use kdi can load the document_start bridge.
  const forms = [...new Set([encodeURIComponent(kdi), kdi])];
  return forms.flatMap(encoded => [
    GOOGLE_ORIGIN + '/encryption/unlock/android?*kdi=' + encoded + '*',
    GOOGLE_ORIGIN + '/v3/signin/*?*kdi=' + encoded + '*',
  ]);
}
