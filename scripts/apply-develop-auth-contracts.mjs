import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const write = (path, content) => fs.writeFileSync(path, content, 'utf8');

function replaceOnce(content, from, to, label) {
  const first = content.indexOf(from);
  if (first < 0) throw new Error(`Pattern not found: ${label}`);
  if (content.indexOf(from, first + from.length) >= 0) throw new Error(`Pattern is not unique: ${label}`);
  return content.slice(0, first) + to + content.slice(first + from.length);
}

function replaceAllExact(content, from, to, label) {
  const count = content.split(from).length - 1;
  if (count === 0) throw new Error(`Pattern not found: ${label}`);
  return { content: content.split(from).join(to), count };
}

// ---------------------------------------------------------------------------
// WhatsApp/Baileys: QR uses configurable Connect|API fingerprint; pairing code
// keeps the canonical Ubuntu fingerprint proven to work with WhatsApp.
// ---------------------------------------------------------------------------
const baileysPath = 'src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts';
let baileys = read(baileysPath);

baileys = replaceOnce(
  baileys,
  '  public phoneNumber: string;\n',
  '  public phoneNumber?: string;\n',
  'phoneNumber optional type',
);

baileys = replaceOnce(
  baileys,
  '  private endSession = false;\n',
  "  private endSession = false;\n  private protocolAuthMode: 'qrcode' | 'pairing-code' = 'qrcode';\n  private suppressNextReconnect = false;\n",
  'authentication mode fields',
);

baileys = replaceOnce(
  baileys,
  "    if (connection === 'close') {\n      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;\n",
  "    if (connection === 'close') {\n      if (this.suppressNextReconnect) {\n        this.suppressNextReconnect = false;\n        return;\n      }\n\n      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;\n",
  'suppress intentional authentication-mode close',
);

baileys = replaceOnce(
  baileys,
  '        await this.connectToWhatsapp(this.phoneNumber);\n',
  '        await this.connectToWhatsapp(this.phoneNumber, this.protocolAuthMode);\n',
  'reconnect preserves authentication mode',
);

const oldCreateClientHeader = `  private async createClient(number?: string): Promise<WASocket> {\n    this.instance.authState = await this.defineAuthState();\n\n    const session = this.configService.get<ConfigSessionPhone>('CONFIG_SESSION_PHONE');\n\n    // Pairing-code authentication is validated more strictly by WhatsApp than QR pairing.\n    // Keep ARGWS branding separate from the protocol fingerprint and use a canonical\n    // browser tuple known to be accepted by the companion registration flow.\n    const browser: WABrowserDescription = ['Ubuntu', 'Chrome', '20.0.04'];\n    const browserOptions = { browser };\n    const normalizedPhoneNumber = number?.replace(/\\D/g, '') || this.phoneNumber;\n\n    if (normalizedPhoneNumber) {\n      this.phoneNumber = normalizedPhoneNumber;\n      this.logger.info('Pairing-code phone number configured');\n    }\n\n    this.logger.info(\`Session client: \${session.CLIENT}\`);\n    this.logger.info(\`WhatsApp protocol browser: \${browser.join(' / ')}\`);\n`;

const newCreateClientHeader = `  private async createClient(\n    number?: string,\n    authMode: 'qrcode' | 'pairing-code' = number ? 'pairing-code' : 'qrcode',\n  ): Promise<WASocket> {\n    this.instance.authState = await this.defineAuthState();\n\n    const session = this.configService.get<ConfigSessionPhone>('CONFIG_SESSION_PHONE');\n    const normalizedPhoneNumber = number?.replace(/\\D/g, '') || this.phoneNumber;\n\n    const qrCodeBrowser: WABrowserDescription = [\n      process.env.WHATSAPP_PROTOCOL_BROWSER_CLIENT || '🅲🅾🅽🅽🅴🅲🆃​|🅰🅿🅸',\n      process.env.WHATSAPP_PROTOCOL_BROWSER_NAME || 'Chrome',\n      process.env.WHATSAPP_PROTOCOL_BROWSER_VERSION || '20.0.04',\n    ];\n\n    // WhatsApp validates pairing-code companion registration more strictly than QR.\n    // Keep this canonical fingerprint fixed: changing Ubuntu breaks pairing even when QR works.\n    const pairingCodeBrowser: WABrowserDescription = ['Ubuntu', 'Chrome', '20.0.04'];\n\n    const browser: WABrowserDescription = authMode === 'pairing-code' ? pairingCodeBrowser : qrCodeBrowser;\n    const browserOptions = { browser };\n    this.protocolAuthMode = authMode;\n\n    if (normalizedPhoneNumber && authMode === 'pairing-code') {\n      this.phoneNumber = normalizedPhoneNumber;\n      this.logger.info('Pairing-code phone number configured');\n    }\n\n    this.logger.info(\`Session client: \${session.CLIENT}\`);\n    this.logger.info(\`WhatsApp authentication mode: \${authMode}\`);\n    this.logger.info(\`WhatsApp protocol browser: \${browser.join(' / ')}\`);\n`;

