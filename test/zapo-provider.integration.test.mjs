import fs from 'node:fs';

const read = (path) => fs.readFileSync(path, 'utf8');
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

const zapo = read('src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts');
const zapoExtensions = read('src/api/integrations/channel/whatsapp/zapo.provider.extensions.ts');
const zapoAccountExtensions = read('src/api/integrations/channel/whatsapp/zapo.provider.account.extensions.ts');
const zapoGroupExtensions = read('src/api/integrations/channel/whatsapp/zapo.provider.group.extensions.ts');
const zapoInteractiveExtensions = read('src/api/integrations/channel/whatsapp/zapo.provider.interactive.extensions.ts');
const channelController = read('src/api/integrations/channel/channel.controller.ts');
const baileys = read('src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts');
const instanceController = read('src/api/controllers/instance.controller.ts');
const callController = read('src/api/controllers/call.controller.ts');
const callRouter = read('src/api/routes/call.router.ts');
const voiceMedia = read('src/api/services/voice-media.service.ts');
const packageJson = JSON.parse(read('package.json'));
const packageLock = JSON.parse(read('package-lock.json'));
const providerContract = read('src/api/integrations/channel/whatsapp/whatsapp.provider.contract.ts');
const migrationService = read('src/api/services/provider-session-migration.service.ts');
const instanceRouter = read('src/api/routes/instance.router.ts');
const migrationSchema = read('src/validate/provider-migration.schema.ts');

assert(zapo.includes('class ZapoStartupService'), 'Native Zapo startup service is missing');
assert(zapo.includes("Integration.WHATSAPP_ZAPO"), 'Zapo provider integration identifier is missing');
assert(zapo.includes('public async offerCall'), 'Zapo voice offerCall implementation is missing');
assert(zapo.includes('public async listCalls'), 'Zapo voice listCalls implementation is missing');
assert(zapo.includes("this.client.on('voip_call_incoming'"), 'Zapo incoming-call listener is missing');
assert(zapo.includes("this.client.on('voip_call_inbound_audio'"), 'Zapo inbound audio hook is missing');
assert(zapo.includes("rawRemoteJid.endsWith('@lid')"), 'Zapo LID-to-PN canonicalization is missing');
assert(zapo.includes("authMode: 'qrcode' | 'pairing-code'"), 'Zapo QR/pairing mode isolation is missing');
assert(zapo.includes('resetLinkingClient'), 'Zapo stale linking-client reset is missing');
assert(zapo.includes('ZAPO_PAIRING_DEVICE_OS'), 'Zapo stable pairing fingerprint is missing');
assert(zapo.includes("this.configService.get<QrCode>('QRCODE').COLOR"), 'Zapo must use the shared QR color');
assert(zapo.includes('WHATSAPP_PROTOCOL_BROWSER_CLIENT'), 'Zapo must inherit the shared Connect|API QR device label');
assert(instanceController.includes('authenticationQueues'), 'Per-instance WhatsApp authentication serialization is missing');
assert(instanceController.includes('withAuthenticationLock'), 'Shared WhatsApp authentication lock is missing');
assert(instanceController.includes('normalizeQrCode'), 'Provider-neutral QR normalization is missing');
assert(instanceController.includes("get<QrCode>('QRCODE').AUTH_TIMEOUT_MS"), 'Shared WhatsApp auth timeout is missing');
assert(baileys.includes("const pairingCodeBrowser: WABrowserDescription = ['Ubuntu', 'Chrome', '20.0.04']"), 'Stable Baileys pairing fingerprint changed unexpectedly');
assert(callController.includes("this.method(instanceName, 'offerCall')"), 'Provider-neutral call delegation is missing');
assert(callRouter.includes("this.routerPath('list')"), 'Call list route is missing');
assert(voiceMedia.includes("VOICE_MEDIA_PATH = '/voice/media'"), 'Dedicated voice media gateway is missing');
assert(voiceMedia.includes('feedLiveAudio'), 'Browser-to-provider voice media bridge is missing');
assert(voiceMedia.includes('onInboundVoiceAudio'), 'Provider-to-browser voice media bridge is missing');
assert(packageJson.dependencies?.['@innovatorssoft/zapo-js'] === '1.6.3', 'Zapo JS version must stay pinned at 1.6.3');
assert(packageJson.dependencies?.['@innovatorssoft/voip'] === '1.0.0', 'Zapo VoIP version must stay pinned at 1.0.0');
assert(packageJson.dependencies?.['zapo-js'] === 'npm:@innovatorssoft/zapo-js@1.6.3', 'Legacy zapo-js runtime alias is missing');

