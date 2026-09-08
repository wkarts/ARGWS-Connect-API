import { Events } from '@api/types/wa.types';
import { Database } from '@config/env.config';
import { Pool } from 'pg';

import {
  zapoIsOwnAccountJid,
  zapoJidUser,
  zapoKnownLidJid,
  zapoLidJid,
  zapoPhoneJid,
  zapoTryNormalizeJid,
} from './zapo.jid.helpers';
import { ZapoInteractiveStartupService } from './zapo.provider.interactive.extensions';

type ZapoContactIdentityRow = {
  jid?: string | null;
  display_name?: string | null;
  push_name?: string | null;
  lid?: string | null;
  phone_number?: string | null;
};

type ContactIdentity = {
  remoteJid: string;
  name?: string;
  avatar?: string;
  aliases: string[];
};

type NativeCallIdentityHint = {
  phoneJid?: string;
  lidJid?: string;
  pushName?: string;
  observedAt: number;
};

/**
 * Canonical identity layer for the ZAPO provider.
 *
 * PN and LID are different identifiers for the same WhatsApp account. A LID
 * is opaque and is NEVER converted to a phone number by parsing its digits.
 * The adapter accepts LID -> PN only when ZAPO/WhatsApp supplied the mapping:
 * native call identity fields, message alternate identities, PnForLidChat or
 * the ZAPO contact store. This mirrors ZAPO's own identity model and prevents
 * a LID from being displayed or persisted as somebody else's phone number.
 */
export class ZapoIdentityStartupService extends ZapoInteractiveStartupService {
  private readonly lidToPhone = new Map<string, string>();
  private readonly contactsByIdentity = new Map<string, ContactIdentity>();
  private readonly profilePictureVerifiedAt = new Map<string, number>();
  private readonly nativeCallHints = new Map<string, NativeCallIdentityHint>();
  private readonly nativeIdentityBoundClients = new WeakSet<object>();
  private readonly profilePictureRefreshTtlMs = 6 * 60 * 60 * 1000;
  private readonly callHintTtlMs = 10 * 60 * 1000;

  public async connectToWhatsapp(): Promise<any> {
    const client = await super.connectToWhatsapp();
    this.bindNativeIdentityEvents(client);
    return client;
  }

  public async prepareQrConnection(): Promise<any> {
    const client = await super.prepareQrConnection();
    this.bindNativeIdentityEvents(client);
    return client;
  }

  public async preparePairingConnection(number: string): Promise<any> {
    const client = await super.preparePairingConnection(number);
    this.bindNativeIdentityEvents(client);
    return client;
  }

  public async listCalls() {
    const calls = await super.listCalls();
    return Promise.all(calls.map((call: any) => this.enrichCall(call)));
  }

  public async sendDataWebhook<T extends object = any>(
    event: Events,
    data: T,
    local = true,
    integration?: string[],
    extra?: Record<string, any>,
  ) {
    if (event === Events.CALL && data && typeof data === 'object') {
      const payload = data as any;
      if (payload.call && typeof payload.call === 'object') {
        data = { ...payload, call: await this.enrichCall(payload.call) } as T;
      } else if (payload.callId || payload.peerJid || payload.displayPeerJid) {
        data = (await this.enrichCall(payload)) as T;
      }
    }
    return super.sendDataWebhook(event, data, local, integration, extra);
  }