baileys = replaceOnce(baileys, oldCreateClientHeader, newCreateClientHeader, 'dual WhatsApp protocol fingerprints');

const oldConnectMethod = `  public async connectToWhatsapp(number?: string): Promise<WASocket> {\n    try {\n      this.loadChatwoot();\n      this.loadSettings();\n      this.loadWebhook();\n      this.loadProxy();\n\n      // Remontar o messageProcessor para garantir que está funcionando após reconexão\n      this.messageProcessor.mount({\n        onMessageReceive: this.messageHandle['messages.upsert'].bind(this),\n      });\n\n      return await this.createClient(number);\n    } catch (error) {\n      this.logger.error(error);\n      throw new InternalServerErrorException(error?.toString());\n    }\n  }\n\n  public async reloadConnection(): Promise<WASocket> {\n    try {\n      return await this.createClient(this.phoneNumber);\n    } catch (error) {\n      this.logger.error(error);\n      throw new InternalServerErrorException(error?.toString());\n    }\n  }\n`;

const newConnectMethod = `  private async switchAuthenticationMode(\n    mode: 'qrcode' | 'pairing-code',\n    number?: string,\n  ): Promise<WASocket> {\n    const normalizedPhoneNumber = number?.replace(/\\D/g, '');\n\n    if (mode === 'pairing-code' && !normalizedPhoneNumber) {\n      throw new BadRequestException('Pairing-code phone number is required');\n    }\n\n    if (\n      this.client &&\n      this.protocolAuthMode === mode &&\n      (mode === 'qrcode' || this.phoneNumber === normalizedPhoneNumber)\n    ) {\n      return this.client;\n    }\n\n    const previousClient = this.client;\n    if (previousClient?.ws) {\n      this.suppressNextReconnect = true;\n      previousClient.ws.close();\n      await delay(250);\n    }\n\n    this.instance.qrcode = { count: 0 };\n    this.phoneNumber = mode === 'pairing-code' ? normalizedPhoneNumber : undefined;\n\n    return await this.connectToWhatsapp(this.phoneNumber, mode);\n  }\n\n  public async preparePairingConnection(number: string): Promise<WASocket> {\n    return await this.switchAuthenticationMode('pairing-code', number);\n  }\n\n  public async prepareQrConnection(): Promise<WASocket> {\n    return await this.switchAuthenticationMode('qrcode');\n  }\n\n  public async connectToWhatsapp(\n    number?: string,\n    authMode: 'qrcode' | 'pairing-code' = number ? 'pairing-code' : 'qrcode',\n  ): Promise<WASocket> {\n    try {\n      this.loadChatwoot();\n      this.loadSettings();\n      this.loadWebhook();\n      this.loadProxy();\n\n      // Remontar o messageProcessor para garantir que está funcionando após reconexão\n      this.messageProcessor.mount({\n        onMessageReceive: this.messageHandle['messages.upsert'].bind(this),\n      });\n\n      return await this.createClient(number, authMode);\n    } catch (error) {\n      this.logger.error(error);\n      throw new InternalServerErrorException(error?.toString());\n    }\n  }\n\n  public async reloadConnection(): Promise<WASocket> {\n    try {\n      return await this.createClient(this.phoneNumber, this.protocolAuthMode);\n    } catch (error) {\n      this.logger.error(error);\n      throw new InternalServerErrorException(error?.toString());\n    }\n  }\n`;

baileys = replaceOnce(baileys, oldConnectMethod, newConnectMethod, 'authentication mode switching methods');
write(baileysPath, baileys);

// ---------------------------------------------------------------------------
// Instance controller: explicitly switch socket mode before requesting QR/pairing.
// ---------------------------------------------------------------------------
const instancePath = 'src/api/controllers/instance.controller.ts';
let instance = read(instancePath);

instance = replaceOnce(
  instance,
  `    const qrCode = await this.waitForQrCode(instance, false);\n    const pairingCode = await instance.client.requestPairingCode(number);\n`,
  `    await instance.preparePairingConnection(number);\n    const qrCode = await this.waitForQrCode(instance, false);\n    const pairingCode = await instance.client.requestPairingCode(number);\n`,
  'pairing prepares canonical socket',
);

