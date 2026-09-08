import { PrismaRepository } from '@api/repository/repository.service';
import { CacheService } from '@api/services/cache.service';
import { Integration } from '@api/types/wa.types';
import { CacheConf, ConfigService, Database, ProviderSession } from '@config/env.config';
import { INSTANCE_DIR } from '@config/path.config';
import { BadRequestException, InternalServerErrorException } from '@exceptions';
import useMultiFileAuthStatePrisma from '@utils/use-multi-file-auth-state-prisma';
import { useMultiFileAuthStateRedisDb } from '@utils/use-multi-file-auth-state-redis-db';
import { BufferJSON } from 'baileys';
import fs from 'fs/promises';
import { join } from 'path';
import { Pool } from 'pg';

export type WhatsAppSessionProvider = 'WHATSAPP-BAILEYS' | 'WHATSAPP-ZAPO';

type MigrationLoss = {
  severity?: string;
  domain?: string;
  count?: number;
  reason?: string;
  [key: string]: unknown;
};

type MigrationResult = {
  data: any;
  losses: MigrationLoss[];
};

type ZapoStoreContext = {
  pool: Pool;
  store: any;
  session: any;
  tablePrefix: string;
};

const BAILEYS_KEY_CATEGORIES = [
  'app-state-sync-version',
  'app-state-sync-key',
  'sender-key-memory',
  'identity-key',
  'lid-mapping',
  'device-list',
  'sender-key',
  'pre-key',
  'session',
  'tctoken',
] as const;

const CRITICAL_MIGRATION_DOMAINS = new Set([
  'identity',
  'signedPreKey',
  'preKeys',
  'signalIdentities',
  'sessions',
  'senderKeys',
  'appStateSyncKeys',
  'appStateVersions',
]);

/**
 * Converts an existing paired WhatsApp session between Connect|API's Baileys
 * and Zapo providers without keeping both protocol clients active.
 *
 * The conversion itself is delegated to `wa-store-migrate`, the same pure
 * snapshot pipeline documented by Zapo. This service only reads/writes the
 * storage formats already used by Connect|API; it never opens a WhatsApp
 * socket and never exports authentication material through an HTTP response.
 */
export class ProviderSessionMigrationService {
  constructor(
    private readonly configService: ConfigService,
    private readonly prismaRepository: PrismaRepository,
    private readonly cache: CacheService,
  ) {}

  public isProvider(value: string): value is WhatsAppSessionProvider {
    return value === Integration.WHATSAPP_BAILEYS || value === Integration.WHATSAPP_ZAPO;
  }

  public async convert(source: WhatsAppSessionProvider, target: WhatsAppSessionProvider, data: any) {
    const from = source === Integration.WHATSAPP_BAILEYS ? 'baileys' : 'zapo';
    const to = target === Integration.WHATSAPP_BAILEYS ? 'baileys' : 'zapo';

    let result: MigrationResult;
    try {
      const { migrate } = await import('wa-store-migrate');
      result = migrate({ from, to, data, validate: true }) as MigrationResult;
    } catch (error) {
      throw new InternalServerErrorException(
        `Unable to convert WhatsApp session from ${from} to ${to}: ${(error as Error)?.message ?? error}`,
      );
    }

    const fatal = (result.losses ?? []).filter((loss) => {
      const severity = String(loss.severity).toLowerCase();
      if (severity === 'error') return true;
      return severity === 'drop' && CRITICAL_MIGRATION_DOMAINS.has(String(loss.domain));
    });
    if (fatal.length > 0) {
      throw new BadRequestException({
        message: `Session conversion ${from} -> ${to} would drop critical authentication state`,
        losses: fatal,
      });
    }

    return { data: result.data, losses: result.losses ?? [] };
  }

  public async exportSnapshot(instanceId: string, provider: WhatsAppSessionProvider): Promise<any | null> {
    if (provider === Integration.WHATSAPP_BAILEYS) return this.readBaileysSnapshot(instanceId);
    return this.readZapoSnapshot(instanceId);
  }

  public async writeSnapshot(instanceId: string, provider: WhatsAppSessionProvider, snapshot: any): Promise<void> {
    if (provider === Integration.WHATSAPP_BAILEYS) {
      await this.writeBaileysSnapshot(instanceId, snapshot);
      return;
    }
    await this.writeZapoSnapshot(instanceId, snapshot);
  }

