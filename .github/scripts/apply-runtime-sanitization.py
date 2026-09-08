from pathlib import Path
import re


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 exact match, got {count}')
    p.write_text(text.replace(old, new, 1))


def sub_once(path, pattern, replacement, flags=0):
    p = Path(path)
    text = p.read_text()
    text2, count = re.subn(pattern, replacement, text, count=1, flags=flags)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 regex match, got {count}')
    p.write_text(text2)


# 1) Never persist this account's own profile name as a remote contact/chat name.
path = 'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts'
replace_once(
    path,
    """    if (db.SAVE_DATA.CONTACTS) {
      await this.upsertContact(messageRaw.key.remoteJid, messageRaw.pushName);
    }

    if (db.SAVE_DATA.CHATS) {
      await this.upsertChat(messageRaw.key.remoteJid, messageRaw.pushName);
    }""",
    """    // `pushName` on messages sent by this account identifies this account,
    // not the remote peer. Persist it only for inbound messages; otherwise a
    // single local profile name can contaminate many unrelated contacts/chats.
    const remotePushName = messageRaw.key.fromMe ? undefined : messageRaw.pushName;

    if (db.SAVE_DATA.CONTACTS) {
      await this.upsertContact(messageRaw.key.remoteJid, remotePushName);
    }

    if (db.SAVE_DATA.CHATS) {
      await this.upsertChat(messageRaw.key.remoteJid, remotePushName);
    }""",
)
replace_once(
    path,
    """      pushName: this.instance.profileName,
      messageType,""",
    """      // Outgoing message metadata must not identify the remote peer with
      // this account's own WhatsApp profile name.
      pushName: undefined,
      messageType,""",
)