instance = replaceOnce(
  instance,
  `          // QR and pairing-code are independent authentication modes.\n          // Never pass the phone number into the QR lifecycle because that would\n          // regenerate requestPairingCode() whenever Baileys rotates the QR.\n          instance.phoneNumber = undefined;\n          await instance.connectToWhatsapp();\n\n          getQrcode = pairingNumber\n            ? await this.requestExplicitPairingCode(instance, pairingNumber)\n            : await this.waitForQrCode(instance, false);\n`,
  `          // QR and pairing-code are independent authentication modes.\n          // QR uses the configurable Connect|API fingerprint; pairing uses Ubuntu.\n          if (pairingNumber) {\n            getQrcode = await this.requestExplicitPairingCode(instance, pairingNumber);\n          } else {\n            await instance.prepareQrConnection();\n            getQrcode = await this.waitForQrCode(instance, false);\n          }\n`,
  'create instance selects authentication mode',
);

instance = replaceOnce(
  instance,
  `      if (state == 'connecting') {\n        const pairingNumber = this.normalizePairingPhoneNumber(number);\n        if (pairingNumber) {\n          // Explicit request means a fresh code for the informed phone number.\n          // Do not reuse instance.qrCode.pairingCode from an earlier request.\n          instance.phoneNumber = undefined;\n          return await this.requestExplicitPairingCode(instance, pairingNumber);\n        }\n        return instance.qrCode;\n      }\n\n      if (state == 'close') {\n        const pairingNumber = this.normalizePairingPhoneNumber(number);\n\n        instance.phoneNumber = undefined;\n        await instance.connectToWhatsapp();\n\n        return pairingNumber\n          ? await this.requestExplicitPairingCode(instance, pairingNumber)\n          : await this.waitForQrCode(instance, false);\n      }\n`,
  `      if (state == 'connecting') {\n        const pairingNumber = this.normalizePairingPhoneNumber(number);\n        if (pairingNumber) {\n          // Explicit request means a fresh code for the informed phone number.\n          // Do not reuse instance.qrCode.pairingCode from an earlier request.\n          return await this.requestExplicitPairingCode(instance, pairingNumber);\n        }\n\n        await instance.prepareQrConnection();\n        return await this.waitForQrCode(instance, false);\n      }\n\n      if (state == 'close') {\n        const pairingNumber = this.normalizePairingPhoneNumber(number);\n\n        if (pairingNumber) {\n          return await this.requestExplicitPairingCode(instance, pairingNumber);\n        }\n\n        await instance.prepareQrConnection();\n        return await this.waitForQrCode(instance, false);\n      }\n`,
  'connect endpoint selects authentication mode',
);
write(instancePath, instance);

// ---------------------------------------------------------------------------
// Socket.IO: preserve path/events/payloads, but require BOTH network validation
// and API-key authentication. Query/header auth remains for legacy clients.
// ---------------------------------------------------------------------------
const websocketPath = 'src/api/integrations/event/websocket/websocket.controller.ts';
let websocket = read(websocketPath);
const initStart = websocket.indexOf('  public init(httpServer: Server): void {');
const initEnd = websocket.indexOf('  private set cors(', initStart);
if (initStart < 0 || initEnd < 0) throw new Error('Unable to locate WebsocketController.init');