assert(channelController.includes('ZapoInteractiveStartupService'), 'Zapo interactive compatibility layer is not wired');
assert(zapoExtensions.includes("client.on('presence'"), 'Zapo presence listener is missing');
assert(zapoExtensions.includes("client.on('chatstate'"), 'Zapo chatstate listener is missing');
assert(zapoExtensions.includes("client.on('app_state_mutation'"), 'Zapo app-state mutation listener is missing');
assert(zapoExtensions.includes("client.on('mutation_send'"), 'Zapo outbound mutation listener is missing');
assert(zapoExtensions.includes("schema: 'LabelJid'"), 'Zapo label association mutation is missing');
assert(zapoExtensions.includes("schema: 'LabelEdit'"), 'Zapo label edit mutation parsing is missing');
assert(zapoExtensions.includes('public async fetchLabels'), 'Zapo label listing compatibility is missing');
assert(zapoExtensions.includes('public async handleLabel'), 'Zapo label mutation compatibility is missing');
assert(zapoExtensions.includes('public async whatsappNumber'), 'Zapo registration lookup compatibility is missing');
assert(zapoExtensions.includes('getLidsByPhoneNumbers'), 'Zapo registration lookup must use native LID usync');
assert(zapoExtensions.includes('public async profilePicture'), 'Zapo profile-picture hardening is missing');