  public async clearSnapshot(instanceId: string, provider: WhatsAppSessionProvider): Promise<void> {
    if (provider === Integration.WHATSAPP_BAILEYS) {
      await this.clearBaileysStorage(instanceId);
      return;
    }
    await this.clearZapoStorage(instanceId);
  }

  public assertMigrationStorageSupported() {
    const provider = this.configService.get<ProviderSession>('PROVIDER');
    if (provider?.ENABLED) {
      throw new BadRequestException(
        'Provider migration is disabled while PROVIDER_SESSION is enabled because the external session service does not expose key enumeration. Disable it or add a session-key listing endpoint before migrating.',
      );
    }
  }

  private decodeStoredJson(value: unknown): any {
    let current = value;
    for (let index = 0; index < 3 && typeof current === 'string'; index += 1) {
      try {
        current = JSON.parse(current, BufferJSON.reviver);
      } catch {
        break;
      }
    }
    return current;
  }

  private splitBaileysStorageKey(key: string): { category: string; id: string } | null {
    for (const category of BAILEYS_KEY_CATEGORIES) {
      const prefix = `${category}-`;
      if (key.startsWith(prefix)) {
        return { category, id: key.slice(prefix.length) };
      }
    }
    return null;
  }

  private async readBaileysSnapshot(instanceId: string): Promise<any | null> {
    this.assertMigrationStorageSupported();
    const database = this.configService.get<Database>('DATABASE');
    const cache = this.configService.get<CacheConf>('CACHE');

    let creds: any = null;
    const keys: Record<string, Record<string, unknown>> = {};

    if (cache?.REDIS.ENABLED && cache?.REDIS.SAVE_INSTANCES) {
      creds = await this.cache.hGet(instanceId, 'creds');
      const fields = await this.cache.hKeys(instanceId);
      for (const field of fields) {
        if (field === 'creds') continue;
        const parsed = this.splitBaileysStorageKey(field);
        if (!parsed) continue;
        const value = await this.cache.hGet(instanceId, field);
        if (value !== null && value !== undefined) {
          (keys[parsed.category] ??= {})[parsed.id] = value;
        }
      }
    } else if (database.SAVE_DATA.INSTANCE) {
      const row = await this.prismaRepository.session.findUnique({ where: { sessionId: instanceId } });
      creds = this.decodeStoredJson(row?.creds);

      if (cache?.REDIS.ENABLED) {
        const fields = await this.cache.hKeys(instanceId);
        for (const field of fields) {
          if (field === 'creds') continue;
          const parsed = this.splitBaileysStorageKey(field);
          if (!parsed) continue;
          const value = await this.cache.hGet(instanceId, field);
          if (value !== null && value !== undefined) {
            (keys[parsed.category] ??= {})[parsed.id] = value;
          }
        }
      } else {
        const directory = join(INSTANCE_DIR, instanceId);
        let files: string[] = [];
        try {
          files = await fs.readdir(directory);
        } catch {
          files = [];
        }

        for (const file of files) {
          if (!file.endsWith('.json')) continue;
          const stem = file.slice(0, -5);
          const parsed = this.splitBaileysStorageKey(stem);
          if (!parsed) continue;
          try {
            const raw = await fs.readFile(join(directory, file), 'utf8');
            const id = parsed.id.replace(/__/g, '/').replace(/-/g, ':');
            (keys[parsed.category] ??= {})[id] = JSON.parse(raw, BufferJSON.reviver);
          } catch {
            // Ignore a single corrupt/non-auth file; snapshot validation below
            // will fail if the required cryptographic domain is missing.
          }
        }
      }
    }

    creds = this.decodeStoredJson(creds);
    if (!creds || typeof creds !== 'object') return null;
    return { creds, keys };
  }

