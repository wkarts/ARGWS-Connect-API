from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    text = file.read_text()
    if old not in text:
        raise SystemExit(f'expected block not found in {path}: {old[:160]!r}')
    file.write_text(text.replace(old, new, 1))


# -----------------------------------------------------------------------------
# Backend: explicit Manager instance context, QR stability, lifecycle integrity.
# -----------------------------------------------------------------------------

replace_once(
    'src/api/guards/instance.guard.ts',
    """  if (!(await getInstance(param.instanceName))) {
    throw new NotFoundException(`The \"${param.instanceName}\" instance does not exist`);
  }

  next();
""",
    """  if (!(await getInstance(param.instanceName))) {
    throw new NotFoundException(`The \"${param.instanceName}\" instance does not exist`);
  }

  const expectedInstanceId = req.get('x-connect-instance-id');
  if (expectedInstanceId) {
    const persistedInstance = await prismaRepository.instance.findUnique({
      where: { name: param.instanceName },
      select: { id: true },
    });

    if (!persistedInstance || persistedInstance.id !== expectedInstanceId) {
      throw new ForbiddenException('Instance context mismatch');
    }
  }

  next();
""",
)

replace_once(
    'src/api/controllers/instance.controller.ts',
    """      const qrCode = instance.qrCode;
      if (pairingCodeRequested ? qrCode?.pairingCode : qrCode?.code) {
        return qrCode;
      }
""",
    """      const qrCode = instance.qrCode;
      if (pairingCodeRequested ? qrCode?.pairingCode : qrCode?.base64) {
        return qrCode;
      }
""",
)

replace_once(
    'src/api/controllers/instance.controller.ts',
    """        if (!('prepareQrConnection' in instance) || typeof instance.prepareQrConnection !== 'function') {
          throw new BadRequestException('QR connection is not available for the selected WhatsApp provider');
        }
        await instance.prepareQrConnection();
        return await this.waitForQrCode(instance, false);
""",
    """        if (!('prepareQrConnection' in instance) || typeof instance.prepareQrConnection !== 'function') {
          throw new BadRequestException('QR connection is not available for the selected WhatsApp provider');
        }

        // Zapo keeps connect() pending during first-time pairing and rotates QR
        // codes inside the same connection attempt. Restarting QR preparation
        // here invalidates the QR already shown by the Manager. Baileys keeps
        // its pre-existing refresh behavior.
        if (instance.integration !== Integration.WHATSAPP_ZAPO) {
          await instance.prepareQrConnection();
        }
        return await this.waitForQrCode(instance, false);
""",
)

replace_once(
    'src/api/controllers/instance.controller.ts',
    """  public async connectionState({ instanceName }: InstanceDto) {
    return {
      instance: {
        instanceName: instanceName,
        state: this.waMonitor.waInstances[instanceName]?.connectionStatus?.state,
      },
    };
  }
""",
    """  public async connectionState({ instanceName }: InstanceDto) {
    const current = this.waMonitor.waInstances[instanceName];
    return {
      instance: {
        instanceName,
        instanceId: current?.instanceId,
        integration: current?.integration,
        state: current?.connectionStatus?.state,
      },
      qrcode: current?.qrCode,
    };
  }
""",
)

replace_once(
    'src/api/controllers/instance.controller.ts',
    """      this.eventEmitter.emit('remove.instance', instanceName, 'inner');
      return { status: 'SUCCESS', error: false, response: { message: 'Instance deleted' } };
""",
    """      await this.waMonitor.removeInstanceNow(instanceName);
      return { status: 'SUCCESS', error: false, response: { message: 'Instance deleted' } };
""",
)

replace_once(
    'src/api/services/monitor.service.ts',
    "  private readonly delInstanceTimeouts: Record<string, NodeJS.Timeout> = {};\n",
    "  private readonly delInstanceTimeouts: Record<string, NodeJS.Timeout> = {};\n  private readonly removeInstancePromises: Record<string, Promise<void>> = {};\n",
)