assert(zapoAccountExtensions.includes('public async markMessageAsRead'), 'Zapo read-receipt compatibility is missing');
assert(zapoAccountExtensions.includes("sendReceipt(jid, ids, { type: 'read' })"), 'Zapo read receipts must use native receipt API');
assert(zapoAccountExtensions.includes('public async archiveChat'), 'Zapo archive/unarchive compatibility is missing');
assert(zapoAccountExtensions.includes('chat.setChatArchive'), 'Zapo archive must use the public app-state coordinator');
assert(zapoAccountExtensions.includes('public async markChatUnread'), 'Zapo mark-unread compatibility is missing');
assert(zapoAccountExtensions.includes('chat.setChatRead(jid, false)'), 'Zapo mark-unread must use the public app-state coordinator');
assert(zapoAccountExtensions.includes('public async deleteMessage'), 'Zapo message revoke compatibility is missing');
assert(zapoAccountExtensions.includes("type: 'revoke'"), 'Zapo message deletion must use the native revoke message type');
assert(zapoAccountExtensions.includes('Events.MESSAGES_DELETE'), 'Zapo delete webhook parity is missing');
assert(zapoAccountExtensions.includes('public async updateMessage'), 'Zapo message edit compatibility is missing');
assert(zapoAccountExtensions.includes('editKey:'), 'Zapo message edit must use the native editKey option');
assert(zapoAccountExtensions.includes('Events.MESSAGES_UPDATE'), 'Zapo edit webhook parity is missing');
assert(zapoAccountExtensions.includes("status: 'EDITED'"), 'Zapo local edited-message state is missing');
assert(zapoAccountExtensions.includes("status: 'DELETED'"), 'Zapo local deleted-message state is missing');
assert(zapoAccountExtensions.includes('public async getBase64FromMediaMessage'), 'Zapo media-download compatibility is missing');
assert(zapoAccountExtensions.includes('message.downloadBytes'), 'Zapo media download must use the public verified media pipeline');
assert(zapoAccountExtensions.includes('convertAudioToMp4'), 'Zapo audio-to-MP4 compatibility is missing');
assert(zapoAccountExtensions.includes("base64: buffer.toString('base64')"), 'Zapo media response must expose base64');
assert(zapoAccountExtensions.includes('public async getStatus'), 'Zapo peer status lookup is missing');
assert(zapoAccountExtensions.includes('profile.getStatus'), 'Zapo peer status must use the public profile coordinator');
assert(zapoAccountExtensions.includes('public async fetchBusinessProfile'), 'Zapo business-profile compatibility is missing');
assert(zapoAccountExtensions.includes('business.getBusinessProfile'), 'Zapo business profile must use the public coordinator');
assert(zapoAccountExtensions.includes('business.getVerifiedName'), 'Zapo verified business name lookup is missing');
assert(zapoAccountExtensions.includes('public async fetchProfile'), 'Zapo full profile compatibility is missing');
assert(zapoAccountExtensions.includes('numberExists:'), 'Zapo full profile response must expose numberExists');
assert(zapoAccountExtensions.includes('isBusiness: business.isBusiness'), 'Zapo full profile must include business status');
assert(zapoAccountExtensions.includes('public async fetchPrivacySettings'), 'Zapo privacy read compatibility is missing');
assert(zapoAccountExtensions.includes('public async updatePrivacySettings'), 'Zapo privacy write compatibility is missing');
assert(zapoAccountExtensions.includes("setPrivacySetting('profilePicture'"), 'Zapo profile privacy mapping is missing');
assert(zapoAccountExtensions.includes('public async updateProfileName'), 'Zapo profile-name update is missing');
assert(zapoAccountExtensions.includes('profile.setPushName'), 'Zapo profile name must use the public coordinator');
assert(zapoAccountExtensions.includes('public async updateProfileStatus'), 'Zapo profile-status update is missing');
assert(zapoAccountExtensions.includes('profile.setStatus'), 'Zapo profile status must use the public coordinator');
assert(zapoAccountExtensions.includes('public async updateProfilePicture'), 'Zapo profile-picture update is missing');
assert(zapoAccountExtensions.includes('profile.setProfilePicture'), 'Zapo profile picture must use the public coordinator');
assert(zapoAccountExtensions.includes('public async removeProfilePicture'), 'Zapo profile-picture removal is missing');
assert(zapoAccountExtensions.includes('profile.deleteProfilePicture'), 'Zapo profile removal must use the public coordinator');
assert(zapoAccountExtensions.includes('public async blockUser'), 'Zapo block/unblock compatibility is missing');
assert(zapoAccountExtensions.includes('privacy.blockUser'), 'Zapo block must use the LID-aware privacy coordinator');
assert(zapoAccountExtensions.includes('privacy.unblockUser'), 'Zapo unblock must use the LID-aware privacy coordinator');

