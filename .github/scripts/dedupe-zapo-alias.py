from pathlib import Path

p = Path('src/api/integrations/channel/whatsapp/zapo.identity.extensions.ts')
s = p.read_text()

pairs = [
    (
        """      if (lidJid && phoneJid) {
        this.rememberAlias(lidJid, phoneJid);
        void this.mergeCanonicalIdentityRecords(lidJid, phoneJid).catch((error: Error) => this.logger.warn(error));
      }""",
        """      if (lidJid && phoneJid) {
        const mapping = this.rememberAlias(lidJid, phoneJid);
        if (mapping?.changed) {
          void this.mergeCanonicalIdentityRecords(lidJid, phoneJid).catch((error: Error) => this.logger.warn(error));
        }
      }""",
    ),
    (
        """    if (phoneJid && lidJid && !isOwnPeer) {
      this.rememberAlias(lidJid, phoneJid);
      void this.mergeCanonicalIdentityRecords(lidJid, phoneJid).catch((error: Error) => this.logger.warn(error));
    }""",
        """    if (phoneJid && lidJid && !isOwnPeer) {
      const mapping = this.rememberAlias(lidJid, phoneJid);
      if (mapping?.changed) {
        void this.mergeCanonicalIdentityRecords(lidJid, phoneJid).catch((error: Error) => this.logger.warn(error));
      }
    }""",
    ),
    (
        "): { lidJid: string; phoneJid: string } | null {",
        "): { lidJid: string; phoneJid: string; changed: boolean } | null {",
    ),
    (
        """    aliases?.set(lidJid, phoneJid);
    this.lidToPhone.set(this.identityKey(lidJid), phoneJid);
    return { lidJid, phoneJid };""",
        """    aliases?.set(lidJid, phoneJid);
    const key = this.identityKey(lidJid);
    const previous = this.lidToPhone.get(key);
    if (previous === phoneJid) return { lidJid, phoneJid, changed: false };
    this.lidToPhone.set(key, phoneJid);
    return { lidJid, phoneJid, changed: true };""",
    ),
    (
        """    if (!mapping) return;
    void this.mergeCanonicalIdentityRecords(mapping.lidJid, mapping.phoneJid).catch((error: Error) =>""",
        """    if (!mapping?.changed) return;
    void this.mergeCanonicalIdentityRecords(mapping.lidJid, mapping.phoneJid).catch((error: Error) =>""",
    ),
]

for old, new in pairs:
    if s.count(old) != 1:
        raise SystemExit(f'Expected alias block not found exactly once: {old[:80]!r}')
    s = s.replace(old, new, 1)

p.write_text(s)
