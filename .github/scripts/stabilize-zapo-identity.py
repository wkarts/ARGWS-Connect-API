from pathlib import Path


def replace_once(path, old, new):
    p = Path(path)
    text = p.read_text()
    count = text.count(old)
    if count != 1:
        raise SystemExit(f'{path}: expected 1 match, got {count}')
    p.write_text(text.replace(old, new, 1))


# ZAPO base transport: names are remote identity attributes, not last-message attributes.
path = 'src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts'

replace_once(
    path,
    """      const display = String(row.display_name || row.push_name || '').trim();
      if (display && jid) displayByJid.set(jid, display);
      if (display && phoneNumber) displayByJid.set(phoneNumber, display);""",
    """      const display = this.sanitizeRemoteStoredName(row.display_name) || this.sanitizeRemoteStoredName(row.push_name);
      if (display && jid) displayByJid.set(jid, display);
      if (display && phoneNumber) displayByJid.set(phoneNumber, display);""",
)

replace_once(
    path,
    """      const pushName = String(row.display_name || row.push_name || '').trim() || undefined;
      if (!canonicalContacts.has(remoteJid) || pushName) canonicalContacts.set(remoteJid, pushName);""",
    """      const pushName = this.sanitizeRemoteStoredName(row.display_name) || this.sanitizeRemoteStoredName(row.push_name);
      if (!canonicalContacts.has(remoteJid) || pushName) canonicalContacts.set(remoteJid, pushName);""",
)

replace_once(
    path,
    """              update: { ...(pushName ? { pushName } : {}) },
              create: { remoteJid, pushName, instanceId: this.instanceId },""",
    """              // Existing valid names are stable. History may create a missing
              // contact name, but it must not replace an already-known peer name.
              update: {},
              create: { remoteJid, pushName, instanceId: this.instanceId },""",
)

replace_once(
    path,
    """      const name =
        String(row.name || displayByJid.get(rawJid) || displayByJid.get(remoteJid) || '').trim() || undefined;""",
    """      const name =
        this.sanitizeRemoteStoredName(row.name) || displayByJid.get(rawJid) || displayByJid.get(remoteJid);""",
)

replace_once(
    path,
    """              update: {
                ...(info.name ? { name: info.name } : {}),
                ...(Number.isFinite(info.unreadMessages) ? { unreadMessages: info.unreadMessages } : {}),
              },""",
    """              update: {
                // Do not oscillate a chat name based on later history rows.
                ...(Number.isFinite(info.unreadMessages) ? { unreadMessages: info.unreadMessages } : {}),
              },""",
)

replace_once(
    path,
    """      pushName: event.pushName,
      participant: canonicalParticipant,""",
    """      // For outgoing echoes, ZAPO/WhatsApp can expose this account's own
      // pushName. Never propagate that as the remote peer identity.
      pushName: event.key.fromMe ? undefined : this.sanitizeRemoteStoredName(event.pushName),
      participant: canonicalParticipant,""",
)

replace_once(
    path,
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
    """    if (db.SAVE_DATA.CONTACTS) {
      await this.upsertContact(messageRaw.key.remoteJid, messageRaw.pushName);
    }

    if (db.SAVE_DATA.CHATS) {
      await this.upsertChat(messageRaw.key.remoteJid, messageRaw.pushName);
    }""",
)