replace_once(
    'src/api/services/monitor.service.ts',
    """  public deleteInstance(instanceName: string) {
    try {
      this.eventEmitter.emit('remove.instance', instanceName, 'inner');
    } catch (error) {
      this.logger.error(error);
    }
  }
""",
    """  public async removeInstanceNow(instanceName: string) {
    const runningRemoval = this.removeInstancePromises[instanceName];
    if (runningRemoval) return runningRemoval;

    const removal = (async () => {
      const current = this.waInstances[instanceName];
      try {
        try {
          await current?.sendDataWebhook(Events.REMOVE_INSTANCE, null);
        } catch (error) {
          this.logger.error({ localError: 'removeInstanceWebhook', instanceName, error });
        }

        this.clearDelInstanceTime(instanceName);

        if (typeof current?.purgeProviderState === 'function') {
          try {
            await current.purgeProviderState();
          } catch (error) {
            // Provider cleanup is best-effort; application persistence must
            // still be removed so a failed external store cannot leave a
            // visible/stale Connect|API instance behind.
            this.logger.error({ localError: 'purgeProviderState', instanceName, error });
          }
        }

        await this.cleaningUp(instanceName);
        await this.cleaningStoreData(instanceName);

        const persisted = await this.prismaRepository.instance.findFirst({
          where: { name: instanceName },
          select: { id: true },
        });
        if (persisted) {
          throw new Error(`Instance \"${instanceName}\" remained persisted after cleanup`);
        }
      } finally {
        delete this.waInstances[instanceName];
        this.logger.warn(`Instance \"${instanceName}\" - REMOVED`);
      }
    })();

    this.removeInstancePromises[instanceName] = removal;
    try {
      await removal;
    } finally {
      delete this.removeInstancePromises[instanceName];
    }
  }

  public deleteInstance(instanceName: string) {
    void this.removeInstanceNow(instanceName).catch((error) => {
      this.logger.error({ localError: 'removeInstanceNow', instanceName, error });
    });
  }
""",
)

replace_once(
    'src/api/services/monitor.service.ts',
    """    this.eventEmitter.on('remove.instance', async (instanceName: string) => {
      try {
        await this.waInstances[instanceName]?.sendDataWebhook(Events.REMOVE_INSTANCE, null);

        this.clearDelInstanceTime(instanceName);

        const current = this.waInstances[instanceName];
        if (typeof current?.purgeProviderState === 'function') {
          try {
            await current.purgeProviderState();
          } catch (error) {
            this.logger.error({ localError: 'purgeProviderState', instanceName, error });
          }
        }

        await this.cleaningUp(instanceName);
        await this.cleaningStoreData(instanceName);
      } finally {
        this.logger.warn(`Instance \"${instanceName}\" - REMOVED`);
      }

      try {
        delete this.waInstances[instanceName];
      } catch (error) {
        this.logger.error(error);
      }
    });
""",
    """    this.eventEmitter.on('remove.instance', (instanceName: string) => {
      void this.removeInstanceNow(instanceName).catch((error) => {
        this.logger.error({ localError: 'remove.instance', instanceName, error });
      });
    });
""",
)

replace_once(
    'src/validate/instance.schema.ts',
    "    number: { type: 'string', pattern: '^\\\\d+[\\\\.@\\\\w-]+' },\n    businessId: { type: 'string' },",
    "    number: { type: ['string', 'null'], pattern: '^\\\\d+[\\\\.@\\\\w-]+' },\n    businessId: { type: ['string', 'null'] },",
)

# -----------------------------------------------------------------------------
# Zapo: keep each QR generation atomic and canonicalize LID identities before
# webhook / chatbot / persistence. Baileys remains untouched.
# -----------------------------------------------------------------------------

replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """  private readonly audioEmitter = new EventEmitter2();
  private reconnectTimer?: NodeJS.Timeout;
  private intentionalDisconnect = false;
""",
    """  private readonly audioEmitter = new EventEmitter2();
  private reconnectTimer?: NodeJS.Timeout;
  private intentionalDisconnect = false;
  private qrGeneration = 0;
""",
)

replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """  public async prepareQrConnection() {
    this.instance.qrcode = { count: 0 };
    this.phoneNumber = undefined;
    await this.loadRuntimeConfiguration();
    await this.ensureClient();
    this.startConnect();
    return this.client;
  }
""",
    """  public async prepareQrConnection() {
    if (this.stateConnection.state === 'connecting' && this.connectPromise) {
      return this.client;
    }

    this.instance.qrcode = { count: 0 };
    this.phoneNumber = undefined;
    await this.loadRuntimeConfiguration();
    await this.ensureClient();
    this.startConnect();
    return this.client;
  }
""",
)

replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """  private async handleQr(qr: string) {
    if (!qr) return;
    this.instance.qrcode.count = (this.instance.qrcode.count || 0) + 1;
    this.instance.qrcode.code = qr;

    const opts: QRCodeToDataURLOptions = {
      margin: 3,
      scale: 4,
      errorCorrectionLevel: 'H',
      color: { light: '#ffffff', dark: '#111111' },
    };
    this.instance.qrcode.base64 = await qrcode.toDataURL(qr, opts);

    this.sendDataWebhook(Events.QRCODE_UPDATED, {
      qrcode: {
        instance: this.instance.name,
        pairingCode: this.instance.qrcode.pairingCode,
        code: qr,
        base64: this.instance.qrcode.base64,
      },
      provider: Integration.WHATSAPP_ZAPO,
    });
  }
""",
    """  private async handleQr(qr: string) {
    if (!qr) return;
    const generation = ++this.qrGeneration;
    const count = (this.instance.qrcode.count || 0) + 1;

    const opts: QRCodeToDataURLOptions = {
      margin: 3,
      scale: 4,
      errorCorrectionLevel: 'H',
      color: { light: '#ffffff', dark: '#111111' },
    };
    const base64 = await qrcode.toDataURL(qr, opts);

    // A newer auth_qr event may arrive while toDataURL is still running.
    // Never let an older QR overwrite the provider's current generation.
    if (generation !== this.qrGeneration) return;

    this.instance.qrcode.count = count;
    this.instance.qrcode.code = qr;
    this.instance.qrcode.base64 = base64;

    this.sendDataWebhook(Events.QRCODE_UPDATED, {
      qrcode: {
        instance: this.instance.name,
        pairingCode: this.instance.qrcode.pairingCode,
        code: qr,
        base64,
      },
      provider: Integration.WHATSAPP_ZAPO,
    });
  }
""",
)

replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """  private async handleIncomingMessage(event: any) {
    if (!event?.message || !event?.key?.remoteJid) return;

    const message = this.toJson(event.message);
    const messageType = this.detectMessageType(message);
    const messageRaw: any = {
      key: {
        id: event.key.id,
        remoteJid: event.key.remoteJid,
        remoteJidAlt: event.key.remoteJidAlt,
        fromMe: Boolean(event.key.fromMe),
        participant: event.key.participant,
        participantAlt: event.key.participantAlt,
      },
      pushName: event.pushName,
      participant: event.key.participant,
""",
    """  private async handleIncomingMessage(event: any) {
    if (!event?.message || !event?.key?.remoteJid) return;

    const rawRemoteJid = String(event.key.remoteJid);
    const remoteJidAlt = event.key.remoteJidAlt ? String(event.key.remoteJidAlt) : undefined;
    const canonicalRemoteJid =
      rawRemoteJid.endsWith('@lid') && remoteJidAlt && !remoteJidAlt.endsWith('@lid') ? remoteJidAlt : rawRemoteJid;
    const rawParticipant = event.key.participant ? String(event.key.participant) : undefined;
    const participantAlt = event.key.participantAlt ? String(event.key.participantAlt) : undefined;
    const canonicalParticipant =
      rawParticipant?.endsWith('@lid') && participantAlt && !participantAlt.endsWith('@lid')
        ? participantAlt
        : rawParticipant;

    const message = this.toJson(event.message);
    const messageType = this.detectMessageType(message);
    const messageRaw: any = {
      key: {
        id: event.key.id,
        remoteJid: canonicalRemoteJid,
        remoteJidAlt,
        fromMe: Boolean(event.key.fromMe),
        participant: canonicalParticipant,
        participantAlt,
      },
      pushName: event.pushName,
      participant: canonicalParticipant,
""",
)

