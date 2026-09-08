import { Query } from '@api/repository/repository.service';
import { Events } from '@api/types/wa.types';
import { Database } from '@config/env.config';
import { Contact } from '@prisma/client';
import { createJid } from '@utils/createJid';
import { Pool } from 'pg';

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

/**
 * Canonical identity layer for the ZAPO provider.
 *
 * WhatsApp may address the same person by PN JID and LID. The ZAPO store and
 * the persisted message keys can contain both forms. This facade reconciles
 * every verified alias into the canonical Connect|API Contact/Chat rows and
 * prevents protocol identifiers or the local account profile from leaking as
 * the remote identity shown by calls.
 */
export class ZapoIdentityStartupService extends ZapoInteractiveStartupService {
  private readonly lidToPhone = new Map<string, string>();
  private readonly contactsByIdentity = new Map<string, ContactIdentity>();
  private readonly profilePicturesVerified = new Set<string>();
  private identityRefreshPromise: Promise<void> | null = null;
  private identityRefreshAt = 0;
  private readonly identityRefreshTtlMs = 30_000;

  public async connectToWhatsapp(): Promise<any> {
    const client = await super.connectToWhatsapp();
    void this.reconcileIdentities(true).catch((error: Error) => this.logger.error(error));
    return client;
  }

  public async prepareQrConnection(): Promise<any> {
    const client = await super.prepareQrConnection();
    void this.reconcileIdentities(true).catch((error: Error) => this.logger.error(error));
    return client;
  }