  private async clearBaileysStorage(instanceId: string): Promise<void> {
    this.assertMigrationStorageSupported();
    const database = this.configService.get<Database>('DATABASE');
    const cache = this.configService.get<CacheConf>('CACHE');

    if (cache?.REDIS.ENABLED) {
      await this.cache.delete(instanceId);
    }
    if (database.SAVE_DATA.INSTANCE) {
      await this.prismaRepository.session.deleteMany({ where: { sessionId: instanceId } });
    }
    await fs.rm(join(INSTANCE_DIR, instanceId), { recursive: true, force: true });
  }

  private async writeBaileysSnapshot(instanceId: string, snapshot: any): Promise<void> {
    this.assertMigrationStorageSupported();
    if (!snapshot?.creds || !snapshot?.keys) {
      throw new BadRequestException('Invalid Baileys session snapshot');
    }

    await this.clearBaileysStorage(instanceId);

    const database = this.configService.get<Database>('DATABASE');
    const cache = this.configService.get<CacheConf>('CACHE');
    const authState =
      cache?.REDIS.ENABLED && cache?.REDIS.SAVE_INSTANCES
        ? await useMultiFileAuthStateRedisDb(instanceId, this.cache)
        : database.SAVE_DATA.INSTANCE
          ? await useMultiFileAuthStatePrisma(instanceId, this.cache)
          : null;

    if (!authState) {
      throw new BadRequestException('No persistent Baileys session storage is enabled');
    }

    const targetCreds = authState.state.creds as Record<string, unknown>;
    for (const key of Object.keys(targetCreds)) delete targetCreds[key];
    Object.assign(targetCreds, snapshot.creds);
    await authState.saveCreds();
    await authState.state.keys.set(snapshot.keys);
  }

  private zapoTablePrefix(): string {
    const prefix = process.env.ZAPO_STORE_TABLE_PREFIX || 'zapo_';
    if (!/^[A-Za-z0-9_]*$/.test(prefix)) {
      throw new BadRequestException('ZAPO_STORE_TABLE_PREFIX contains unsafe characters');
    }
    return prefix;
  }

  private async openZapoStore(instanceId: string): Promise<ZapoStoreContext> {
    const database = this.configService.get<Database>('DATABASE');
    if (database.PROVIDER !== 'postgresql' || !database.CONNECTION.URI) {
      throw new BadRequestException('Session conversion with Zapo requires DATABASE_PROVIDER=postgresql');
    }

    const [{ createStore }, { createPostgresStore }] = await Promise.all([
      import('@innovatorssoft/zapo-js'),
      import('@innovatorssoft/store-postgres'),
    ]);
    const pool = new Pool({ connectionString: database.CONNECTION.URI });
    const tablePrefix = this.zapoTablePrefix();
    const backend = createPostgresStore({ pool, tablePrefix });
    const store = createStore({
      backends: { pg: backend },
      providers: {
        auth: 'pg',
        signal: 'pg',
        preKey: 'pg',
        session: 'pg',
        identity: 'pg',
        senderKey: 'pg',
        appState: 'pg',
        privacyToken: 'pg',
        messages: 'pg',
        threads: 'pg',
        contacts: 'pg',
      },
      cacheProviders: {
        retry: 'pg',
        groupMetadata: 'pg',
        deviceList: 'pg',
        messageSecret: 'pg',
      },
    });

    return { pool, store, session: store.session(instanceId), tablePrefix };
  }

  private async closeZapoStore(context: ZapoStoreContext): Promise<void> {
    try {
      await context.store?.destroy?.();
    } finally {
      await context.pool.end().catch(() => undefined);
    }
  }

  private table(context: ZapoStoreContext, name: string): string {
    return `"${context.tablePrefix}${name}"`;
  }

  private async tableExists(context: ZapoStoreContext, name: string): Promise<boolean> {
    const qualified = `${context.tablePrefix}${name}`;
    const result = await context.pool.query('SELECT to_regclass($1) AS table_name', [qualified]);
    return Boolean(result.rows?.[0]?.table_name);
  }

  private async rows(
    context: ZapoStoreContext,
    name: string,
    sql: string,
    values: unknown[] = [],
  ): Promise<Record<string, any>[]> {
    if (!(await this.tableExists(context, name))) return [];
    const statement = sql.split('__TABLE__').join(this.table(context, name));
    const result = await context.pool.query<Record<string, any>>(statement, values);
    return result.rows ?? [];
  }