# 2) Make ZAPO identity reconciliation event-driven/background and sanitize old bad names.
path = 'src/api/integrations/channel/whatsapp/zapo.identity.extensions.ts'
replace_once(
    path,
    """import { zapoJidUser, zapoKnownLidJid, zapoLidJid, zapoPhoneJid, zapoTryNormalizeJid } from './zapo.jid.helpers';""",
    """import {
  zapoIsOwnAccountJid,
  zapoJidUser,
  zapoKnownLidJid,
  zapoLidJid,
  zapoPhoneJid,
  zapoTryNormalizeJid,
} from './zapo.jid.helpers';""",
)
replace_once(path, '  private readonly identityRefreshTtlMs = 30_000;', '  private readonly identityRefreshTtlMs = 5 * 60 * 1000;')
replace_once(
    path,
    """  public async fetchContacts(query: Query<Contact>) {
    await this.reconcileIdentities();
    return super.fetchContacts(query);
  }

  public async fetchChats(query: any) {
    await this.reconcileIdentities();
    return super.fetchChats(query);
  }

  public async listCalls() {
    await this.reconcileIdentities();
    const calls = await super.listCalls();
    return Promise.all(calls.map((call: any) => this.enrichCall(call)));
  }""",
    """  public async fetchContacts(query: Query<Contact>) {
    this.scheduleIdentityReconciliation();
    return super.fetchContacts(query);
  }

  public async fetchChats(query: any) {
    this.scheduleIdentityReconciliation();
    return super.fetchChats(query);
  }

  public async listCalls() {
    this.scheduleIdentityReconciliation();
    const calls = await super.listCalls();
    return Promise.all(calls.map((call: any) => this.enrichCall(call)));
  }

  private scheduleIdentityReconciliation(force = false): void {
    void this.reconcileIdentities(force).catch((error: Error) =>
      this.logger.warn(`ZAPO identity refresh failed: ${error?.message || error}`),
    );
  }""",
)
replace_once(
    path,
    """    const phoneJid = zapoPhoneJid(event?.callerPnJid) || previous?.phoneJid;
    const lidJid =
      zapoKnownLidJid(event?.senderLidJid) ||
      zapoLidJid(event?.callCreatorJid) ||
      zapoLidJid(event?.chatJid) ||
      previous?.lidJid;

    if (phoneJid && lidJid) this.rememberAlias(lidJid, phoneJid);

    // `notify` / callerPushName is authoritative for an inbound offer. Do not
    // persist names from later outgoing-call signaling because some call
    // objects can carry this account's own profile name.
    const pushName =
      String(event?.type || '').toLowerCase() === 'offer'
        ? this.sanitizeRemoteName(event?.callerPushName) || previous?.pushName
        : previous?.pushName;

    this.nativeCallHints.set(callId, {
      phoneJid,
      lidJid,
      pushName,
      observedAt: now,
    });

    if (phoneJid && String(event?.type || '').toLowerCase() === 'offer') {
      await this.persistNativeContactHint(phoneJid, pushName);
    }""",
    """    const phoneJid = zapoPhoneJid(event?.callerPnJid || event?.callerPn) || previous?.phoneJid;
    const lidJid =
      zapoKnownLidJid(event?.senderLidJid) ||
      zapoLidJid(event?.callCreatorJid) ||
      zapoLidJid(event?.chatJid) ||
      previous?.lidJid;

    const credentials = this.client?.getCredentials?.();
    const isOwnPeer = Boolean(
      phoneJid && zapoIsOwnAccountJid(phoneJid, credentials?.meJid, credentials?.meLid),
    );
    if (phoneJid && lidJid && !isOwnPeer) this.rememberAlias(lidJid, phoneJid);

    const eventType = String(event?.type || event?.kind || event?.event || '').toLowerCase();
    const isInboundIdentity =
      !isOwnPeer &&
      Boolean(phoneJid) &&
      (['offer', 'notify', 'incoming', 'inbound'].includes(eventType) || Boolean(event?.callerPushName));

    // The native ZAPO call event is the strongest source for inbound PN/LID
    // identity. Accept the documented caller fields even when a release names
    // the transition `notify`/`incoming` instead of only `offer`.
    const pushName = isInboundIdentity
      ? this.sanitizeRemoteName(event?.callerPushName) || previous?.pushName
      : previous?.pushName;

    this.nativeCallHints.set(callId, {
      phoneJid: isOwnPeer ? previous?.phoneJid : phoneJid,
      lidJid: isOwnPeer ? previous?.lidJid : lidJid,
      pushName,
      observedAt: now,
    });

    if (phoneJid && isInboundIdentity) {
      await this.persistNativeContactHint(phoneJid, pushName);
    }""",
)
replace_once(
    path,
    """      const displayName = String(row.display_name || row.push_name || '').trim();

      if (lidJid && phoneJid) this.rememberAlias(lidJid, phoneJid, aliases);
      if (displayName && phoneJid) preferredNames.set(phoneJid, displayName);""",
    """      const displayName = this.sanitizeRemoteName(row.display_name) || this.sanitizeRemoteName(row.push_name);

      if (lidJid && phoneJid) this.rememberAlias(lidJid, phoneJid, aliases);
      if (displayName && phoneJid) preferredNames.set(phoneJid, displayName);""",
)
replace_once(
    path,
    """    this.collectMessageAliases(storedMessages, aliases);

    const contactsByJid = new Map<string, (typeof storedContacts)[number]>();""",
    """    this.collectMessageAliases(storedMessages, aliases);

    // Repair historical contamination created when an outgoing message used
    // this account's own profile name as the remote peer name. Keep identity
    // records/messages intact; only clear the demonstrably unsafe label.
    const localProfileNames = [this.instance.profileName, this.client?.getCredentials?.()?.meDisplayName]
      .map((value) => String(value || '').trim())
      .filter(Boolean);
    if (localProfileNames.length) {
      await Promise.all([
        this.prismaRepository.contact.updateMany({
          where: { instanceId: this.instanceId, pushName: { in: localProfileNames } },
          data: { pushName: null },
        }),
        this.prismaRepository.chat.updateMany({
          where: { instanceId: this.instanceId, name: { in: localProfileNames } },
          data: { name: null },
        }),
      ]);
      for (const contact of storedContacts) {
        if (contact.pushName && localProfileNames.includes(contact.pushName)) contact.pushName = null;
      }
      for (const chat of storedChats) {
        if (chat.name && localProfileNames.includes(chat.name)) chat.name = null;
      }
    }

    const contactsByJid = new Map<string, (typeof storedContacts)[number]>();""",
)
replace_once(
    path,
    """        const pushName = preferredName || phoneContact?.pushName || lidContact?.pushName || undefined;""",
    """        const pushName =
          preferredName ||
          this.sanitizeRemoteName(phoneContact?.pushName) ||
          this.sanitizeRemoteName(lidContact?.pushName);""",
)
replace_once(
    path,
    """        const name = preferredName || phoneChat?.name || lidChat?.name || undefined;""",
    """        const name =
          preferredName || this.sanitizeRemoteName(phoneChat?.name) || this.sanitizeRemoteName(lidChat?.name);""",
)
replace_once(
    path,
    """        name: contact.pushName || undefined,
        avatar: contact.profilePicUrl || undefined,""",
    """        name: this.sanitizeRemoteName(contact.pushName),
        avatar: contact.profilePicUrl || undefined,""",
)
replace_once(
    path,
    """      name: contact?.pushName || chat?.name || undefined,
      avatar: contact?.profilePicUrl || undefined,""",
    """      name: this.sanitizeRemoteName(contact?.pushName) || this.sanitizeRemoteName(chat?.name),
      avatar: contact?.profilePicUrl || undefined,""",
)
replace_once(
    path,
    """      const normalized = zapoTryNormalizeJid(candidate);
      if (!normalized) continue;
      const lidJid = zapoLidJid(normalized);""",
    """      const normalized = zapoTryNormalizeJid(candidate);
      if (!normalized) continue;
      const credentials = this.client?.getCredentials?.();
      if (zapoIsOwnAccountJid(normalized, credentials?.meJid, credentials?.meLid)) continue;
      const lidJid = zapoLidJid(normalized);""",
)