replace_once(
    path,
    """  private async upsertContact(remoteJid: string, pushName?: string) {
    await this.prismaRepository.contact.upsert({
      where: { remoteJid_instanceId: { remoteJid, instanceId: this.instanceId } },
      update: { pushName },
      create: { remoteJid, pushName, instanceId: this.instanceId },
    });
    this.sendDataWebhook(Events.CONTACTS_UPSERT, { remoteJid, pushName, instanceId: this.instanceId });
    void this.refreshContactProfilePicture(remoteJid);
  }

  private async upsertChat(remoteJid: string, name?: string) {
    await this.prismaRepository.chat.upsert({
      where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid } },
      update: { name },
      create: { remoteJid, name, instanceId: this.instanceId },
    });
    this.sendDataWebhook(Events.CHATS_UPSERT, { remoteJid, name, instanceId: this.instanceId });
  }""",
    """  private localStoredNames(): Set<string> {
    const credentials = this.client?.getCredentials?.();
    return new Set(
      [this.instance.profileName, credentials?.meDisplayName]
        .map((value) => String(value || '').trim().toLocaleLowerCase('pt-BR'))
        .filter(Boolean),
    );
  }

  private sanitizeRemoteStoredName(value: unknown): string | undefined {
    const name = String(value || '').trim();
    if (!name || /^\\+?\\d+$/.test(name) || name.includes('@lid') || name.includes('@s.whatsapp.net')) return undefined;
    if (['contato', 'contato whatsapp', 'unknown', 'desconhecido'].includes(name.toLocaleLowerCase('pt-BR'))) return undefined;
    if (this.localStoredNames().has(name.toLocaleLowerCase('pt-BR'))) return undefined;
    return name;
  }

  private stableRemoteStoredName(current: unknown, incoming: unknown): string | undefined {
    return this.sanitizeRemoteStoredName(current) || this.sanitizeRemoteStoredName(incoming);
  }

  private async upsertContact(remoteJid: string, pushName?: string) {
    const existing = await this.prismaRepository.contact.findUnique({
      where: { remoteJid_instanceId: { remoteJid, instanceId: this.instanceId } },
    });
    const stableName = this.stableRemoteStoredName(existing?.pushName, pushName);

    if (existing) {
      if (stableName && stableName !== existing.pushName) {
        await this.prismaRepository.contact.update({ where: { id: existing.id }, data: { pushName: stableName } });
      }
    } else {
      await this.prismaRepository.contact.create({
        data: { remoteJid, pushName: stableName, instanceId: this.instanceId },
      });
    }

    this.sendDataWebhook(Events.CONTACTS_UPSERT, {
      remoteJid,
      pushName: stableName,
      instanceId: this.instanceId,
    });
    void this.refreshContactProfilePicture(remoteJid);
  }

  private async upsertChat(remoteJid: string, name?: string) {
    const existing = await this.prismaRepository.chat.findUnique({
      where: { instanceId_remoteJid: { instanceId: this.instanceId, remoteJid } },
    });
    const stableName = this.stableRemoteStoredName(existing?.name, name);

    if (existing) {
      if (stableName && stableName !== existing.name) {
        await this.prismaRepository.chat.update({ where: { id: existing.id }, data: { name: stableName } });
      }
    } else {
      await this.prismaRepository.chat.create({
        data: { remoteJid, name: stableName, instanceId: this.instanceId },
      });
    }

    this.sendDataWebhook(Events.CHATS_UPSERT, {
      remoteJid,
      name: stableName,
      instanceId: this.instanceId,
    });
  }""",
)

# Canonical identity extension: event-driven; one bounded bootstrap only.
path = 'src/api/integrations/channel/whatsapp/zapo.identity.extensions.ts'

replace_once(path, "import { Query } from '@api/repository/repository.service';\n", '')
replace_once(path, "import { Contact } from '@prisma/client';\n", '')

replace_once(
    path,
    """  private identityRefreshPromise: Promise<void> | null = null;
  private identityRefreshAt = 0;
  private readonly identityRefreshTtlMs = 5 * 60 * 1000;""",
    """  private identityBootstrapPromise: Promise<void> | null = null;
  private identityBootstrapDone = false;""",
)

