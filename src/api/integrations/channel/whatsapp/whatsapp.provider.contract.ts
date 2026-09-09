export type WhatsAppProviderCapabilities = Readonly<{
  auth: boolean;
  messaging: boolean;
  contacts: boolean;
  chats: boolean;
  groups: boolean;
  statusRead: boolean;
  statusPublish: boolean;
  presence: boolean;
  media: boolean;
  profile: boolean;
  privacy: boolean;
  labels: boolean;
  receipts: boolean;
  businessProfile: boolean;
  businessCatalog: boolean;
  calls: boolean;
  voice: boolean;
  // Backward-compatible granular flags already exposed by the Zapo provider.
  text: boolean;
  location: boolean;
  audio: boolean;
  ptv: boolean;
  sticker: boolean;
  reactions: boolean;
  polls: boolean;
  qrCode: boolean;
  pairingCode: boolean;
  video: boolean;
}>;

/**
 * Capabilities that every Connect|API WhatsApp provider is expected to expose
 * through the existing provider-neutral controllers.
 *
 * `businessCatalog`, `calls` and `voice` are optional extensions because the
 * underlying protocol libraries do not expose the same stable public surface
 * for those features yet.
 */
export const WHATSAPP_REQUIRED_CAPABILITIES = Object.freeze([
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
] as const);

export const BAILEYS_WHATSAPP_CAPABILITIES: WhatsAppProviderCapabilities = Object.freeze({
  auth: true,
  messaging: true,
  contacts: true,
  chats: true,
  groups: true,
  statusRead: true,
  statusPublish: true,
  presence: true,
  media: true,
  profile: true,
  privacy: true,
  labels: true,
  receipts: true,
  businessProfile: true,
  businessCatalog: true,
  calls: false,
  voice: false,
  text: true,
  location: true,
  audio: true,
  ptv: true,
  sticker: true,
  reactions: true,
  polls: true,
  qrCode: true,
  pairingCode: true,
  video: false,
});

export const ZAPO_WHATSAPP_CAPABILITIES: WhatsAppProviderCapabilities = Object.freeze({
  auth: true,
  messaging: true,
  contacts: true,
  chats: true,
  groups: true,
  statusRead: true,
  statusPublish: true,
  presence: true,
  media: true,
  profile: true,
  privacy: true,
  labels: true,
  receipts: true,
  businessProfile: true,
  // Read-only commerce over ZAPO's public queryWithContext plugin surface.
  // Products, native cursors and collections share the existing API contract.
  businessCatalog: true,
  calls: true,
  voice: true,
  text: true,
  location: true,
  audio: true,
  ptv: true,
  sticker: true,
  reactions: true,
  polls: true,
  qrCode: true,
  pairingCode: true,
  video: false,
});

export function assertRequiredWhatsAppCapabilities(capabilities: WhatsAppProviderCapabilities): void {
  const missing = WHATSAPP_REQUIRED_CAPABILITIES.filter((capability) => capabilities[capability] !== true);
  if (missing.length) {
    throw new Error(`WhatsApp provider is missing required capabilities: ${missing.join(', ')}`);
  }
}