const newSocketInit = `  private normalizeRemoteAddress(address?: string): string {\n    const raw = String(address || '').trim();\n    return raw.startsWith('::ffff:') ? raw.slice(7) : raw;\n  }\n\n  private matchesAllowedAddress(address: string, pattern: string): boolean {\n    const normalizedAddress = this.normalizeRemoteAddress(address);\n    const normalizedPattern = this.normalizeRemoteAddress(pattern);\n\n    if (!normalizedPattern) return false;\n    if (normalizedPattern === '*') return true;\n    if (normalizedPattern.endsWith('*')) {\n      return normalizedAddress.startsWith(normalizedPattern.slice(0, -1));\n    }\n\n    return normalizedAddress === normalizedPattern;\n  }\n\n  private isAllowedNetworkAddress(address?: string): boolean {\n    const websocketConfig = configService.get<Websocket>('WEBSOCKET');\n    const allowedAddresses =\n      websocketConfig.ALLOWED_IPS ||\n      websocketConfig.ALLOWED_HOSTS ||\n      '127.0.0.1,::1,::ffff:127.0.0.1,172.*,10.*,192.168.*';\n\n    return allowedAddresses\n      .split(',')\n      .map((value) => value.trim())\n      .filter(Boolean)\n      .some((pattern) => this.matchesAllowedAddress(address || '', pattern));\n  }\n\n  public init(httpServer: Server): void {\n    if (!this.status) {\n      return;\n    }\n\n    this.socket = new SocketIO(httpServer, {\n      cors: { origin: this.cors },\n      allowRequest: (req, callback) => {\n        try {\n          const remoteAddress = req.socket.remoteAddress;\n\n          if (!this.isAllowedNetworkAddress(remoteAddress)) {\n            this.logger.error(\`Connection rejected: network address not allowed (\${remoteAddress || 'unknown'})\`);\n            return callback('Network address not allowed', false);\n          }\n\n          // Network validation is only the first security layer. Authentication\n          // is mandatory for every Socket.IO connection in the middleware below.\n          return callback(null, true);\n        } catch (error) {\n          this.logger.error('Network validation error:');\n          this.logger.error(error);\n          return callback('Network validation error', false);\n        }\n      },\n    });\n\n    this.socket.use(async (socket, next) => {\n      try {\n        const apiKey =\n          (socket.handshake.auth?.apikey as string) ||\n          (socket.handshake.query?.apikey as string) ||\n          (socket.handshake.headers?.apikey as string);\n\n        if (!apiKey) {\n          this.logger.error('Connection rejected: apiKey not provided');\n          return next(new Error('apiKey is required'));\n        }\n\n        const instance = await this.prismaRepository.instance.findFirst({ where: { token: apiKey } });\n\n        if (!instance) {\n          const globalToken = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;\n          if (apiKey !== globalToken) {\n            this.logger.error('Connection rejected: invalid token');\n            return next(new Error('Invalid apiKey'));\n          }\n        }\n\n        return next();\n      } catch (error) {\n        this.logger.error('Authentication error:');\n        this.logger.error(error);\n        return next(new Error('Authentication error'));\n      }\n    });\n\n    this.socket.on('connection', (socket) => {\n      this.logger.info(\`Authenticated user connected: \${socket.id}\`);\n\n      socket.on('disconnect', (reason) => {\n        this.logger.info(\`User disconnected: \${socket.id} - \${reason}\`);\n      });\n\n      socket.on('sendNode', async (data) => {\n        try {\n          await this.waMonitor.waInstances[data.instanceId].baileysSendNode(data.stanza);\n          this.logger.info('Node sent successfully');\n        } catch (error) {\n          this.logger.error('Error sending node:');\n          this.logger.error(error);\n        }\n      });\n    });\n\n    this.logger.info('Socket.io initialized with network allowlist and mandatory API-key authentication');\n  }\n\n`;
websocket = websocket.slice(0, initStart) + newSocketInit + websocket.slice(initEnd);
write(websocketPath, websocket);

// env.config.ts: introduce ALLOWED_IPS while preserving ALLOWED_HOSTS compatibility.
const envConfigPath = 'src/config/env.config.ts';
let envConfig = read(envConfigPath);
envConfig = replaceOnce(
  envConfig,
  `export type Websocket = {\n  ENABLED: boolean;\n  GLOBAL_EVENTS: boolean;\n  ALLOWED_HOSTS?: string;\n};\n`,
  `export type Websocket = {\n  ENABLED: boolean;\n  GLOBAL_EVENTS: boolean;\n  ALLOWED_IPS?: string;\n  ALLOWED_HOSTS?: string;\n};\n`,
  'Websocket ALLOWED_IPS type',
);
envConfig = replaceOnce(
  envConfig,
  `      WEBSOCKET: {\n        ENABLED: process.env?.WEBSOCKET_ENABLED === 'true',\n        GLOBAL_EVENTS: process.env?.WEBSOCKET_GLOBAL_EVENTS === 'true',\n        ALLOWED_HOSTS: process.env?.WEBSOCKET_ALLOWED_HOSTS,\n      },\n`,
  `      WEBSOCKET: {\n        ENABLED: process.env?.WEBSOCKET_ENABLED === 'true',\n        GLOBAL_EVENTS: process.env?.WEBSOCKET_GLOBAL_EVENTS === 'true',\n        ALLOWED_IPS: process.env?.WEBSOCKET_ALLOWED_IPS,\n        ALLOWED_HOSTS: process.env?.WEBSOCKET_ALLOWED_HOSTS,\n      },\n`,
  'Websocket ALLOWED_IPS env loading',
);
write(envConfigPath, envConfig);