assert(zapoGroupExtensions.includes('class ZapoGroupStartupService'), 'Zapo group compatibility service is missing');
assert(zapoGroupExtensions.includes('public async createGroup'), 'Zapo group creation is missing');
assert(zapoGroupExtensions.includes('group.createGroup'), 'Zapo group creation must use the public coordinator');
assert(zapoGroupExtensions.includes('public async updateGroupPicture'), 'Zapo group picture update is missing');
assert(zapoGroupExtensions.includes('profile.setProfilePicture(bytes, groupJid)'), 'Zapo group picture must use the public profile coordinator');
assert(zapoGroupExtensions.includes('public async updateGroupSubject'), 'Zapo group subject update is missing');
assert(zapoGroupExtensions.includes('group.setSubject'), 'Zapo group subject must use the public coordinator');
assert(zapoGroupExtensions.includes('public async updateGroupDescription'), 'Zapo group description update is missing');
assert(zapoGroupExtensions.includes('group.setDescription'), 'Zapo group description must use the public coordinator');
assert(zapoGroupExtensions.includes('public async findGroup'), 'Zapo group metadata lookup is missing');
assert(zapoGroupExtensions.includes('group.queryGroupMetadata'), 'Zapo group lookup must use the public coordinator');
assert(zapoGroupExtensions.includes('public async fetchAllGroups'), 'Zapo all-groups lookup is missing');
assert(zapoGroupExtensions.includes('group.queryAllGroups'), 'Zapo all-groups lookup must use the public coordinator');
assert(zapoGroupExtensions.includes('public async inviteCode'), 'Zapo group invite-code lookup is missing');
assert(zapoGroupExtensions.includes('group.queryInviteCode'), 'Zapo invite code must use the public coordinator');
assert(zapoGroupExtensions.includes('public async inviteInfo'), 'Zapo invite preview is missing');
assert(zapoGroupExtensions.includes('group.queryGroupInviteInfo'), 'Zapo invite preview must use the public coordinator');
assert(zapoGroupExtensions.includes('public async acceptInviteCode'), 'Zapo invite acceptance is missing');
assert(zapoGroupExtensions.includes('group.joinGroupViaInvite'), 'Zapo invite acceptance must use the public coordinator');
assert(zapoGroupExtensions.includes('public async revokeInviteCode'), 'Zapo invite revocation is missing');
assert(zapoGroupExtensions.includes('group.revokeInvite'), 'Zapo invite revocation must use the public coordinator');
assert(zapoGroupExtensions.includes('public async updateGParticipant'), 'Zapo participant management is missing');
assert(zapoGroupExtensions.includes('group.addParticipants'), 'Zapo add participant support is missing');
assert(zapoGroupExtensions.includes('group.removeParticipants'), 'Zapo remove participant support is missing');
assert(zapoGroupExtensions.includes('group.promoteParticipants'), 'Zapo promote participant support is missing');
assert(zapoGroupExtensions.includes('group.demoteParticipants'), 'Zapo demote participant support is missing');
assert(zapoGroupExtensions.includes('public async updateGSetting'), 'Zapo group settings parity is missing');
assert(zapoGroupExtensions.includes("setSetting(groupJid, 'announce'"), 'Zapo announcement group setting is missing');
assert(zapoGroupExtensions.includes("setSetting(groupJid, 'restrict'"), 'Zapo restricted group setting is missing');
assert(zapoGroupExtensions.includes('public async toggleEphemeral'), 'Zapo disappearing-message group setting is missing');
assert(zapoGroupExtensions.includes('group.setEphemeralDuration'), 'Zapo ephemeral duration must use the public coordinator');
assert(zapoGroupExtensions.includes('public async leaveGroup'), 'Zapo leave-group compatibility is missing');
assert(zapoGroupExtensions.includes('group.leaveGroup([groupJid])'), 'Zapo leave-group must use the public coordinator');

assert(zapoInteractiveExtensions.includes('class ZapoInteractiveStartupService'), 'Zapo interactive compatibility service is missing');
assert(zapoInteractiveExtensions.includes('private async sendButtonMessage'), 'Zapo interactive button messages are missing');
assert(zapoInteractiveExtensions.includes('nativeFlowMessage'), 'Zapo buttons must use WhatsApp native-flow payloads');
assert(zapoInteractiveExtensions.includes("['reply', 'quick_reply']"), 'Zapo quick-reply button mapping is missing');
assert(zapoInteractiveExtensions.includes("['pix', 'payment_info']"), 'Zapo Pix button mapping is missing');
assert(zapoInteractiveExtensions.includes('private async sendListMessage'), 'Zapo list messages are missing');
assert(zapoInteractiveExtensions.includes('listMessage:'), 'Zapo list messages must use the raw list-message payload');
assert(zapoInteractiveExtensions.includes('private async sendStatusMessage'), 'Zapo status publishing is missing');
assert(zapoInteractiveExtensions.includes('.status.send({'), 'Zapo status publishing must use the public status coordinator');
assert(zapoInteractiveExtensions.includes("statusSetting: 'contacts'"), 'Zapo all-contact status distribution is missing');
assert(zapoInteractiveExtensions.includes("statusSetting: 'allowlist'"), 'Zapo explicit status allowlist distribution is missing');
assert(zapoInteractiveExtensions.includes('convertAudioToOggOpus'), 'Zapo audio status conversion is missing');
assert(zapoInteractiveExtensions.includes('backgroundArgb: this.parseArgb'), 'Zapo text-status background compatibility is missing');