  private bindNativeIdentityEvents(client: any): void {
    if (!client || (typeof client !== 'object' && typeof client !== 'function')) return;
    if (this.nativeIdentityBoundClients.has(client)) return;
    this.nativeIdentityBoundClients.add(client);

    // The core ZAPO call event carries the identity metadata that the VoIP
    // media plugin does not need to retain: callerPnJid, senderLidJid and name.
    client.on('call', (event: any) => {
      void this.handleNativeCallIdentity(event).catch((error: Error) => this.logger.error(error));
    });

    // Incoming message keys expose the primary and alternate identity forms.
    client.on('message', (event: any) => {
      this.rememberEventAlias(event?.key?.remoteJid, event?.key?.remoteJidAlt);
      this.rememberEventAlias(event?.key?.participant, event?.key?.participantAlt);
      this.rememberEventAlias(event?.key?.recipientJid, event?.key?.recipientAlt);
    });

    // PnForLidChat is ZAPO/WhatsApp's own app-state mapping for a chat whose
    // primary identity is a LID. Consume it rather than deriving PN from LID.
    const rememberPnForLid = (event: any) => {
      if (event?.schema !== 'PnForLidChat' || event?.operation === 'remove') return;
      const lidJid = zapoKnownLidJid(event?.lid);
      const phoneJid = zapoPhoneJid(event?.pnJid);
      if (lidJid && phoneJid) {
        const mapping = this.rememberAlias(lidJid, phoneJid);
        if (mapping?.changed) {
          void this.mergeCanonicalIdentityRecords(lidJid, phoneJid).catch((error: Error) => this.logger.warn(error));
        }
      }
    };
    client.on('mutation', rememberPnForLid);
    client.on('mutation_send', rememberPnForLid);

    // ZAPO already updates Signal bookkeeping on LID changes. Move our learned
    // PN mapping to the new LID so Manager/API caches remain coherent.
    client.on('mex_notification', (event: any) => {
      if (event?.kind !== 'lid_change') return;
      this.handleLidChange(event?.oldLidJid, event?.newLidJid);
    });
  }

  private pruneCallHints(now = Date.now()): void {
    for (const [callId, hint] of this.nativeCallHints) {
      if (now - hint.observedAt > this.callHintTtlMs) this.nativeCallHints.delete(callId);
    }
  }