replace_once(
    'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts',
    """    if (db.SAVE_DATA.CHATS) {
      await this.upsertChat(messageRaw.key.remoteJid, messageRaw.pushName);
    }
  }
""",
    """    if (db.SAVE_DATA.CHATS) {
      await this.upsertChat(messageRaw.key.remoteJid, messageRaw.pushName);
    }

    if (rawRemoteJid !== canonicalRemoteJid) {
      await Promise.all([
        this.prismaRepository.chat.deleteMany({ where: { instanceId: this.instanceId, remoteJid: rawRemoteJid } }),
        this.prismaRepository.contact.deleteMany({ where: { instanceId: this.instanceId, remoteJid: rawRemoteJid } }),
      ]);
    }
  }
""",
)

# -----------------------------------------------------------------------------
# Manager API client: every instance operation carries name + token + id.
# -----------------------------------------------------------------------------

Path('manager/src/api/client.js').write_text(r'''export class ApiError extends Error {
  constructor(message, status = 0, data = null) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.data = data;
  }
}

function messageFrom(data, fallback) {
  const value = data?.response?.message ?? data?.message ?? data?.error ?? fallback;
  return Array.isArray(value) ? value.join(', ') : String(value || fallback || 'Erro na comunicação com a API');
}

export async function rawRequest(url, options = {}) {
  const response = await fetch(url, options);
  const text = await response.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!response.ok) throw new ApiError(messageFrom(data, response.statusText), response.status, data);
  return data;
}

export async function fetchRoot(apiUrl) {
  return rawRequest(`${apiUrl.replace(/\/$/, '')}/`, { signal: AbortSignal.timeout(15000) });
}

export async function verifyCredentials(apiUrl, apiKey) {
  return rawRequest(`${apiUrl.replace(/\/$/, '')}/verify-creds`, {
    method: 'POST',
    headers: { apikey: apiKey },
    signal: AbortSignal.timeout(15000),
  });
}

export async function request(
  session,
  path,
  { method = 'GET', data, params, headers = {}, timeout = 30000 } = {},
  instanceToken = '',
) {
  const url = new URL(`${session.apiUrl}${path}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value != null) url.searchParams.set(key, String(value));
    });
  }
  const config = {
    method,
    headers: { apikey: instanceToken || session.apiKey, ...headers },
    signal: AbortSignal.timeout(timeout),
  };
  if (data !== undefined) {
    config.body = JSON.stringify(data);
    config.headers['content-type'] = config.headers['content-type'] || 'application/json';
  }
  return rawRequest(url.toString(), config);
}

export function requestInstance(session, instance, path, options = {}) {
  const instanceId = String(instance?.id || instance?.instanceId || '').trim();
  const instanceName = String(instance?.name || instance?.instanceName || '').trim();
  const instanceToken = String(instance?.token || instance?.instanceToken || '').trim();

  if (!instanceId || !instanceName || !instanceToken) {
    throw new ApiError('Contexto da instância incompleto. Atualize a lista e tente novamente.');
  }

  return request(
    session,
    path,
    {
      ...options,
      headers: {
        ...(options.headers || {}),
        'x-connect-instance-id': instanceId,
      },
    },
    instanceToken,
  );
}

export async function requestForm(session, path, formData, { params, timeout = 60000, headers = {} } = {}, instance = null) {
  const url = new URL(`${session.apiUrl}${path}`);
  if (params) {
    Object.entries(params).forEach(([key, value]) => {
      if (value != null) url.searchParams.set(key, String(value));
    });
  }

  const instanceId = String(instance?.id || instance?.instanceId || '').trim();
  const instanceToken = String(instance?.token || instance?.instanceToken || '').trim();
  const requestHeaders = { apikey: instanceToken || session.apiKey, ...headers };
  if (instanceId) requestHeaders['x-connect-instance-id'] = instanceId;

  return rawRequest(url.toString(), {
    method: 'POST',
    headers: requestHeaders,
    body: formData,
    signal: AbortSignal.timeout(timeout),
  });
}
''')