  private address(row: Record<string, any>) {
    return { user: String(row.user), server: String(row.server || 's.whatsapp.net'), device: Number(row.device || 0) };
  }

  private async readZapoSnapshot(instanceId: string): Promise<any | null> {
    const context = await this.openZapoStore(instanceId);
    try {
      const credentials = await context.session.auth.load();
      if (!credentials) return null;

      const preKeyRows = await this.rows(
        context,
        'signal_prekey',
        'SELECT key_id FROM __TABLE__ WHERE session_id = $1 ORDER BY key_id',
        [instanceId],
      );
      const preKeyIds = preKeyRows.map((row) => Number(row.key_id));
      const preKeys = preKeyIds.length ? (await context.session.preKey.getPreKeysById(preKeyIds)).filter(Boolean) : [];

      const identityRows = await this.rows(
        context,
        'signal_identity',
        'SELECT "user", server, device FROM __TABLE__ WHERE session_id = $1',
        [instanceId],
      );
      const identityAddresses = identityRows.map((row) => this.address(row));
      const identityKeys = identityAddresses.length
        ? await context.session.identity.getRemoteIdentities(identityAddresses)
        : [];
      const identities = identityAddresses
        .map((address, index) => (identityKeys[index] ? { address, identityKey: identityKeys[index] } : null))
        .filter(Boolean);

      const sessionRows = await this.rows(
        context,
        'signal_session',
        'SELECT "user", server, device FROM __TABLE__ WHERE session_id = $1',
        [instanceId],
      );
      const sessionAddresses = sessionRows.map((row) => this.address(row));
      const sessionRecords = sessionAddresses.length
        ? await context.session.session.getSessionsBatch(sessionAddresses)
        : [];
      const sessions = sessionAddresses
        .map((address, index) => (sessionRecords[index] ? { address, record: sessionRecords[index] } : null))
        .filter(Boolean);

      const senderGroups = await this.rows(
        context,
        'sender_keys',
        'SELECT DISTINCT group_id FROM __TABLE__ WHERE session_id = $1',
        [instanceId],
      );
      const senderKeys: any[] = [];
      for (const row of senderGroups) {
        const list = await context.session.senderKey.getGroupSenderKeyList(String(row.group_id));
        for (const record of list?.skList ?? []) {
          senderKeys.push({ groupId: record.groupId, sender: record.sender, record });
        }
      }

      const appState = await context.session.appState.exportData();

      const privacyRows = await this.rows(
        context,
        'privacy_tokens',
        `SELECT jid, tc_token, tc_token_timestamp, tc_token_sender_timestamp, nct_salt, updated_at_ms
         FROM __TABLE__ WHERE session_id = $1`,
        [instanceId],
      );
      const privacyTokens = privacyRows.map((row) => ({
        jid: row.jid,
        tcToken: row.tc_token ?? undefined,
        tcTokenTimestamp: row.tc_token_timestamp === null ? undefined : Number(row.tc_token_timestamp),
        tcTokenSenderTimestamp:
          row.tc_token_sender_timestamp === null ? undefined : Number(row.tc_token_sender_timestamp),
        nctSalt: row.nct_salt ?? undefined,
        updatedAtMs: Number(row.updated_at_ms),
      }));

      const deviceRows = await this.rows(
        context,
        'device_list_cache',
        `SELECT user_jid, alt_user_jid, device_jids_json, updated_at_ms, expires_at_ms
         FROM __TABLE__ WHERE session_id = $1 AND expires_at_ms > $2`,
        [instanceId, Date.now()],
      );
      const deviceLists = deviceRows.map((row) => ({
        userJid: row.user_jid,
        altUserJid: row.alt_user_jid ?? undefined,
        deviceJids: JSON.parse(row.device_jids_json || '[]'),
        updatedAtMs: Number(row.updated_at_ms),
      }));

      const contactRows = await this.rows(
        context,
        'mailbox_contacts',
        `SELECT jid, display_name, push_name, lid, phone_number, last_updated_ms
         FROM __TABLE__ WHERE session_id = $1`,
        [instanceId],
      );
      const contacts = contactRows.map((row) => ({
        jid: row.jid,
        displayName: row.display_name ?? undefined,
        pushName: row.push_name ?? undefined,
        lid: row.lid ?? undefined,
        phoneNumber: row.phone_number ?? undefined,
        lastUpdatedMs: Number(row.last_updated_ms),
      }));

      const secretRows = await this.rows(
        context,
        'message_secrets_cache',
        `SELECT message_id, sender_jid, secret, expires_at_ms
         FROM __TABLE__ WHERE session_id = $1 AND expires_at_ms > $2`,
        [instanceId, Date.now()],
      );
      const messageSecrets = secretRows.map((row) => ({
        messageId: row.message_id,
        senderJid: row.sender_jid,
        secret: row.secret,
      }));

      return {
        credentials,
        preKeys,
        identities,
        sessions,
        senderKeys,
        appState,
        privacyTokens,
        deviceLists,
        contacts,
        messageSecrets,
      };
    } finally {
      await this.closeZapoStore(context);
    }
  }