# 3) Manager must never present opaque LID/group IDs as phone numbers.
path = 'manager/src/services/normalizers.ts'
replace_once(
    path,
    """function jidLocal(value: any): string {
  return str(value).split('@')[0].replace(/:\\d+$/, '')
}

function identityKey(value: any): string {""",
    """function jidLocal(value: any): string {
  return str(value).split('@')[0].replace(/:\\d+$/, '')
}

function phoneFromRef(value: any): string {
  const ref = str(value).trim()
  if (!ref) return ''
  const lower = ref.toLowerCase()
  if (
    lower.endsWith('@lid') ||
    lower.endsWith('@g.us') ||
    lower.endsWith('@broadcast') ||
    lower.endsWith('@newsletter')
  ) return ''
  if (ref.includes('@') && !lower.endsWith('@s.whatsapp.net')) return ''
  const local = jidLocal(ref)
  return /^\\+?\\d+$/.test(local) ? local.replace(/\\D/g, '') : ''
}

function firstPhone(...values: any[]): string {
  for (const value of values) {
    const phone = phoneFromRef(value)
    if (phone) return phone
  }
  return ''
}

function identityKey(value: any): string {""",
)
replace_once(
    path,
    """      const rawRef = str(item.remoteJid || item.jid || item.number || '')
      const number = item.number || jidLocal(rawRef) || undefined
      const name = str(item.pushName || item.name || item.verifiedName || item.notify || number || rawRef || 'Contato')""",
    """      const rawRef = str(item.remoteJid || item.jid || item.number || '')
      const number = firstPhone(
        item.phoneNumber,
        item.phoneJid,
        item.remoteJidAlt,
        rawRef.endsWith('@lid') ? undefined : item.number,
        rawRef,
      ) || undefined
      const name = str(item.pushName || item.name || item.verifiedName || item.notify || number || 'Contato')""",
)
replace_once(
    path,
    """        subtitle: item.number || rawRef || item.subtitle,""",
    """        subtitle:
          firstPhone(item.phoneNumber, item.phoneJid, item.remoteJidAlt, item.number, rawRef) ||
          (rawRef.endsWith('@lid') ? '' : rawRef) ||
          item.subtitle,""",
)
replace_once(
    path,
    """    const remote = str(
      item.displayPeerJid ||
      item.remoteJid ||
      item.peerJid ||
      item.callerPn ||
      item.peerJidAlt ||
      item.peerJidRaw ||
      item.from ||
      item.to ||
      item.number ||
      '',
    )
    const number = str(item.number || jidLocal(remote) || '')""",
    """    const remote = str(
      item.callerPnJid ||
      item.callerPn ||
      item.displayPeerJid ||
      item.remoteJid ||
      item.peerJid ||
      item.peerJidAlt ||
      item.peerJidRaw ||
      item.from ||
      item.to ||
      '',
    )
    const number = firstPhone(
      item.number,
      item.callerPnJid,
      item.callerPn,
      item.displayPeerJid,
      item.remoteJid,
      item.peerJid,
      item.peerJidAlt,
      item.peerJidRaw,
    )""",
)
replace_once(
    path,
    """      name: item.name || item.pushName || item.contactName || undefined,""",
    """      name: item.contactName || item.name || item.pushName || undefined,""",
)