Path('manager/src/api/instances.js').write_text(r'''import { request, requestInstance } from './client.js';

export async function fetchInstances(session, instanceId = '') {
  const data = await request(session, '/instance/fetchInstances', {
    params: instanceId ? { instanceId } : undefined,
  });
  return Array.isArray(data) ? data : data ? [data] : [];
}

export const createInstance = (session, data) => request(session, '/instance/create', { method: 'POST', data });

export const deleteInstance = (session, instance) =>
  requestInstance(session, instance, `/instance/delete/${encodeURIComponent(instance.name)}`, { method: 'DELETE' });

export const logoutInstance = (session, instance) =>
  requestInstance(session, instance, `/instance/logout/${encodeURIComponent(instance.name)}`, { method: 'DELETE' });

export const restartInstance = (session, instance) =>
  requestInstance(session, instance, `/instance/restart/${encodeURIComponent(instance.name)}`, { method: 'POST' });

export const connectInstance = (session, instance, pairing = false) =>
  requestInstance(session, instance, `/instance/connect/${encodeURIComponent(instance.name)}`, {
    params: pairing && instance.number ? { number: instance.number } : undefined,
  });

export const connectionState = (session, instance) =>
  requestInstance(session, instance, `/instance/connectionState/${encodeURIComponent(instance.name)}`);
''')

# Chat calls remain instance scoped, including uploads.
chat = Path('manager/src/api/chat.js').read_text()
chat = chat.replace("import { request, requestForm } from './client.js';", "import { requestForm, requestInstance } from './client.js';")
chat = chat.replace("request(session, `/chat/findChats/${encodeURIComponent(instance.name)}`, { method: 'POST', data: { where: {} } }, instance.token)", "requestInstance(session, instance, `/chat/findChats/${encodeURIComponent(instance.name)}`, { method: 'POST', data: { where: {} } })")
chat = chat.replace("request(session, `/chat/findMessages/${encodeURIComponent(instance.name)}`, { method: 'POST', data: { where: { key: { remoteJid } } } }, instance.token)", "requestInstance(session, instance, `/chat/findMessages/${encodeURIComponent(instance.name)}`, { method: 'POST', data: { where: { key: { remoteJid } } } })")
chat = chat.replace("request(session, `/message/sendText/${encodeURIComponent(instance.name)}`, { method: 'POST', data: { number: remoteJid.replace(/@.+$/, ''), text } }, instance.token)", "requestInstance(session, instance, `/message/sendText/${encodeURIComponent(instance.name)}`, { method: 'POST', data: { number: remoteJid.replace(/@.+$/, ''), text } })")
chat = chat.replace("requestForm(session, `/message/sendMedia/${encodeURIComponent(instance.name || instance.instanceName)}`, form, {}, instance.token)", "requestForm(session, `/message/sendMedia/${encodeURIComponent(instance.name || instance.instanceName)}`, form, {}, instance)")
Path('manager/src/api/chat.js').write_text(chat)

# Configuration calls get the same context assertion.
Path('manager/src/api/configuration.js').write_text(r'''import { requestInstance } from './client.js';

export const configTitles = {
  settings: 'Comportamento',
  proxy: 'Proxy',
  webhook: 'Webhook',
  websocket: 'WebSocket',
  rabbitmq: 'RabbitMQ',
  sqs: 'SQS',
  chatwoot: 'Chatwoot',
};

export async function loadConfiguration(session, instance, kind) {
  return requestInstance(session, instance, `/${kind}/find/${encodeURIComponent(instance.name)}`);
}

export async function saveConfiguration(session, instance, kind, payload) {
  let data = payload;
  if (kind === 'webhook') data = { webhook: payload };
  if (kind === 'websocket') data = { websocket: payload };
  if (kind === 'rabbitmq') data = { rabbitmq: payload };
  if (kind === 'sqs') data = { sqs: payload };
  return requestInstance(session, instance, `/${kind}/set/${encodeURIComponent(instance.name)}`, {
    method: 'POST',
    data,
  });
}
''')

