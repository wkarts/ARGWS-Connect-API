import { Query } from '@api/repository/repository.service';
import { Events } from '@api/types/wa.types';
import { Database } from '@config/env.config';
import { Contact } from '@prisma/client';
import { Pool } from 'pg';

import {
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
 * native call identity fields, message alternate identities or the ZAPO
 * contact store. This mirrors ZAPO's own identity model and prevents a LID
 * from being displayed or persisted as somebody else's phone number.
 */
export class ZapoIdentityStartupService extends ZapoInteractiveStartupService {
  private readonly lidToPhone = new Map<string, string>();
  private readonly contactsByIdentity = new Map<string, ContactIdentity>();
  private readonly profilePictureVerifiedAt = new Map<string, number>();
  private readonly nativeCallHints = new Map<string, NativeCallIdentityHint>();
  private readonly nativeIdentityBoundClients = new WeakSet<object>();
  private identityRefreshPromise: Promise<void> | null = null;
  private identityRefreshAt = 0;
  private readonly identityRefreshTtlMs = 30_000;
  private readonly profilePictureRefreshTtlMs = 6 * 60 * 60 * 1000;
  private readonly callHintTtlMs = 10 * 60 * 1000;

  public async connectToWhatsapp(): Promise<any> {
    const client = await super.connectToWhatsapp();
    this.bindNativeIdentityEvents(client);
    void this.reconcileIdentities(true).catch((error: Error) => this.logger.error(error));
    return client;
  }

  public async prepareQrConnection(): Promise<any> {
    const client = await super.prepareQrConnection();
    this.bindNativeIdentityEvents(client);
    void this.reconcileIdentities(true).catch((error: Error) => this.logger.error(error));
    return client;
  }

  public async preparePairingConnection(number: string): Promise<any> {
    const client = await super.preparePairingConnection(number);
    this.bindNativeIdentityEvents(client);
    void this.reconcileIdentities(true).catch((error: Error) => this.logger.error(error));
    return client;
  }

  public async fetchContacts(query: Query<Contact>) {
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

    // Core ZAPO call events carry the identity metadata that the VoIP media
    // plugin does not need to retain: callerPnJid, senderLidJid and push name.
    client.on('call', (event: any) => {
      void this.handleNativeCallIdentity(event).catch((error: Error) => this.logger.error(error));
    });

    // Remember PN/LID pairs immediately from live traffic. The normal ZAPO
    // message event exposes primary + *Alt identity forms when WhatsApp sends
    // both, so calls arriving afterwards can resolve without a DB round-trip.
    client.on('message', (event: any) => {
      this.rememberAlias(event?.key?.remoteJid, event?.key?.remoteJidAlt);
      this.rememberAlias(event?.key?.participant, event?.key?.participantAlt);
      this.rememberAlias(event?.key?.recipientJid, event?.key?.recipientAlt);
    });

    // ZAPO already updates its Signal bookkeeping on LID changes. Move our
    // learned PN mapping to the new LID so Manager/API caches stay coherent.
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

    const phoneJid = zapoPhoneJid(event?.callerPnJid) || previous?.phoneJid;
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

    const name = pushName || existing?.pushName || undefined;
    await this.prismaRepository.contact.upsert({
      where: { remoteJid_instanceId: { remoteJid: phoneJid, instanceId: this.instanceId } },
      update: {
        ...(name ? { pushName: name } : {}),
        ...(profilePicUrl ? { profilePicUrl } : {}),
      },
      create: {
        remoteJid: phoneJid,
        pushName: name,
        profilePicUrl,
        instanceId: this.instanceId,
      },
    });

    const identity: ContactIdentity = {
      remoteJid: phoneJid,
      name,
      avatar: profilePicUrl,
      aliases: [phoneJid],
    };
    this.cacheContactIdentity(identity);
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

    this.identityRefreshAt = 0;
    void this.reconcileIdentities(true).catch((error: Error) => this.logger.error(error));
  }

  private identityKey(value: unknown): string {
    return (zapoTryNormalizeJid(value) || String(value ?? '').trim()).toLowerCase();
  }

  private rememberAlias(first: unknown, second: unknown, aliases?: Map<string, string>): void {
    const firstJid = zapoTryNormalizeJid(first);
    const secondJid = zapoTryNormalizeJid(second);
    if (!firstJid || !secondJid || firstJid === secondJid) return;

    const lidJid = zapoLidJid(firstJid) || zapoLidJid(secondJid);
    if (!lidJid) return;
    const other = lidJid === firstJid ? secondJid : firstJid;
    const phoneJid = zapoPhoneJid(other);
    if (!phoneJid) return;

    aliases?.set(lidJid, phoneJid);
    this.lidToPhone.set(this.identityKey(lidJid), phoneJid);
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

  private async reconcileIdentities(force = false): Promise<void> {
    if (!this.instanceId) return;
    if (!force && Date.now() - this.identityRefreshAt < this.identityRefreshTtlMs) return;
    if (this.identityRefreshPromise) return this.identityRefreshPromise;

    this.identityRefreshPromise = this.reconcileIdentityRows()
      .catch((error: Error) => {
        this.logger.warn(`ZAPO PN/LID reconciliation failed: ${error?.message || error}`);
      })
      .finally(() => {
        this.identityRefreshAt = Date.now();
        this.identityRefreshPromise = null;
      });

    return this.identityRefreshPromise;
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
      const displayName = String(row.display_name || row.push_name || '').trim();

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

    const contactsByJid = new Map(
      storedContacts
        .map((contact) => [zapoTryNormalizeJid(contact.remoteJid), contact] as const)
        .filter((entry): entry is readonly [string, (typeof storedContacts)[number]] => Boolean(entry[0])),
    );
    const chatsByJid = new Map(
      storedChats
        .map((chat) => [zapoTryNormalizeJid(chat.remoteJid), chat] as const)
        .filter((entry): entry is readonly [string, (typeof storedChats)[number]] => Boolean(entry[0])),
    );

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
        const pushName = preferredName || phoneContact?.pushName || lidContact?.pushName || undefined;
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
        const name = preferredName || phoneChat?.name || lidChat?.name || undefined;
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
        name: contact.pushName || undefined,
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
      name: contact?.pushName || chat?.name || undefined,
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
    if (phoneJid && !profilePicUrl && this.connectionStatus?.state === 'open' && this.shouldRefreshProfilePicture(phoneJid)) {
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