# 4) Stop refreshing the full instance list on every call poll/view transition.
path = 'manager/src/services/current.ts'
replace_once(
    path,
    """let accessCode = sessionStorage.getItem(ACCESS_STORAGE_KEY) || ''
let instanceCache = new Map<string, any>()""",
    """let accessCode = sessionStorage.getItem(ACCESS_STORAGE_KEY) || ''
let instanceCache = new Map<string, any>()
let instanceCacheItems: any[] = []
let instanceCacheFetchedAt = 0
let instanceCachePromise: Promise<any[]> | null = null
const INSTANCE_CACHE_TTL_MS = 5_000""",
)
replace_once(
    path,
    """export function clearCurrentAccess() {
  saveAccess('')
  instanceCache.clear()
}""",
    """export function clearCurrentAccess() {
  saveAccess('')
  instanceCache.clear()
  instanceCacheItems = []
  instanceCacheFetchedAt = 0
  instanceCachePromise = null
}""",
)
replace_once(
    path,
    """  instanceCache = next
  return items
}

async function rawInstances() {
  const data = await api<any>('/instance/fetchInstances')
  const items = Array.isArray(data) ? data : data ? [data] : []
  return rememberInstances(items)
}

async function rawInstance(ref: string, refresh = false) {
  if (!refresh) {
    const cached = instanceCache.get(ref)
    if (cached) return cached
  }
  const items = await rawInstances()""",
    """  instanceCache = next
  instanceCacheItems = items
  instanceCacheFetchedAt = Date.now()
  return items
}

async function rawInstances(force = false) {
  if (!force && instanceCacheFetchedAt && Date.now() - instanceCacheFetchedAt < INSTANCE_CACHE_TTL_MS) {
    return instanceCacheItems
  }
  if (!force && instanceCachePromise) return instanceCachePromise

  const pending = api<any>('/instance/fetchInstances').then((data) => {
    const items = Array.isArray(data) ? data : data ? [data] : []
    return rememberInstances(items)
  })
  instanceCachePromise = pending
  try {
    return await pending
  } finally {
    if (instanceCachePromise === pending) instanceCachePromise = null
  }
}

async function rawInstance(ref: string, refresh = false) {
  if (!refresh) {
    const cached = instanceCache.get(ref)
    if (cached) return cached
  }
  const items = await rawInstances(refresh)""",
)
text = Path(path).read_text()
for marker in ['offerCall', 'callAction', 'voiceMedia', 'integrationSummaries']:
    old = f"    }}, true)\n  }},\n\n  async {marker}"
    new = f"    }})\n  }},\n\n  async {marker}"
    if old not in text:
        raise SystemExit(f'{path}: refresh marker before {marker} not found')
    text = text.replace(old, new, 1)
Path(path).write_text(text)