# -----------------------------------------------------------------------------
# Manager router: URL instance id is authoritative; never trust a previous
# localStorage selection for regular pages or embedded chat.
# -----------------------------------------------------------------------------

Path('manager/src/main.js').write_text(r'''import { fetchInstances } from './api/instances.js';
import { alertBox, clear, el, spinner } from './core/dom.js';
import { installRouter, navigate, setRenderer } from './core/router.js';
import { getTheme, loadSession, saveSelectedInstance, setTheme } from './core/session.js';
import { renderChat } from './pages/chat.js';
import { renderConfig } from './pages/config.js';
import { renderDashboard } from './pages/dashboard.js';
import { renderInstances } from './pages/instances.js';
import { renderIntegration } from './pages/integration.js';
import { renderLogin } from './pages/login.js';

const root = document.getElementById('root');
setTheme(getTheme());

const configKinds = new Set(['settings', 'proxy', 'webhook', 'websocket', 'rabbitmq', 'sqs', 'chatwoot']);
const integrationKinds = new Set(['typebot', 'openai', 'dify', 'n8n', 'connectAI', 'connectBot', 'flowise']);

function idOf(instance) {
  return String(instance?.id || instance?.instanceId || '');
}

async function resolveInstance(session, requestedId) {
  const rows = await fetchInstances(session, requestedId);
  const exact = rows.find((instance) => idOf(instance) === requestedId);
  if (!exact) throw new Error('Instância não encontrada ou contexto inconsistente.');
  return exact;
}

async function render() {
  clear(root);
  const path = location.pathname;

  if (path === '/' || path === '') {
    navigate('/manager/login', true);
    return;
  }

  if (path === '/manager/login') {
    root.append(renderLogin());
    return;
  }

  const session = loadSession();
  if (!session) {
    navigate('/manager/login', true);
    return;
  }

  if (path === '/manager' || path === '/manager/') {
    root.append(renderInstances());
    return;
  }

  const embedMatch = path.match(/^\/manager\/embed-chat\/([^/]+)(?:\/(.+))?$/);
  if (embedMatch) {
    const requestedId = decodeURIComponent(embedMatch[1]);
    const encodedJid = embedMatch[2] || '';
    root.append(el('div', { class: 'center' }, spinner()));
    try {
      const instance = await resolveInstance(session, requestedId);
      saveSelectedInstance(instance);
      clear(root).append(
        renderChat(instance, encodedJid ? decodeURIComponent(encodedJid) : '', {
          embedded: true,
        }),
      );
    } catch (error) {
      clear(root).append(alertBox(error.message || String(error)));
    }
    return;
  }

  const match = path.match(/^\/manager\/instance\/([^/]+)(?:\/([^/]+))?(?:\/(.+))?$/);
  if (!match) {
    navigate('/manager/', true);
    return;
  }

  const [, encodedInstanceId, section = 'dashboard', tail = ''] = match;
  const requestedId = decodeURIComponent(encodedInstanceId);
  root.append(el('div', { class: 'center' }, spinner()));

  try {
    const instance = await resolveInstance(session, requestedId);
    saveSelectedInstance(instance);

    const reload = async () => {
      const fresh = await resolveInstance(session, requestedId);
      saveSelectedInstance(fresh);
      void render();
    };

    clear(root);

    if (section === 'dashboard') root.append(renderDashboard(instance, reload));
    else if (section === 'chat') root.append(renderChat(instance, tail ? decodeURIComponent(tail) : ''));
    else if (configKinds.has(section)) root.append(renderConfig(instance, section));
    else if (integrationKinds.has(section)) root.append(renderIntegration(instance, section));
    else root.append(renderDashboard(instance, reload));
  } catch (error) {
    clear(root).append(alertBox(error.message || String(error)));
  }
}

setRenderer(render);
installRouter();
void render();
''')