replace_once(
    path,
    """  public async connectToWhatsapp(): Promise<any> {
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
    """  public async connectToWhatsapp(): Promise<any> {
    const client = await super.connectToWhatsapp();
    this.bindNativeIdentityEvents(client);
    if (this.isRegistered()) this.bootstrapIdentityState();
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

  private bootstrapIdentityState(): void {
    if (this.identityBootstrapDone || this.identityBootstrapPromise) return;
    this.identityBootstrapPromise = this.reconcileIdentityRows()
      .catch((error: Error) => this.logger.warn(`ZAPO identity bootstrap failed: ${error?.message || error}`))
      .finally(() => {
        this.identityBootstrapDone = true;
        this.identityBootstrapPromise = null;
      });
  }""",
)

replace_once(
    path,
    """    client.on('message', (event: any) => {
      this.rememberAlias(event?.key?.remoteJid, event?.key?.remoteJidAlt);
      this.rememberAlias(event?.key?.participant, event?.key?.participantAlt);
      this.rememberAlias(event?.key?.recipientJid, event?.key?.recipientAlt);
    });""",
    """    client.on('message', (event: any) => {
      this.rememberEventAlias(event?.key?.remoteJid, event?.key?.remoteJidAlt);
      this.rememberEventAlias(event?.key?.participant, event?.key?.participantAlt);
      this.rememberEventAlias(event?.key?.recipientJid, event?.key?.recipientAlt);
    });""",
)

replace_once(
    path,
    """      const lidJid = zapoKnownLidJid(event?.lid);
      const phoneJid = zapoPhoneJid(event?.pnJid);
      if (lidJid && phoneJid) this.rememberAlias(lidJid, phoneJid);""",
    """      const lidJid = zapoKnownLidJid(event?.lid);
      const phoneJid = zapoPhoneJid(event?.pnJid);
      if (lidJid && phoneJid) {
        this.rememberAlias(lidJid, phoneJid);
        void this.mergeCanonicalIdentityRecords(lidJid, phoneJid).catch((error: Error) => this.logger.warn(error));
      }""",
)

replace_once(
    path,
    """    if (phoneJid && lidJid && !isOwnPeer) this.rememberAlias(lidJid, phoneJid);""",
    """    if (phoneJid && lidJid && !isOwnPeer) {
      this.rememberAlias(lidJid, phoneJid);
      void this.mergeCanonicalIdentityRecords(lidJid, phoneJid).catch((error: Error) => this.logger.warn(error));
    }""",
)

replace_once(
    path,
    """    const name = pushName || existing?.pushName || undefined;
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
    });""",
    """    const currentName = this.sanitizeRemoteName(existing?.pushName);
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
    });""",
)

replace_once(
    path,
    """    this.identityRefreshAt = 0;
    void this.reconcileIdentities(true).catch((error: Error) => this.logger.error(error));""",
    """    if (phoneJid) {
      void this.mergeCanonicalIdentityRecords(oldLidJid, phoneJid).catch((error: Error) => this.logger.warn(error));
      const identity = this.contactsByIdentity.get(this.identityKey(phoneJid));
      if (identity) {
        identity.aliases = [...new Set([...identity.aliases, newLidJid, phoneJid])];
        this.cacheContactIdentity(identity);
      }
    }""",
)

replace_once(
    path,
    """  private rememberAlias(first: unknown, second: unknown, aliases?: Map<string, string>): void {
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
  }""",
    """  private rememberAlias(
    first: unknown,
    second: unknown,
    aliases?: Map<string, string>,
  ): { lidJid: string; phoneJid: string } | null {
    const firstJid = zapoTryNormalizeJid(first);
    const secondJid = zapoTryNormalizeJid(second);
    if (!firstJid || !secondJid || firstJid === secondJid) return null;

    const lidJid = zapoLidJid(firstJid) || zapoLidJid(secondJid);
    if (!lidJid) return null;
    const other = lidJid === firstJid ? secondJid : firstJid;
    const phoneJid = zapoPhoneJid(other);
    if (!phoneJid) return null;

    aliases?.set(lidJid, phoneJid);
    this.lidToPhone.set(this.identityKey(lidJid), phoneJid);
    return { lidJid, phoneJid };
  }

  private rememberEventAlias(first: unknown, second: unknown): void {
    const mapping = this.rememberAlias(first, second);
    if (!mapping) return;
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
  }""",
)

replace_once(
    path,
    """  private async reconcileIdentities(force = false): Promise<void> {
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

""",
    '',
)

replace_once(
    path,
    """        const pushName =
          preferredName ||
          this.sanitizeRemoteName(phoneContact?.pushName) ||
          this.sanitizeRemoteName(lidContact?.pushName);""",
    """        const pushName =
          this.sanitizeRemoteName(phoneContact?.pushName) ||
          this.sanitizeRemoteName(lidContact?.pushName) ||
          preferredName;""",
)

replace_once(
    path,
    """        const name =
          preferredName || this.sanitizeRemoteName(phoneChat?.name) || this.sanitizeRemoteName(lidChat?.name);""",
    """        const name =
          this.sanitizeRemoteName(phoneChat?.name) ||
          this.sanitizeRemoteName(lidChat?.name) ||
          preferredName;""",
)

replace_once(
    path,
    """    if (!name || /^\\+?\\d+$/.test(name) || name.includes('@lid') || name.includes('@s.whatsapp.net')) return undefined;
    if (this.localProfileNames().has(name.toLocaleLowerCase('pt-BR'))) return undefined;""",
    """    if (!name || /^\\+?\\d+$/.test(name) || name.includes('@lid') || name.includes('@s.whatsapp.net')) return undefined;
    if (['contato', 'contato whatsapp', 'unknown', 'desconhecido'].includes(name.toLocaleLowerCase('pt-BR'))) return undefined;
    if (this.localProfileNames().has(name.toLocaleLowerCase('pt-BR'))) return undefined;""",
)