# 5) Cache per-instance event configuration and avoid DB reads on every emitted event.
path = 'src/api/integrations/event/event.controller.ts'
replace_once(
    path,
    """  private integrationStatus: boolean;
  private integrationName: string;""",
    """  private integrationStatus: boolean;
  private integrationName: string;
  private readonly instanceConfigCache = new Map<string, { expiresAt: number; data: wa.LocalEvent | null }>();
  private readonly instanceConfigCacheTtlMs = 5_000;""",
)
replace_once(
    path,
    """    return this.prisma[this.name].upsert({
      where: {
        instanceId: instance.instanceId,
      },
      update: {
        enabled,
        events,
      },
      create: {
        enabled,
        events,
        instanceId: instance.instanceId,
      },
    });""",
    """    const result = await this.prisma[this.name].upsert({
      where: {
        instanceId: instance.instanceId,
      },
      update: {
        enabled,
        events,
      },
      create: {
        enabled,
        events,
        instanceId: instance.instanceId,
      },
    });
    this.instanceConfigCache.set(instanceName, {
      expiresAt: Date.now() + this.instanceConfigCacheTtlMs,
      data: result,
    });
    return result;""",
)
replace_once(
    path,
    """    const data = await this.prisma[this.name].findUnique({
      where: {
        instanceId: this.monitor.waInstances[instanceName].instanceId,
      },
    });

    if (!data) {
      return null;
    }

    return data;""",
    """    const cached = this.instanceConfigCache.get(instanceName);
    if (cached && cached.expiresAt > Date.now()) return cached.data;

    const data = await this.prisma[this.name].findUnique({
      where: {
        instanceId: this.monitor.waInstances[instanceName].instanceId,
      },
    });

    const normalized = data || null;
    this.instanceConfigCache.set(instanceName, {
      expiresAt: Date.now() + this.instanceConfigCacheTtlMs,
      data: normalized,
    });
    return normalized;""",
)

# 6) Prepare RabbitMQ topology once per connection instead of on every event.
path = 'src/api/integrations/event/rabbitmq/rabbitmq.controller.ts'
replace_once(
    path,
    """  private reconnectDelay = 5000; // 5 seconds
  private isReconnecting = false;""",
    """  private reconnectDelay = 5000; // 5 seconds
  private isReconnecting = false;
  private readonly preparedBindings = new Set<string>();""",
)
replace_once(
    path,
    """          this.amqpConnection = connection;
          this.amqpChannel = channel;
          this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection""",
    """          this.amqpConnection = connection;
          this.amqpChannel = channel;
          this.preparedBindings.clear();
          this.reconnectAttempts = 0; // Reset reconnect attempts on successful connection""",
)
replace_once(
    path,
    """  private async ensureConnection(): Promise<boolean> {
    if (!this.amqpChannel) {""",
    """  private async ensureBinding(exchangeName: string, queueName: string, routingKey: string): Promise<void> {
    if (!this.amqpChannel) throw new Error('AMQP channel is not available');
    const key = `${exchangeName}\\u0000${queueName}\\u0000${routingKey}`;
    if (this.preparedBindings.has(key)) return;

    await this.amqpChannel.assertExchange(exchangeName, 'topic', { durable: true, autoDelete: false });
    await this.amqpChannel.assertQueue(queueName, {
      durable: true,
      autoDelete: false,
      arguments: { 'x-queue-type': 'quorum' },
    });
    await this.amqpChannel.bindQueue(queueName, exchangeName, routingKey);
    this.preparedBindings.add(key);
  }

  private async ensureConnection(): Promise<boolean> {
    if (!this.amqpChannel) {""",
)
replace_once(
    path,
    """            await this.amqpChannel.assertExchange(exchangeName, 'topic', {
              durable: true,
              autoDelete: false,
            });

            const eventName = event.replace(/_/g, '.').toLowerCase();

            const queueName = `${instanceName}.${eventName}`;

            await this.amqpChannel.assertQueue(queueName, {
              durable: true,
              autoDelete: false,
              arguments: {
                'x-queue-type': 'quorum',
              },
            });

            await this.amqpChannel.bindQueue(queueName, exchangeName, eventName);""",
    """            const eventName = event.replace(/_/g, '.').toLowerCase();
            const queueName = `${instanceName}.${eventName}`;
            await this.ensureBinding(exchangeName, queueName, eventName);""",
)
replace_once(
    path,
    """          await this.amqpChannel.assertExchange(exchangeName, 'topic', {
            durable: true,
            autoDelete: false,
          });

          const queueName = prefixKey
            ? `${prefixKey}.${event.replace(/_/g, '.').toLowerCase()}`
            : event.replace(/_/g, '.').toLowerCase();

          await this.amqpChannel.assertQueue(queueName, {
            durable: true,
            autoDelete: false,
            arguments: {
              'x-queue-type': 'quorum',
            },
          });

          await this.amqpChannel.bindQueue(queueName, exchangeName, event);""",
    """          const queueName = prefixKey
            ? `${prefixKey}.${event.replace(/_/g, '.').toLowerCase()}`
            : event.replace(/_/g, '.').toLowerCase();
          await this.ensureBinding(exchangeName, queueName, event);""",
)
replace_once(
    path,
    """      if (this.amqpChannel) {
        await this.amqpChannel.close();
        this.amqpChannel = null;
      }""",
    """      if (this.amqpChannel) {
        await this.amqpChannel.close();
        this.amqpChannel = null;
      }
      this.preparedBindings.clear();""",
)