# Keep embedded-chat navigation scoped to the current instance id.
replace_once(
    'manager/src/pages/chat.js',
    """                embedded
                  ? `/manager/embed-chat/${encodeURIComponent(jid)}`
                  : `/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/chat/${encodeURIComponent(jid)}`,
""",
    """                embedded
                  ? `/manager/embed-chat/${encodeURIComponent(instance.id || instance.instanceId)}/${encodeURIComponent(jid)}`
                  : `/manager/instance/${encodeURIComponent(instance.id || instance.instanceId)}/chat/${encodeURIComponent(jid)}`,
""",
)

# -----------------------------------------------------------------------------
# Dashboard: QR state is polled from the same instance without re-running
# connect(). Zapo rotations update the image; opening another instance cannot
# close or replace this modal.
# -----------------------------------------------------------------------------

Path('manager/src/pages/dashboard.js').write_text(r'''import { connectionState, connectInstance, logoutInstance, restartInstance } from '../api/instances.js';
import { alertBox, badge, button, card, el, modal } from '../core/dom.js';
import { loadSession } from '../core/session.js';
import { instanceShell, pageHeader } from '../components/shell.js';

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function idOf(instance) {
  return String(instance?.id || instance?.instanceId || '');
}

export function renderDashboard(instance, reloadInstance) {
  const session = loadSession();
  const page = el('div', { class: 'page' });
  const error = el('div');
  const expectedId = idOf(instance);

  async function run(kind) {
    error.replaceChildren();
    try {
      if (kind === 'restart') {
        await restartInstance(session, instance);
        await reloadInstance();
        return;
      }
      if (kind === 'logout') {
        await logoutInstance(session, instance);
        await reloadInstance();
        return;
      }
      if (kind === 'qr') {
        const data = await connectInstance(session, instance, false);
        const dialog = showQr(data);
        void watchConnection(dialog, true);
        return;
      }
      if (kind === 'pair') {
        const data = await connectInstance(session, instance, true);
        const dialog = showPair(data);
        void watchConnection(dialog, false);
      }
    } catch (e) {
      error.replaceChildren(alertBox(e.message || String(e)));
    }
  }

  function qrFrom(data) {
    return data?.base64 || data?.qrcode?.base64 || '';
  }

  function showQr(data) {
    const image = el('img', { alt: `QR Code ${instance.name}` });
    const status = el('small', { class: 'muted', text: `Instância: ${instance.name}` });
    const content = el('div', { class: 'qr-wrap' }, image, status);
    const initial = qrFrom(data);
    if (initial) image.src = initial;
    else status.textContent = `Aguardando QR da instância ${instance.name}...`;
    const dialog = modal(`QR Code · ${instance.name}`, content);
    dialog.qrImage = image;
    dialog.qrStatus = status;
    return dialog;
  }

  function showPair(data) {
    const code = data?.pairingCode || data?.qrcode?.pairingCode || data?.code || '';
    return modal(
      `Código de pareamento · ${instance.name}`,
      el(
        'div',
        { class: 'pairing-code-wrap' },
        el('div', { class: 'pairing-code', text: code || 'Código não retornado' }),
        el('small', { class: 'muted', text: `Instância: ${instance.name}` }),
      ),
    );
  }

  async function watchConnection(dialog, refreshQr) {
    let lastQr = dialog.qrImage?.src || '';
    for (let attempt = 0; attempt < 120; attempt += 1) {
      if (!document.body.contains(dialog.element)) return;
      await sleep(1500);
      try {
        const state = await connectionState(session, instance);
        const returnedId = String(state?.instance?.instanceId || '');
        if (returnedId && returnedId !== expectedId) {
          dialog.close();
          throw new Error('A API retornou estado de outra instância. A operação foi interrompida.');
        }

        if (state?.instance?.state === 'open') {
          dialog.close();
          await reloadInstance();
          return;
        }

        if (refreshQr && dialog.qrImage) {
          const currentQr = qrFrom(state);
          if (currentQr && currentQr !== lastQr) {
            lastQr = currentQr;
            dialog.qrImage.src = currentQr;
            if (dialog.qrStatus) dialog.qrStatus.textContent = `QR atualizado · ${instance.name}`;
          }
        }
      } catch (watchError) {
        if (document.body.contains(dialog.element) && dialog.qrStatus) {
          dialog.qrStatus.textContent = watchError.message || String(watchError);
        }
      }
    }
  }

  page.append(
    pageHeader(instance.name, instance.profileName || instance.ownerJid || 'Aguardando conexão', [
      badge(instance.connectionStatus),
    ]),
    error,
    card(
      el(
        'div',
        { class: 'dashboard-row' },
        el(
          'div',
          {},
          el('span', { class: 'muted', text: 'Token da instância' }),
          el('code', { class: 'token-line', text: instance.token || '' }),
        ),
        el(
          'div',
          { class: 'actions' },
          button('Atualizar', { onclick: reloadInstance }),
          button('Reiniciar', { onclick: () => run('restart') }),
          button('Desconectar', { class: 'danger', onclick: () => run('logout') }),
        ),
      ),
      instance.connectionStatus !== 'open'
        ? el(
            'div',
            { class: 'connect-panel' },
            el('strong', { text: 'Conecte o WhatsApp desta instância' }),
            el(
              'div',
              { class: 'actions' },
              button('Gerar QR Code', { class: 'primary', onclick: () => run('qr') }),
              instance.number ? button('Código de pareamento', { onclick: () => run('pair') }) : null,
            ),
          )
        : null,
    ),
    el(
      'div',
      { class: 'metric-grid' },
      metric('Contatos', instance._count?.Contact, '☷'),
      metric('Chats', instance._count?.Chat, '◉'),
      metric('Mensagens', instance._count?.Message, '✉'),
    ),
  );

  return instanceShell(instance, 'dashboard', page);
}

function metric(label, value, icon) {
  return card(
    el('span', { class: 'metric-icon', text: icon }),
    el('strong', { text: Number(value || 0).toLocaleString('pt-BR') }),
    el('span', { text: label }),
  );
}
''')