  private async handleNativeCallIdentity(event: any): Promise<void> {
    const callId = String(event?.callId || '').trim();
    if (!callId) return;

    const now = Date.now();
    this.pruneCallHints(now);
    const previous = this.nativeCallHints.get(callId);

    const phoneJid = zapoPhoneJid(event?.callerPnJid || event?.callerPn) || previous?.phoneJid;
    const lidJid =
      zapoKnownLidJid(event?.senderLidJid) ||
      zapoLidJid(event?.callCreatorJid) ||
      zapoLidJid(event?.chatJid) ||
      previous?.lidJid;

    const credentials = this.client?.getCredentials?.();
    const isOwnPeer = Boolean(phoneJid && zapoIsOwnAccountJid(phoneJid, credentials?.meJid, credentials?.meLid));
    if (phoneJid && lidJid && !isOwnPeer) {
      const mapping = this.rememberAlias(lidJid, phoneJid);
      if (mapping?.changed) {
        void this.mergeCanonicalIdentityRecords(lidJid, phoneJid).catch((error: Error) => this.logger.warn(error));
      }
    }

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
    }
  }

  private async persistNativeContactHint(phoneJid: string, pushName?: string): Promise<void> {
    const database = this.configService.get<Database>('DATABASE');
    if (!database.SAVE_DATA.CONTACTS || !this.instanceId) return;

    const existing = await this.prismaRepository.contact.findUnique({
      where: { remoteJid_instanceId: { remoteJid: phoneJid, instanceId: this.instanceId } },
    });

    let profilePicUrl = existing?.profilePicUrl || undefined;
    if (this.shouldRefreshProfilePicture(phoneJid) && this.connectionStatus?.state === 'open') {
      const picture = await this.profilePicture(phoneJid).catch(() => null);
      if (picture?.profilePictureUrl) profilePicUrl = picture.profilePictureUrl;
    }

    const currentName = this.sanitizeRemoteName(existing?.pushName);
    const candidateName = this.sanitizeRemoteName(pushName);
    const name = currentName || candidateName;
    await this.prismaRepository.contact.upsert({
      where: { remoteJid_instanceId: { remoteJid: phoneJid, instanceId: this.instanceId } },
      update: {
        ...(!currentName && candidateName ? { pushName: candidateName } : {}),
        ...(profilePicUrl ? { profilePicUrl } : {}),
      },
      create: {
        remoteJid: phoneJid,
        pushName: name,
        profilePicUrl,
        instanceId: this.instanceId,
      },
    });

    this.cacheContactIdentity({
      remoteJid: phoneJid,
      name,
      avatar: profilePicUrl,
      aliases: [phoneJid],
    });
  }

  private handleLidChange(oldValue: unknown, newValue: unknown): void {
    const oldLidJid = zapoKnownLidJid(oldValue);
    const newLidJid = zapoKnownLidJid(newValue);
    if (!oldLidJid || !newLidJid || oldLidJid === newLidJid) return;

    const phoneJid = this.lidToPhone.get(this.identityKey(oldLidJid));
    if (phoneJid) {
      this.lidToPhone.delete(this.identityKey(oldLidJid));
      this.lidToPhone.set(this.identityKey(newLidJid), phoneJid);
    }

    for (const [callId, hint] of this.nativeCallHints) {
      if (hint.lidJid === oldLidJid) {
        this.nativeCallHints.set(callId, { ...hint, lidJid: newLidJid, observedAt: Date.now() });
      }
    }

    if (phoneJid) {
      void this.mergeCanonicalIdentityRecords(oldLidJid, phoneJid).catch((error: Error) => this.logger.warn(error));
      const identity = this.contactsByIdentity.get(this.identityKey(phoneJid));
      if (identity) {
        identity.aliases = [...new Set([...identity.aliases, newLidJid, phoneJid])];
        this.cacheContactIdentity(identity);
      }
    }
  }

  private identityKey(value: unknown): string {
    return (zapoTryNormalizeJid(value) || String(value ?? '').trim()).toLowerCase();
  }

  private rememberAlias(
    first: unknown,
    second: unknown,
    aliases?: Map<string, string>,
  ): { lidJid: string; phoneJid: string; changed: boolean } | null {
    const firstJid = zapoTryNormalizeJid(first);
    const secondJid = zapoTryNormalizeJid(second);
    if (!firstJid || !secondJid || firstJid === secondJid) return null;

    const lidJid = zapoLidJid(firstJid) || zapoLidJid(secondJid);
    if (!lidJid) return null;
    const other = lidJid === firstJid ? secondJid : firstJid;
    const phoneJid = zapoPhoneJid(other);
    if (!phoneJid) return null;

    aliases?.set(lidJid, phoneJid);
    const key = this.identityKey(lidJid);
    const previous = this.lidToPhone.get(key);
    if (previous === phoneJid) return { lidJid, phoneJid, changed: false };
    this.lidToPhone.set(key, phoneJid);
    return { lidJid, phoneJid, changed: true };
  }

  private rememberEventAlias(first: unknown, second: unknown): void {
    const mapping = this.rememberAlias(first, second);
    if (!mapping?.changed) return;
    void this.mergeCanonicalIdentityRecords(mapping.lidJid, mapping.phoneJid).catch((error: Error) =>
      this.logger.warn(`ZAPO alias merge failed: ${error?.message || error}`),
    );
  }

  private async mergeCanonicalIdentityRecords(lidJid: string, phoneJid: string): Promise<void> {
    if (!this.instanceId || !lidJid || !phoneJid || lidJid === phoneJid) return;

    const [lidContact, phoneContact, lidChat, phoneChat] = await Promise.all([
      this.prismaRepository.contact.findUnique({
        where: { remoteJid_instanceId: { remoteJid: lidJid, instanceId: this.instanceId } },
      }),
      this.prismaRepository.contact.findUnique({
        where: { remoteJid_instanceId: { remoteJid: phoneJid, instanceId: this.instanceId } },
      }),
      this.prismaRepository.chat.findUnique({
        where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid: lidJid } },
      }),
      this.prismaRepository.chat.findUnique({
        where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid: phoneJid } },
      }),
    ]);

    const contactName =
      this.sanitizeRemoteName(phoneContact?.pushName) || this.sanitizeRemoteName(lidContact?.pushName);
    const avatar = phoneContact?.profilePicUrl || lidContact?.profilePicUrl || undefined;
    if (phoneContact || lidContact) {
      await this.prismaRepository.contact.upsert({
        where: { remoteJid_instanceId: { remoteJid: phoneJid, instanceId: this.instanceId } },
        update: {
          ...(!this.sanitizeRemoteName(phoneContact?.pushName) && contactName ? { pushName: contactName } : {}),
          ...(!phoneContact?.profilePicUrl && avatar ? { profilePicUrl: avatar } : {}),
        },
        create: {
          remoteJid: phoneJid,
          pushName: contactName,
          profilePicUrl: avatar,
          instanceId: this.instanceId,
        },
      });
    }

    const chatName = this.sanitizeRemoteName(phoneChat?.name) || this.sanitizeRemoteName(lidChat?.name) || contactName;
    if (phoneChat || lidChat) {
      await this.prismaRepository.chat.upsert({
        where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid: phoneJid } },
        update: {
          ...(!this.sanitizeRemoteName(phoneChat?.name) && chatName ? { name: chatName } : {}),
          unreadMessages: Math.max(phoneChat?.unreadMessages || 0, lidChat?.unreadMessages || 0),
        },
        create: {
          remoteJid: phoneJid,
          name: chatName,
          unreadMessages: Math.max(phoneChat?.unreadMessages || 0, lidChat?.unreadMessages || 0),
          instanceId: this.instanceId,
        },
      });
    }

    await Promise.all([
      this.prismaRepository.contact.deleteMany({ where: { instanceId: this.instanceId, remoteJid: lidJid } }),
      this.prismaRepository.chat.deleteMany({ where: { instanceId: this.instanceId, remoteJid: lidJid } }),
    ]);

    const identity = this.contactsByIdentity.get(this.identityKey(phoneJid));
    if (identity) {
      identity.aliases = [...new Set([...identity.aliases, lidJid, phoneJid])];
      this.cacheContactIdentity(identity);
    }
  }

  private collectMessageAliases(messages: Array<{ key: unknown }>, aliases: Map<string, string>): void {
    for (const message of messages) {
      const key = message.key as any;
      this.rememberAlias(key?.remoteJid, key?.remoteJidAlt, aliases);
      this.rememberAlias(key?.participant, key?.participantAlt, aliases);
      this.rememberAlias(key?.recipientJid ?? key?.recipient, key?.recipientAlt, aliases);
    }
  }

  private async loadZapoContactRows(): Promise<ZapoContactIdentityRow[]> {
    const database = this.configService.get<Database>('DATABASE');
    if (database.PROVIDER !== 'postgresql' || !database.CONNECTION.URI || !this.instanceId) return [];

    const prefix = process.env.ZAPO_STORE_TABLE_PREFIX || 'zapo_';
    if (!/^[A-Za-z0-9_]*$/.test(prefix)) {
      this.logger.warn('ZAPO_STORE_TABLE_PREFIX contains unsafe characters; PN/LID reconciliation skipped');
      return [];
    }

    const pool = new Pool({ connectionString: database.CONNECTION.URI });
    try {
      const tableName = `${prefix}mailbox_contacts`;
      const exists = await pool.query('SELECT to_regclass($1) AS table_name', [tableName]);
      if (!exists.rows?.[0]?.table_name) return [];

      return (
        await pool.query<ZapoContactIdentityRow>(
          `SELECT jid, display_name, push_name, lid, phone_number
           FROM "${tableName}" WHERE session_id = $1`,
          [this.instanceId],
        )
      ).rows;
    } finally {
      await pool.end().catch(() => undefined);
    }
  }

  private async reconcileIdentityRows(): Promise<void> {
    const rows = await this.loadZapoContactRows();
    const aliases = new Map<string, string>();
    const preferredNames = new Map<string, string>();

    for (const row of rows) {
      const jid = zapoTryNormalizeJid(row.jid);
      const explicitLid = zapoKnownLidJid(row.lid);
      const phoneNumber = zapoPhoneJid(row.phone_number);
      const jidPhone = zapoPhoneJid(jid);
      const phoneJid = phoneNumber || jidPhone;
      const lidJid = explicitLid || zapoLidJid(jid);
      const displayName = this.sanitizeRemoteName(row.display_name) || this.sanitizeRemoteName(row.push_name);

      if (lidJid && phoneJid) this.rememberAlias(lidJid, phoneJid, aliases);
      if (displayName && phoneJid) preferredNames.set(phoneJid, displayName);
    }

    const [storedContacts, storedChats, storedMessages] = await Promise.all([
      this.prismaRepository.contact.findMany({ where: { instanceId: this.instanceId } }),
      this.prismaRepository.chat.findMany({ where: { instanceId: this.instanceId } }),
      this.prismaRepository.message.findMany({
        where: { instanceId: this.instanceId },
        orderBy: { messageTimestamp: 'desc' },
        take: 5000,
        select: { id: true, key: true },
      }),
    ]);

    this.collectMessageAliases(storedMessages, aliases);

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

    const contactsByJid = new Map<string, (typeof storedContacts)[number]>();
    for (const contact of storedContacts) {
      const remoteJid = zapoTryNormalizeJid(contact.remoteJid);
      if (remoteJid) contactsByJid.set(remoteJid, contact);
    }

    const chatsByJid = new Map<string, (typeof storedChats)[number]>();
    for (const chat of storedChats) {
      const remoteJid = zapoTryNormalizeJid(chat.remoteJid);
      if (remoteJid) chatsByJid.set(remoteJid, chat);
    }

    for (const [lidJid, phoneJid] of aliases) {
      const lidContact = contactsByJid.get(lidJid);
      const phoneContact = contactsByJid.get(phoneJid);
      const lidChat = chatsByJid.get(lidJid);
      const phoneChat = chatsByJid.get(phoneJid);
      const preferredName = preferredNames.get(phoneJid);

      let profilePicUrl = phoneContact?.profilePicUrl || lidContact?.profilePicUrl || undefined;
      if (this.shouldRefreshProfilePicture(phoneJid) && this.connectionStatus?.state === 'open') {
        const freshPicture = await this.profilePicture(phoneJid).catch(() => null);
        if (freshPicture?.profilePictureUrl) profilePicUrl = freshPicture.profilePictureUrl;
      }

      if (lidContact || phoneContact || preferredName) {
        const pushName =
          this.sanitizeRemoteName(phoneContact?.pushName) ||
          this.sanitizeRemoteName(lidContact?.pushName) ||
          preferredName;
        await this.prismaRepository.contact.upsert({
          where: { remoteJid_instanceId: { remoteJid: phoneJid, instanceId: this.instanceId } },
          update: {
            ...(pushName ? { pushName } : {}),
            ...(profilePicUrl ? { profilePicUrl } : {}),
          },
          create: {
            remoteJid: phoneJid,
            pushName,
            profilePicUrl,
            instanceId: this.instanceId,
          },
        });
      }

      if (lidChat || phoneChat) {
        const name =
          this.sanitizeRemoteName(phoneChat?.name) || this.sanitizeRemoteName(lidChat?.name) || preferredName;
        const unreadMessages = Math.max(phoneChat?.unreadMessages || 0, lidChat?.unreadMessages || 0);
        await this.prismaRepository.chat.upsert({
          where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid: phoneJid } },
          update: { ...(name ? { name } : {}), unreadMessages },
          create: { remoteJid: phoneJid, name, unreadMessages, instanceId: this.instanceId },
        });
      }

      await Promise.all([
        this.prismaRepository.contact.deleteMany({ where: { instanceId: this.instanceId, remoteJid: lidJid } }),
        this.prismaRepository.chat.deleteMany({ where: { instanceId: this.instanceId, remoteJid: lidJid } }),
      ]);
    }

    for (const message of storedMessages) {
      const key = message.key as any;
      const remoteJid = zapoTryNormalizeJid(key?.remoteJid);
      const participant = zapoTryNormalizeJid(key?.participant);
      const phoneJid = remoteJid ? aliases.get(remoteJid) : undefined;
      const participantPhoneJid = participant ? aliases.get(participant) : undefined;
      if (!phoneJid && !participantPhoneJid) continue;

      await this.prismaRepository.message.update({
        where: { id: message.id },
        data: {
          key: {
            ...key,
            ...(phoneJid && remoteJid ? { remoteJid: phoneJid, remoteJidAlt: remoteJid } : {}),
            ...(participantPhoneJid && participant
              ? { participant: participantPhoneJid, participantAlt: participant }
              : {}),
          },
        },
      });
    }

    await this.refreshContactCache(aliases);
  }

  private shouldRefreshProfilePicture(phoneJid: string): boolean {
    const key = this.identityKey(phoneJid);
    const previous = this.profilePictureVerifiedAt.get(key) || 0;
    if (Date.now() - previous < this.profilePictureRefreshTtlMs) return false;
    this.profilePictureVerifiedAt.set(key, Date.now());
    return true;
  }

  private cacheContactIdentity(identity: ContactIdentity): void {
    const keys = new Set<string>();
    for (const alias of identity.aliases) {
      keys.add(this.identityKey(alias));
      const user = zapoJidUser(alias);
      if (user) keys.add(user.toLowerCase());
    }
    keys.add(this.identityKey(identity.remoteJid));
    const remoteUser = zapoJidUser(identity.remoteJid);
    if (remoteUser) keys.add(remoteUser.toLowerCase());
    for (const key of keys) this.contactsByIdentity.set(key, identity);
  }

  private async refreshContactCache(aliases = new Map<string, string>()): Promise<void> {
    const contacts = await this.prismaRepository.contact.findMany({ where: { instanceId: this.instanceId } });
    this.contactsByIdentity.clear();

    for (const contact of contacts) {
      const remoteJid = zapoTryNormalizeJid(contact.remoteJid);
      if (!remoteJid) continue;
      this.cacheContactIdentity({
        remoteJid,
        name: this.sanitizeRemoteName(contact.pushName),
        avatar: contact.profilePicUrl || undefined,
        aliases: [remoteJid],
      });
    }

    for (const [lidJid, phoneJid] of aliases) {
      const phoneUser = zapoJidUser(phoneJid);
      const identity =
        this.contactsByIdentity.get(this.identityKey(phoneJid)) ||
        (phoneUser ? this.contactsByIdentity.get(phoneUser.toLowerCase()) : undefined);
      if (!identity) continue;
      identity.aliases = [...new Set([...identity.aliases, lidJid, phoneJid])];
      this.cacheContactIdentity(identity);
      this.lidToPhone.set(this.identityKey(lidJid), phoneJid);
    }
  }

  private resolveCallPeer(call: any): string {
    const hint = call?.callId ? this.nativeCallHints.get(String(call.callId)) : undefined;
    if (hint?.phoneJid) return hint.phoneJid;

    const direction = String(call?.direction || '').toLowerCase();
    const candidates =
      direction === 'outgoing'
        ? [
            call?.displayPeerJid,
            call?.peerJid,
            call?.peerJidAlt,
            call?.peerJidRaw,
            call?.remoteJid,
            call?.to,
            call?.callerPn,
            call?.callerPnJid,
          ]
        : [
            call?.callerPn,
            call?.callerPnJid,
            call?.displayPeerJid,
            call?.peerJidAlt,
            call?.peerJid,
            call?.peerJidRaw,
            call?.remoteJid,
            call?.from,
          ];

    for (const candidate of candidates) {
      const normalized = zapoTryNormalizeJid(candidate);
      if (!normalized) continue;
      const credentials = this.client?.getCredentials?.();
      if (zapoIsOwnAccountJid(normalized, credentials?.meJid, credentials?.meLid)) continue;
      const lidJid = zapoLidJid(normalized);
      if (lidJid) {
        const phoneJid = this.lidToPhone.get(this.identityKey(lidJid));
        if (phoneJid) return phoneJid;
        continue;
      }
      const phoneJid = zapoPhoneJid(normalized);
      if (phoneJid) return phoneJid;
    }

    return zapoTryNormalizeJid(call?.peerJidRaw || call?.peerJid || call?.displayPeerJid) || '';
  }

  private localProfileNames(): Set<string> {
    const credentials = this.client?.getCredentials?.();
    return new Set(
      [this.instance.profileName, credentials?.meDisplayName]
        .map((value) =>
          String(value || '')
            .trim()
            .toLocaleLowerCase('pt-BR'),
        )
        .filter(Boolean),
    );
  }

  private sanitizeRemoteName(value: unknown): string | undefined {
    const name = String(value || '').trim();
    if (!name || /^\+?\d+$/.test(name) || name.includes('@lid') || name.includes('@s.whatsapp.net')) return undefined;
    if (['contato', 'contato whatsapp', 'unknown', 'desconhecido'].includes(name.toLocaleLowerCase('pt-BR')))
      return undefined;
    if (this.localProfileNames().has(name.toLocaleLowerCase('pt-BR'))) return undefined;
    return name;
  }

  private safeRemoteCallName(call: any): string | undefined {
    if (String(call?.direction || '').toLowerCase() === 'outgoing') return undefined;
    for (const value of [call?.contactName, call?.pushName, call?.name]) {
      const name = this.sanitizeRemoteName(value);
      if (name) return name;
    }
    return undefined;
  }

  private async storedCallIdentity(phoneJid: string): Promise<ContactIdentity | undefined> {
    if (!phoneJid || !this.instanceId) return undefined;
    const phoneUser = zapoJidUser(phoneJid);
    const cached =
      this.contactsByIdentity.get(this.identityKey(phoneJid)) ||
      (phoneUser ? this.contactsByIdentity.get(phoneUser.toLowerCase()) : undefined);
    if (cached) return cached;

    const [contact, chat] = await Promise.all([
      this.prismaRepository.contact.findUnique({
        where: { remoteJid_instanceId: { remoteJid: phoneJid, instanceId: this.instanceId } },
      }),
      this.prismaRepository.chat.findUnique({
        where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid: phoneJid } },
      }),
    ]);
    if (!contact && !chat) return undefined;

    const identity: ContactIdentity = {
      remoteJid: phoneJid,
      name: this.sanitizeRemoteName(contact?.pushName) || this.sanitizeRemoteName(chat?.name),
      avatar: contact?.profilePicUrl || undefined,
      aliases: [phoneJid],
    };
    this.cacheContactIdentity(identity);
    return identity;
  }

  private async enrichCall(call: any) {
    if (!call || typeof call !== 'object') return call;

    this.pruneCallHints();
    const hint = call?.callId ? this.nativeCallHints.get(String(call.callId)) : undefined;
    const resolvedPeer = this.resolveCallPeer(call);
    const phoneJid = zapoPhoneJid(resolvedPeer);
    const rawPeerJid = zapoTryNormalizeJid(call.peerJidRaw || call.peerJid || call.displayPeerJid);
    const rawLidJid = hint?.lidJid || zapoLidJid(rawPeerJid) || undefined;
    const contact = phoneJid ? await this.storedCallIdentity(phoneJid) : undefined;
    const hintedName =
      String(call?.direction || '').toLowerCase() === 'incoming' ? this.sanitizeRemoteName(hint?.pushName) : undefined;
    const contactName = contact?.name || hintedName || this.safeRemoteCallName(call);

    let profilePicUrl = contact?.avatar;
    if (
      phoneJid &&
      !profilePicUrl &&
      this.connectionStatus?.state === 'open' &&
      this.shouldRefreshProfilePicture(phoneJid)
    ) {
      const picture = await this.profilePicture(phoneJid).catch(() => null);
      profilePicUrl = picture?.profilePictureUrl || undefined;
      if (profilePicUrl) {
        await this.prismaRepository.contact.updateMany({
          where: { instanceId: this.instanceId, remoteJid: phoneJid },
          data: { profilePicUrl },
        });
      }
    }

    const phoneNumber = phoneJid ? zapoJidUser(phoneJid) || undefined : undefined;
    return {
      ...call,
      peerJid: phoneJid || rawPeerJid || call.peerJid,
      displayPeerJid: phoneJid || undefined,
      peerJidRaw: rawPeerJid || call.peerJidRaw,
      peerJidAlt: rawLidJid || call.peerJidAlt,
      callerPnJid: phoneJid || call.callerPnJid,
      senderLidJid: rawLidJid || call.senderLidJid,
      number: phoneNumber,
      name: contactName,
      pushName: contactName,
      contactName,
      profilePicUrl,
      identityResolved: Boolean(phoneJid),
      contactResolved: Boolean(contact),
      identitySource: phoneJid
        ? hint?.phoneJid
          ? 'zapo-call'
          : rawLidJid
            ? 'zapo-lid-map'
            : 'zapo-pn'
        : 'unresolved-lid',
    };
  }
}
