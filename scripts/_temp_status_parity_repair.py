from pathlib import Path

root = Path(__file__).resolve().parents[1]
path = root / 'src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts'
text = path.read_text(encoding='utf-8')

old = """        const isGroupJid = this.localSettings.groupsIgnore && isJidGroup(jid);
        const isBroadcast = !this.localSettings.readStatus && isJidBroadcast(jid);
        const isNewsletter = isJidNewsletter(jid);

        return isGroupJid || isBroadcast || isNewsletter;"""
new = """        const isGroupJid = this.localSettings.groupsIgnore && isJidGroup(jid);
        // Status capture is independent from read receipts. Keep status@broadcast
        // available for the dedicated Status view even when readStatus=false.
        const isBroadcast = isJidBroadcast(jid) && jid !== 'status@broadcast';
        const isNewsletter = isJidNewsletter(jid);

        return isGroupJid || isBroadcast || isNewsletter;"""
if old not in text:
    raise SystemExit('Baileys broadcast filter block not found')
text = text.replace(old, new, 1)

old = """          if (this.localSettings.readMessages && received.key.id !== 'status@broadcast') {
            await this.client.readMessages([received.key]);
          }

          if (this.localSettings.readStatus && received.key.id === 'status@broadcast') {
            await this.client.readMessages([received.key]);
          }"""
new = """          const isStatusMessage = received.key.remoteJid === 'status@broadcast';
          if (this.localSettings.readMessages && !isStatusMessage) {
            await this.client.readMessages([received.key]);
          }

          if (this.localSettings.readStatus && isStatusMessage) {
            await this.client.readMessages([received.key]);
          }"""
if old not in text:
    raise SystemExit('Baileys readStatus block not found')
text = text.replace(old, new, 1)

path.write_text(text, encoding='utf-8', newline='\n')
print('Baileys Status parity repair applied')