  private async clearZapoStorage(instanceId: string): Promise<void> {
    const context = await this.openZapoStore(instanceId);
    try {
      const domains = [
        'auth',
        'signal',
        'preKey',
        'session',
        'identity',
        'senderKey',
        'appState',
        'retry',
        'groupMetadata',
        'deviceList',
        'messages',
        'messageSecret',
        'threads',
        'contacts',
        'privacyToken',
      ];
      for (const domain of domains) {
        const store = context.session[domain];
        if (typeof store?.clear === 'function') await store.clear();
      }
    } finally {
      await this.closeZapoStore(context);
    }
  }

  private async writeZapoSnapshot(instanceId: string, snapshot: any): Promise<void> {
    if (!snapshot?.credentials) throw new BadRequestException('Invalid Zapo session snapshot');

    const context = await this.openZapoStore(instanceId);
    try {
      const s = context.session;
      const domains = [
        'auth',
        'signal',
        'preKey',
        'session',
        'identity',
        'senderKey',
        'appState',
        'retry',
        'groupMetadata',
        'deviceList',
        'messages',
        'messageSecret',
        'threads',
        'contacts',
        'privacyToken',
      ];
      for (const domain of domains) {
        const store = s[domain];
        if (typeof store?.clear === 'function') await store.clear();
      }

      await s.auth.save(snapshot.credentials);
      if (snapshot.credentials.serverHasPreKeys !== undefined) {
        await s.preKey.setServerHasPreKeys(snapshot.credentials.serverHasPreKeys === true);
      }
      for (const key of snapshot.preKeys ?? []) await s.preKey.putPreKey(key);
      if (snapshot.identities?.length) {
        await s.identity.setRemoteIdentities(
          snapshot.identities.map((item) => ({ address: item.address, identityKey: item.identityKey })),
        );
      }
      if (snapshot.sessions?.length) {
        await s.session.setSessionsBatch(
          snapshot.sessions.map((item) => ({ address: item.address, session: item.record })),
        );
      }
      for (const item of snapshot.senderKeys ?? []) await s.senderKey.upsertSenderKey(item.record);

      if (snapshot.appState?.keys?.length) await s.appState.upsertSyncKeys(snapshot.appState.keys);
      const collectionUpdates = Object.entries(snapshot.appState?.collections ?? {}).map(
        ([collection, value]: [string, any]) => ({
          collection,
          version: value.version,
          hash: value.hash,
          indexValueMap: new Map(Object.entries(value.indexValueMap ?? {})),
        }),
      );
      if (collectionUpdates.length) await s.appState.setCollectionStates(collectionUpdates);

      if (snapshot.privacyTokens?.length) await s.privacyToken.upsertBatch(snapshot.privacyTokens);
      if (snapshot.deviceLists?.length) await s.deviceList.upsertUserDevicesBatch(snapshot.deviceLists);
      if (snapshot.contacts?.length) await s.contacts.upsertBatch(snapshot.contacts);
      if (snapshot.messageSecrets?.length) {
        await s.messageSecret.setBatch(
          snapshot.messageSecrets.map((item) => ({
            messageId: item.messageId,
            entry: { senderJid: item.senderJid, secret: item.secret },
          })),
        );
      }
    } finally {
      await this.closeZapoStore(context);
    }
  }
}
