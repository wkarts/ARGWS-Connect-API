/** Runtime visibility, not API authorization. New UI features must be registered
 * here and attached to both their navigation entry and route metadata.
 */
export const MANAGER_FEATURE_DEFAULTS = {
  voice: ['MANAGER_FEATURE_VOICE', true],
  voiceExtensions: ['MANAGER_FEATURE_VOICE_EXTENSIONS', false],
  voiceQueues: ['MANAGER_FEATURE_VOICE_QUEUES', false],
  flows: ['MANAGER_FEATURE_FLOWS', false],
  automations: ['MANAGER_FEATURE_AUTOMATIONS', false],
  docs: ['MANAGER_FEATURE_DOCS', true],
  conversations: ['MANAGER_FEATURE_CONVERSATIONS', false],
  contacts: ['MANAGER_FEATURE_CONTACTS', false],
  messages: ['MANAGER_FEATURE_MESSAGES', false],
  instanceTestMessage: ['MANAGER_FEATURE_INSTANCE_TEST_MESSAGE', true],
  testMessageContacts: ['MANAGER_FEATURE_TEST_MESSAGE_CONTACTS', false],
  users: ['MANAGER_FEATURE_USERS', false],
  permissions: ['MANAGER_FEATURE_PERMISSIONS', false],
  audit: ['MANAGER_FEATURE_AUDIT', false],
  security: ['MANAGER_FEATURE_SECURITY', false],
  updates: ['MANAGER_FEATURE_UPDATES', true],
  settings: ['MANAGER_FEATURE_SETTINGS', true],
} as const;

export function managerFeatures(env: Record<string, string | undefined> = process.env) {
  return Object.fromEntries(
    Object.entries(MANAGER_FEATURE_DEFAULTS).map(([feature, [name, fallback]]) => {
      const value = env[name]?.trim().toLowerCase();
      return [feature, value ? ['1', 'true', 'yes', 'on'].includes(value) : fallback];
    }),
  );
}