# Static invariants for the new provider/context behavior. package.json already
# references this file, but it was missing from the repository.
Path('test/zapo-provider.integration.test.mjs').write_text(r'''import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const zapo = read('src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts');
const controller = read('src/api/controllers/instance.controller.ts');
const guard = read('src/api/guards/instance.guard.ts');
const managerClient = read('manager/src/api/client.js');

assert(zapo.includes("this.client.on('auth_qr'"), 'Zapo auth_qr listener missing');
assert(zapo.includes('generation !== this.qrGeneration'), 'Zapo QR generation race guard missing');
assert(zapo.includes("rawRemoteJid.endsWith('@lid')"), 'Zapo LID canonicalization missing');
assert(controller.includes('instance.integration !== Integration.WHATSAPP_ZAPO'), 'Zapo connecting QR must not restart');
assert(controller.includes('qrCode?.base64'), 'QR response must wait for rendered base64');
assert(guard.includes("req.get('x-connect-instance-id')"), 'Manager instance-id context guard missing');
assert(managerClient.includes("'x-connect-instance-id': instanceId"), 'Manager must send instance-id context');

console.log('Zapo/provider multi-instance invariants: OK');
''')

# Manager static regression guards.
check = Path('manager/scripts/check.mjs').read_text()
check += "\nconst clientSource=fs.readFileSync(path.join(src,'api','client.js'),'utf8'); if(!clientSource.includes(\"'x-connect-instance-id': instanceId\"))throw new Error('Manager instance context header missing.');\nconst mainSource=fs.readFileSync(path.join(src,'main.js'),'utf8'); if(mainSource.includes('loadSelectedInstance'))throw new Error('Manager routing must not use stale selected-instance state.');\nconst dashboardSource=fs.readFileSync(path.join(src,'pages','dashboard.js'),'utf8'); if(!dashboardSource.includes('connectionState(session, instance)'))throw new Error('Dashboard QR polling must be instance scoped.');\n"
Path('manager/scripts/check.mjs').write_text(check)