# 7) Proxy same-origin /manager/docs/* to the private DOCs service root.
path = 'src/api/routes/view.router.ts'
replace_once(
    path,
    """      const docsBasePath = process.env.ARGWS_CONNECT_DOCS_INTERNAL_BASE_PATH?.trim() || '/manager/docs';

      this.router.use('/docs', async (req, res) => {
        if (!['GET', 'HEAD'].includes(req.method)) {
          return res.status(405).send('Method Not Allowed');
        }

        try {
          const suffix = req.url === '/' ? '/' : req.url;
          const target = new URL(`${docsBasePath.replace(/\\/$/, '')}${suffix}`, docsInternalUrl);
          const upstream = await fetch(target, {
            method: req.method,
            headers: {
              accept: req.get('accept') || '*/*',
              'accept-language': req.get('accept-language') || 'pt-BR,pt;q=0.9',
            },
          });

          res.status(upstream.status);
          for (const header of ['content-type', 'cache-control', 'etag', 'last-modified']) {
            const value = upstream.headers.get(header);
            if (value) res.set(header, value);
          }

          if (req.method === 'HEAD') return res.end();
          const body = Buffer.from(await upstream.arrayBuffer());
          return res.send(body);
        } catch {
          return res.status(502).type('text/plain').send('Documentação interna temporariamente indisponível.');
        }
      });""",
    """      const docsBasePath = process.env.ARGWS_CONNECT_DOCS_INTERNAL_BASE_PATH?.trim() || '/manager/docs';

      this.router.use('/docs', async (req, res) => {
        if (!['GET', 'HEAD'].includes(req.method)) {
          return res.status(405).send('Method Not Allowed');
        }

        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10_000);
        try {
          // The DOCs container serves its application at `/`. The public-facing
          // prefix belongs to this API router only, so strip `/manager/docs`
          // before forwarding. Relative DOCs assets then resolve back through
          // this same endpoint without a second public hostname.
          const suffix = req.url === '/' ? '/' : req.url.startsWith('/') ? req.url : `/${req.url}`;
          const target = new URL(suffix, `${docsInternalUrl.replace(/\\/$/, '')}/`);
          const upstream = await fetch(target, {
            method: req.method,
            signal: controller.signal,
            headers: {
              accept: req.get('accept') || '*/*',
              'accept-language': req.get('accept-language') || 'pt-BR,pt;q=0.9',
              ...(req.get('if-none-match') ? { 'if-none-match': req.get('if-none-match') as string } : {}),
              ...(req.get('if-modified-since')
                ? { 'if-modified-since': req.get('if-modified-since') as string }
                : {}),
              ...(req.get('range') ? { range: req.get('range') as string } : {}),
            },
          });

          res.status(upstream.status);
          for (const header of [
            'content-type',
            'cache-control',
            'etag',
            'last-modified',
            'content-range',
            'accept-ranges',
          ]) {
            const value = upstream.headers.get(header);
            if (value) res.set(header, value);
          }

          const location = upstream.headers.get('location');
          if (location) {
            try {
              const redirected = new URL(location, target);
              const internal = new URL(docsInternalUrl);
              if (redirected.origin === internal.origin) {
                res.set('location', `${docsBasePath.replace(/\\/$/, '')}${redirected.pathname}${redirected.search}`);
              } else {
                res.set('location', location);
              }
            } catch {
              res.set('location', location);
            }
          }

          res.set('X-Connect-Docs-Proxy', 'internal');
          if (req.method === 'HEAD' || upstream.status === 304) return res.end();
          const body = Buffer.from(await upstream.arrayBuffer());
          return res.send(body);
        } catch {
          return res.status(502).type('text/plain').send('Documentação interna temporariamente indisponível.');
        } finally {
          clearTimeout(timeout);
        }
      });""",
)
