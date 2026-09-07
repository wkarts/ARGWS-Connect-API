import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const zapo = read('src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts');
const callController = read('src/api/controllers/call.controller.ts');
const callRouter = read('src/api/routes/call.router.ts');
const instanceController = read('src/api/controllers/instance.controller.ts');
const baileys = read('src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts');
const packageJson = JSON.parse(read('package.json'));

assert(zapo.includes('class ZapoStartupService'), 'Native Zapo startup service is missing');
assert(zapo.includes("Integration.WHATSAPP_ZAPO"), 'Zapo provider integration identifier is missing');
assert(zapo.includes('public async offerCall'), 'Zapo voice offerCall implementation is missing');
assert(zapo.includes('public async listCalls'), 'Zapo voice listCalls implementation is missing');
assert(zapo.includes("this.client.on('voip_call_incoming'"), 'Zapo incoming-call listener is missing');
assert(zapo.includes("this.client.on('voip_call_inbound_audio'"), 'Zapo inbound audio hook is missing');
assert(zapo.includes("rawRemoteJid.endsWith('@lid')"), 'Zapo LID-to-PN canonicalization is missing');
assert(zapo.includes("this.configService.get<QrCode>('QRCODE').COLOR"), 'Zapo must use the shared QR color');
assert(zapo.includes('WHATSAPP_PROTOCOL_BROWSER_CLIENT'), 'Zapo must inherit the shared Connect|API device label');
assert(instanceController.includes('qrCodeRequests'), 'Shared QR request de-duplication is missing');
assert(instanceController.includes('pairingCodeRequests'), 'Shared pairing request de-duplication is missing');
assert(instanceController.includes("get<QrCode>('QRCODE').AUTH_TIMEOUT_MS"), 'Shared WhatsApp auth timeout is missing');
assert(baileys.includes("const pairingCodeBrowser: WABrowserDescription = ['Ubuntu', 'Chrome', '20.0.04']"), 'Stable Baileys pairing fingerprint changed unexpectedly');
assert(callController.includes("this.method(instanceName, 'offerCall')"), 'Provider-neutral call delegation is missing');
assert(callRouter.includes("this.routerPath('list')"), 'Call list route is missing');
assert(packageJson.dependencies?.['@innovatorssoft/zapo-js'] === '1.6.3', 'Zapo JS version must stay pinned at 1.6.3');
assert(packageJson.dependencies?.['@innovatorssoft/voip'] === '1.0.0', 'Zapo VoIP version must stay pinned at 1.0.0');
assert(packageJson.dependencies?.['zapo-js'] === 'npm:@innovatorssoft/zapo-js@1.6.3', 'Legacy zapo-js runtime alias is missing');

console.log('Zapo provider invariants: OK');