// ---------------------------------------------------------------------------
// Embedded Manager: keep Socket.IO client and event contract unchanged, but send
// the token through Socket.IO handshake.auth. Legacy accessToken fallback remains.
// ---------------------------------------------------------------------------
const managerPath = 'manager/dist/assets/index-CO3NSIFj.js';
let manager = read(managerPath);
const oldSocketHelper = 'const _u=new Map,sw=e=>{if(_u.has(e)){const n=_u.get(e);return YE(n)}const t=Tp(e,{transports:["websocket","polling"],autoConnect:!1,reconnection:!0,reconnectionAttempts:5,reconnectionDelay:1e3,timeout:2e4});';
const newSocketHelper = 'const _u=new Map,sw=(e,n)=>{if(_u.has(e)){const t=_u.get(e);return n&&(t.auth={apikey:n}),YE(t)}const r=n||localStorage.getItem("accessToken"),t=Tp(e,{transports:["websocket","polling"],auth:r?{apikey:r}:{},autoConnect:!1,reconnection:!0,reconnectionAttempts:5,reconnectionDelay:1e3,timeout:2e4});';
manager = replaceOnce(manager, oldSocketHelper, newSocketHelper, 'Manager Socket.IO auth helper');
manager = replaceOnce(manager, 'const W=sw(G),ie=', 'const W=sw(G,dr(jn.TOKEN)||o?.token),ie=', 'Manager message socket token');
manager = replaceOnce(manager, 'const k=sw(C),j=', 'const k=sw(C,dr(jn.TOKEN)||s?.token),j=', 'Manager chat-list socket token');
write(managerPath, manager);

// ---------------------------------------------------------------------------
// Environment templates: new explicit protocol/browser and WebSocket IP settings.
// Existing variables remain for backward compatibility.
// ---------------------------------------------------------------------------
const envFiles = [
  '.env.example',
  'env.example',
  'deploy/develop/env.example',
  'deploy/production/env.example',
  'deploy/canonical/env.example',
  'deploy/cloudpanel/.env.example',
  'deploy/cloudpanel/env.example',
  'deploy/dockge/.env.example',
  'deploy/dockge/env.example',
  'deploy/homologation/env.example',
].filter((path) => fs.existsSync(path));

for (const path of envFiles) {
  let content = read(path);

  if (content.includes('WEBSOCKET_ALLOWED_HOSTS=') && !content.includes('WEBSOCKET_ALLOWED_IPS=')) {
    content = content.replace(
      /(WEBSOCKET_ALLOWED_HOSTS=.*\n)/,
      '$1WEBSOCKET_ALLOWED_IPS=127.0.0.1,::1,::ffff:127.0.0.1,172.*,10.*,192.168.*\n',
    );
  }

  if (content.includes('CONFIG_SESSION_PHONE_NAME=') && !content.includes('WHATSAPP_PROTOCOL_BROWSER_CLIENT=')) {
    content = content.replace(
      /(CONFIG_SESSION_PHONE_NAME=.*\n)/,
      '$1WHATSAPP_PROTOCOL_BROWSER_CLIENT=🅲🅾🅽🅽🅴🅲🆃​|🅰🅿🅸\nWHATSAPP_PROTOCOL_BROWSER_NAME=Chrome\nWHATSAPP_PROTOCOL_BROWSER_VERSION=20.0.04\n',
    );
  }

  write(path, content);
}

// Documentation: reflect split fingerprint contract.
const pairingDocPath = 'PAIRING-CODE-COMPATIBILITY.md';
if (fs.existsSync(pairingDocPath)) {
  let doc = read(pairingDocPath);
  doc = doc.replace(
    '- A identidade visual do produto (`CONFIG_SESSION_PHONE_CLIENT=ConnectAPI`) não é usada como fingerprint protocolar do companion device.\n- O socket Baileys usa fingerprint canônico `Ubuntu / Chrome / 20.0.04` para compatibilidade com a validação de pairing do WhatsApp.\n',
    '- O QR Code usa fingerprint configurável por `WHATSAPP_PROTOCOL_BROWSER_*`, com padrão `🅲🅾🅽🅽🅴🅲🆃​|🅰🅿🅸 / Chrome / 20.0.04`.\n- O código de pareamento usa obrigatoriamente o fingerprint canônico `Ubuntu / Chrome / 20.0.04`, porque a validação de companion registration do WhatsApp rejeita o nome customizado nesse fluxo.\n',
  );
  write(pairingDocPath, doc);
}

console.log('Develop authentication contracts applied successfully.');