  public async preparePairingConnection(number: string): Promise<any> {
    const client = await super.preparePairingConnection(number);
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

  private normalizeIdentityJid(value: unknown): string {
    return String(value ?? '')
      .trim()
      .replace(/:\d+(?=@)/, '');
  }

  private normalizePhoneJid(value: unknown): string {
    const raw = this.normalizeIdentityJid(value);
    if (!raw || raw.endsWith('@lid') || raw.endsWith('@g.us') || raw.endsWith('@broadcast')) return '';
    if (raw.endsWith('@s.whatsapp.net')) return raw;
    if (raw.includes('@')) return '';
    const digits = raw.replace(/\D/g, '');
    return digits ? createJid(digits) : '';
  }

  private normalizeLidJid(value: unknown): string {
    const raw = this.normalizeIdentityJid(value);
    if (!raw) return '';
    if (raw.endsWith('@lid')) return raw;
    if (raw.includes('@')) return '';
    const digits = raw.replace(/\D/g, '');
    return digits ? `${digits}@lid` : '';
  }

  private identityKey(value: unknown): string {
    return this.normalizeIdentityJid(value).toLowerCase();
  }

  private isPhoneJid(value: unknown): boolean {
    return this.normalizeIdentityJid(value).endsWith('@s.whatsapp.net');
  }

  private registerAlias(aliases: Map<string, string>, first: unknown, second: unknown): void {
    const left = this.normalizeIdentityJid(first);
    const right = this.normalizeIdentityJid(second);
    if (!left || !right || left === right) return;

    const lidJid = left.endsWith('@lid') ? left : right.endsWith('@lid') ? right : '';
    const other = lidJid === left ? right : left;
    const phoneJid = this.normalizePhoneJid(other);
    if (!lidJid || !phoneJid) return;

    aliases.set(lidJid, phoneJid);
    this.lidToPhone.set(this.identityKey(lidJid), phoneJid);
  }

  private collectMessageAliases(messages: Array<{ key: unknown }>, aliases: Map<string, string>): void {
    for (const message of messages) {
      const key = message.key as any;
      this.registerAlias(aliases, key?.remoteJid, key?.remoteJidAlt);
      this.registerAlias(aliases, key?.participant, key?.participantAlt);
      this.registerAlias(aliases, key?.recipient, key?.recipientAlt);
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
      const jid = this.normalizeIdentityJid(row.jid);
      const explicitLid = this.normalizeLidJid(row.lid);
      const phoneNumber = this.normalizePhoneJid(row.phone_number);
      const jidPhone = this.isPhoneJid(jid) ? jid : '';
      const phoneJid = phoneNumber || jidPhone;
      const lidJid = explicitLid || (jid.endsWith('@lid') ? jid : '');
      const displayName = String(row.display_name || row.push_name || '').trim();

      if (lidJid && phoneJid) this.registerAlias(aliases, lidJid, phoneJid);
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

    // Historical and live messages retain the verified PN/LID pair in
    // remoteJid/remoteJidAlt (and participant alternatives). This provides a
    // second authoritative source when an incoming call arrives before the
    // mailbox contact sync has completed.
    this.collectMessageAliases(storedMessages, aliases);

    const contactsByJid = new Map(
      storedContacts.map((contact) => [this.normalizeIdentityJid(contact.remoteJid), contact]),
    );
    const chatsByJid = new Map(storedChats.map((chat) => [this.normalizeIdentityJid(chat.remoteJid), chat]));

    for (const [lidJid, phoneJid] of aliases) {
      const lidContact = contactsByJid.get(lidJid);
      const phoneContact = contactsByJid.get(phoneJid);
      const lidChat = chatsByJid.get(lidJid);
      const phoneChat = chatsByJid.get(phoneJid);
      const preferredName = preferredNames.get(phoneJid);
      const identityKey = this.identityKey(phoneJid);

      let profilePicUrl = phoneContact?.profilePicUrl || lidContact?.profilePicUrl || undefined;
      if (!this.profilePicturesVerified.has(identityKey) && this.connectionStatus?.state === 'open') {
        this.profilePicturesVerified.add(identityKey);
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
      const remoteJid = this.normalizeIdentityJid(key?.remoteJid);
      const participant = this.normalizeIdentityJid(key?.participant);
      const phoneJid = aliases.get(remoteJid);
      const participantPhoneJid = aliases.get(participant);
      if (!phoneJid && !participantPhoneJid) continue;

      await this.prismaRepository.message.update({
        where: { id: message.id },
        data: {
          key: {
            ...key,
            ...(phoneJid ? { remoteJid: phoneJid, remoteJidAlt: remoteJid } : {}),
            ...(participantPhoneJid
              ? { participant: participantPhoneJid, participantAlt: participant }
              : {}),
          },
        },
      });
    }

    await this.refreshContactCache(aliases);
  }

  private async refreshContactCache(aliases = new Map<string, string>()): Promise<void> {
    const contacts = await this.prismaRepository.contact.findMany({ where: { instanceId: this.instanceId } });
    this.contactsByIdentity.clear();

    for (const contact of contacts) {
      const remoteJid = this.normalizeIdentityJid(contact.remoteJid);
      const identity: ContactIdentity = {
        remoteJid,
        name: contact.pushName || undefined,
        avatar: contact.profilePicUrl || undefined,
        aliases: [remoteJid],
      };
      this.contactsByIdentity.set(this.identityKey(remoteJid), identity);
      this.contactsByIdentity.set(this.identityKey(remoteJid.split('@')[0]), identity);
    }

    for (const [lidJid, phoneJid] of aliases) {
      const identity =
        this.contactsByIdentity.get(this.identityKey(phoneJid)) ||
        this.contactsByIdentity.get(this.identityKey(phoneJid.split('@')[0]));
      if (!identity) continue;
      identity.aliases = [...new Set([...identity.aliases, lidJid, phoneJid])];
      this.contactsByIdentity.set(this.identityKey(lidJid), identity);
      this.contactsByIdentity.set(this.identityKey(lidJid.split('@')[0]), identity);
      this.lidToPhone.set(this.identityKey(lidJid), phoneJid);
    }
  }

  private resolveCallPeer(call: any): string {
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
      const normalized = this.normalizeIdentityJid(candidate);
      if (!normalized) continue;
      if (normalized.endsWith('@lid')) {
        const phoneJid = this.lidToPhone.get(this.identityKey(normalized));
        if (phoneJid) return phoneJid;
        continue;
      }
      const phoneJid = this.normalizePhoneJid(normalized);
      if (phoneJid) return phoneJid;
    }

    return this.normalizeIdentityJid(call?.peerJidRaw || call?.peerJid || call?.displayPeerJid || '');
  }

  private localProfileNames(): Set<string> {
    const credentials = this.client?.getCredentials?.();
    return new Set(
      [this.instance.profileName, credentials?.meDisplayName]
        .map((value) => String(value || '').trim().toLocaleLowerCase('pt-BR'))
        .filter(Boolean),
    );
  }

  private safeRemoteCallName(call: any): string | undefined {
    // Outbound call objects may carry the local WhatsApp profile name. Never
    // use an unverified raw name for outgoing calls: the remote contact name
    // must come from the canonical Contact/Chat identity instead.
    if (String(call?.direction || '').toLowerCase() === 'outgoing') return undefined;

    const localNames = this.localProfileNames();
    for (const value of [call?.contactName, call?.pushName, call?.name]) {
      const name = String(value || '').trim();
      if (!name || /^\+?\d+$/.test(name) || name.includes('@lid') || name.includes('@s.whatsapp.net')) continue;
      if (localNames.has(name.toLocaleLowerCase('pt-BR'))) continue;
      return name;
    }
    return undefined;
  }

  private async storedCallIdentity(phoneJid: string): Promise<ContactIdentity | undefined> {
    if (!phoneJid || !this.instanceId) return undefined;
    const cached =
      this.contactsByIdentity.get(this.identityKey(phoneJid)) ||
      this.contactsByIdentity.get(this.identityKey(phoneJid.split('@')[0]));
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
    this.contactsByIdentity.set(this.identityKey(phoneJid), identity);
    this.contactsByIdentity.set(this.identityKey(phoneJid.split('@')[0]), identity);
    return identity;
  }

  private async enrichCall(call: any) {
    if (!call || typeof call !== 'object') return call;

    const resolvedPeer = this.resolveCallPeer(call);
    const phoneJid = this.normalizePhoneJid(resolvedPeer);
    const rawPeerJid = this.normalizeIdentityJid(call.peerJidRaw || call.peerJid || call.displayPeerJid);
    const rawLidJid = rawPeerJid.endsWith('@lid') ? rawPeerJid : undefined;
    const contact = phoneJid ? await this.storedCallIdentity(phoneJid) : undefined;
    const contactName = contact?.name || this.safeRemoteCallName(call);

    let profilePicUrl = contact?.avatar;
    if (phoneJid && !profilePicUrl && this.connectionStatus?.state === 'open') {
      const identityKey = this.identityKey(phoneJid);
      if (!this.profilePicturesVerified.has(identityKey)) {
        this.profilePicturesVerified.add(identityKey);
        const picture = await this.profilePicture(phoneJid).catch(() => null);
        profilePicUrl = picture?.profilePictureUrl || undefined;
        if (profilePicUrl) {
          await this.prismaRepository.contact.updateMany({
            where: { instanceId: this.instanceId, remoteJid: phoneJid },
            data: { profilePicUrl },
          });
        }
      }
    }

    const phoneNumber = phoneJid ? phoneJid.split('@')[0] : undefined;
    return {
      ...call,
      peerJid: phoneJid || rawPeerJid || call.peerJid,
      displayPeerJid: phoneJid || undefined,
      peerJidRaw: rawPeerJid || call.peerJidRaw,
      peerJidAlt: rawLidJid || call.peerJidAlt,
      number: phoneNumber,
      name: contactName,
      pushName: contactName,
      contactName,
      profilePicUrl,
      identityResolved: Boolean(phoneJid),
      contactResolved: Boolean(contact),
    };
  }
}