assert(providerContract.includes('WHATSAPP_REQUIRED_CAPABILITIES'), 'Provider capability contract is missing');
assert(providerContract.includes('BAILEYS_WHATSAPP_CAPABILITIES'), 'Baileys capability manifest is missing');
assert(providerContract.includes('ZAPO_WHATSAPP_CAPABILITIES'), 'Zapo capability manifest is missing');
for (const capability of [
  'auth',
  'messaging',
  'contacts',
  'chats',
  'groups',
  'statusRead',
  'statusPublish',
  'presence',
  'media',
  'profile',
  'privacy',
  'labels',
  'receipts',
  'businessProfile',
]) {
  assert(providerContract.includes(`'${capability}'`), `Required provider capability ${capability} is missing`);
}
assert(baileys.includes('BAILEYS_WHATSAPP_CAPABILITIES'), 'Baileys is not wired to the shared capability contract');
assert(zapo.includes('ZAPO_WHATSAPP_CAPABILITIES'), 'Zapo is not wired to the shared capability contract');

assert(packageJson.dependencies?.['wa-store-migrate'] === '0.1.1', 'wa-store-migrate must stay pinned at 0.1.1');
assert(packageLock.packages?.['node_modules/wa-store-migrate']?.version === '0.1.1', 'wa-store-migrate lock entry is missing');
assert(packageLock.packages?.['node_modules/wa-store-migrate/node_modules/zapo-js']?.version === '0.3.0', 'wa-store-migrate isolated codec dependency is missing');
assert(packageLock.packages?.['node_modules/zapo-js']?.name === '@innovatorssoft/zapo-js', 'Connect|API top-level Zapo alias must stay on @innovatorssoft/zapo-js');
assert(migrationService.includes("import('wa-store-migrate')"), 'Provider migration must use wa-store-migrate');
assert(migrationService.includes('validate: true'), 'Provider migration must validate the canonical snapshot');
assert(migrationService.includes('CRITICAL_MIGRATION_DOMAINS'), 'Critical session-domain loss protection is missing');
assert(migrationService.includes("severity === 'drop'"), 'Critical drop detection is missing');
assert(migrationService.includes("const from = source === Integration.WHATSAPP_BAILEYS ? 'baileys' : 'zapo'"), 'Baileys/Zapo source conversion mapping is missing');
assert(migrationService.includes("const to = target === Integration.WHATSAPP_BAILEYS ? 'baileys' : 'zapo'"), 'Baileys/Zapo target conversion mapping is missing');
assert(migrationService.includes('assertMigrationStorageSupported'), 'External session storage migration guard is missing');
assert(migrationService.includes('readBaileysSnapshot'), 'Baileys snapshot exporter is missing');
assert(migrationService.includes('writeBaileysSnapshot'), 'Baileys snapshot importer is missing');
assert(migrationService.includes('readZapoSnapshot'), 'Zapo snapshot exporter is missing');
assert(migrationService.includes('writeZapoSnapshot'), 'Zapo snapshot importer is missing');
assert(instanceRouter.includes("routerPath('migrateProvider')"), 'Provider migration API route is missing');
assert(migrationSchema.includes('Integration.WHATSAPP_BAILEYS'), 'Migration schema must accept Baileys');
assert(migrationSchema.includes('Integration.WHATSAPP_ZAPO'), 'Migration schema must accept Zapo');
assert(instanceController.includes('preflightSnapshot'), 'Migration preflight snapshot is missing');
assert(instanceController.includes('cutoverSnapshot'), 'Post-disconnect cutover snapshot is missing');
assert(instanceController.includes('targetBackup'), 'Target-provider rollback snapshot is missing');
assert(instanceController.includes('pairingRequired: false'), 'Successful provider migration must preserve pairing');
assert(instanceController.includes('Provider migration handoff'), 'Non-logout provider handoff is missing');
assert(!instanceController.includes('__zapo_calls'), 'Hybrid Baileys-to-Zapo call backend must not be enabled in this phase');

console.log('Zapo provider invariants: OK');
