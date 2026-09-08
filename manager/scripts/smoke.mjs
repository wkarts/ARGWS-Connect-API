import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const session = { apiUrl: 'https://api.example.test', apiKey: 'MASTER' };
const instance = { id: 'id-1', name: 'demo', token: 'INSTANCE', number: '5575999999999' };
const calls = [];

const replyFor = (pathname) => {
  if (pathname === '/') return { version: '1.0.21', clientName: 'Connect|API', documentation: 'https://docs.example.test' };
  if (pathname === '/verify-creds') return { status: 200 };
  if (pathname === '/instance/fetchInstances') return [instance];
  if (pathname.startsWith('/chat/findChats/')) return [];
  if (pathname.startsWith('/chat/findMessages/')) return { messages: { records: [] } };
  if (pathname.includes('/fetchSettings/')) return {};
  if (pathname.includes('/fetchSessions/')) return [];
  if (pathname.includes('/find/')) return [];
  if (pathname.startsWith('/openai/creds/')) return [];
  return { ok: true, id: 'mock-id' };
};

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(String(input));
  const method = String(options.method || 'GET').toUpperCase();
  calls.push({ url, method, headers: options.headers || {}, body: options.body });
  return new Response(JSON.stringify(replyFor(url.pathname)), {
    status: method === 'POST' && url.pathname === '/instance/create' ? 201 : 200,
    headers: { 'content-type': 'application/json' },
  });
};

const assert = (condition, message) => { if (!condition) throw new Error(message); };
const last = () => calls.at(-1);
const expect = (method, pathname, token = 'INSTANCE') => {
  const call = last();
  assert(call.method === method, `Expected ${method}, got ${call.method} for ${pathname}`);
  assert(call.url.pathname === pathname, `Expected ${pathname}, got ${call.url.pathname}`);
  const headerToken = call.headers.apikey ?? call.headers.apiKey;
  if (token) assert(headerToken === token, `Expected apikey ${token} on ${pathname}, got ${headerToken}`);
};

const client = await import('../src/api/client.js');
const instances = await import('../src/api/instances.js');
const chat = await import('../src/api/chat.js');
const configuration = await import('../src/api/configuration.js');
const integrations = await import('../src/api/integrations.js');

await client.fetchRoot(session.apiUrl); expect('GET', '/', null);
await client.verifyCredentials(session.apiUrl, session.apiKey); expect('POST', '/verify-creds', 'MASTER');
await instances.fetchInstances(session); expect('GET', '/instance/fetchInstances', 'MASTER');
await instances.createInstance(session, { instanceName: 'new' }); expect('POST', '/instance/create', 'MASTER');
await instances.connectInstance(session, instance, true); expect('GET', '/instance/connect/demo'); assert(last().url.searchParams.get('number') === instance.number, 'Pairing number query missing');
await instances.restartInstance(session, instance); expect('POST', '/instance/restart/demo');
await instances.logoutInstance(session, instance); expect('DELETE', '/instance/logout/demo');
await instances.deleteInstance(session, instance); expect('DELETE', '/instance/delete/demo');

await chat.findChats(session, instance); expect('POST', '/chat/findChats/demo');
await chat.findMessages(session, instance, '5511999999999@s.whatsapp.net'); expect('POST', '/chat/findMessages/demo');
await chat.sendText(session, instance, '5511999999999@s.whatsapp.net', 'Olá'); expect('POST', '/message/sendText/demo');
const blob = new Blob(['x'], { type: 'text/plain' });
Object.defineProperty(blob, 'name', { value: 'arquivo.txt' });
await chat.sendMedia(session, instance, '5511999999999@s.whatsapp.net', blob, 'legenda'); expect('POST', '/message/sendMedia/demo');

for (const kind of ['settings', 'proxy', 'chatwoot']) {
  await configuration.loadConfiguration(session, instance, kind); expect('GET', `/${kind}/find/demo`);
  await configuration.saveConfiguration(session, instance, kind, {}); expect('POST', `/${kind}/set/demo`);
}
for (const kind of ['webhook', 'websocket', 'rabbitmq', 'sqs']) {
  await configuration.loadConfiguration(session, instance, kind); expect('GET', `/${kind}/find/demo`);
  await configuration.saveConfiguration(session, instance, kind, {}); expect('POST', `/${kind}/set/demo`);
}

for (const key of ['typebot', 'dify', 'n8n', 'connectAI', 'connectBot', 'flowise', 'openai']) {
  await integrations.findIntegrations(session, instance, key); expect('GET', `/${key}/find/demo`);
  await integrations.createIntegration(session, instance, key, { enabled: true }); expect('POST', `/${key}/create/demo`);
  await integrations.updateIntegration(session, instance, key, 'bot-1', {}); expect('PUT', `/${key}/update/bot-1/demo`);
  await integrations.fetchIntegration(session, instance, key, 'bot-1'); expect('GET', `/${key}/fetch/bot-1/demo`);
  await integrations.fetchSettings(session, instance, key); expect('GET', `/${key}/fetchSettings/demo`);
  await integrations.saveSettings(session, instance, key, {}); expect('POST', `/${key}/settings/demo`);
  await integrations.fetchSessions(session, instance, key, 'bot-1'); expect('GET', `/${key}/fetchSessions/bot-1/demo`);
  await integrations.changeIntegrationStatus(session, instance, key, '5511999999999@s.whatsapp.net', 'opened'); expect('POST', `/${key}/changeStatus/demo`);
  await integrations.changeIgnoredJid(session, instance, key, '5511999999999@s.whatsapp.net', 'add'); expect('POST', `/${key}/ignoreJid/demo`);
  await integrations.deleteIntegration(session, instance, key, 'bot-1'); expect('DELETE', `/${key}/delete/bot-1/demo`);
}

await integrations.findOpenAiCredentials(session, instance); expect('GET', '/openai/creds/demo');
await integrations.createOpenAiCredential(session, instance, { name: 'x', apiKey: 'y' }); expect('POST', '/openai/creds/demo');
await integrations.deleteOpenAiCredential(session, instance, 'cred-1'); expect('DELETE', '/openai/creds/cred-1/demo');
await integrations.getOpenAiModels(session, instance, 'cred-1'); expect('GET', '/openai/getModels/demo'); assert(last().url.searchParams.get('openaiCredsId') === 'cred-1', 'OpenAI model credential param missing');

assert(integrations.definitions.n8n.fields.some((field) => field.key === 'basicAuthPass'), 'n8n must use recovered basicAuthPass field');
assert(integrations.definitions.connectAI.defaultSettings.connectAIIdFallback === '', 'ConnectAI fallback field mismatch');

const index = fs.readFileSync(path.join(root, 'dist', 'index.html'), 'utf8');
for (const asset of ['/assets/app/main.js', '/assets/app/styles/app.css', '/assets/runtime-config.js']) {
  assert(index.includes(asset), `dist/index.html missing ${asset}`);
}
for (const forbidden of ['github.com/wkarts', 'Postman', 'Discord', 'Suporte Premium', 'Support Premium']) {
  const source = fs.readFileSync(path.join(root, 'dist', 'assets', 'app', 'components', 'shell.js'), 'utf8');
  assert(!source.includes(forbidden), `Forbidden public link/label remains: ${forbidden}`);
}

console.log(`SMOKE OK: ${calls.length} API contract calls validated.`);
