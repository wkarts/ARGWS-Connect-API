import assert from 'node:assert/strict';
import test from 'node:test';

import {
  STATUS_BROADCAST_JID,
  STATUS_BROADCAST_TTL_SECONDS,
  StatusBroadcastRetentionService,
} from '../src/api/services/status-broadcast-retention.service';

type StoredMessage = {
  id: string;
  instanceId: string;
  remoteJid: string;
  messageTimestamp: number;
};

const now = Math.floor(Date.now() / 1000);

function createRepository(
  messages: StoredMessage[],
  settings: Array<{ instanceId: string; readStatus: boolean }>,
  media: Record<string, { fileName: string }> = {},
) {
  const state = {
    messages: [...messages],
    media: new Map(Object.entries(media)),
  };

  const repository = {
    setting: {
      findMany: async () => settings,
    },
    media: {
      findUnique: async ({ where }: any) => state.media.get(where.messageId) ?? null,
    },
    message: {
      findMany: async ({ where, take }: any) => {
        const lifecycle = where.AND[1];
        const expiration = lifecycle.OR?.[0]?.messageTimestamp?.lte;
        const enabledInstances = lifecycle.OR?.[1]?.instanceId?.notIn as string[] | undefined;

        return state.messages
          .filter((message) => message.remoteJid === STATUS_BROADCAST_JID)
          .filter(
            (message) =>
              expiration === undefined ||
              message.messageTimestamp <= expiration ||
              (enabledInstances ? !enabledInstances.includes(message.instanceId) : true),
          )
          .sort((left, right) => left.messageTimestamp - right.messageTimestamp)
          .slice(0, take)
          .map((message) => ({ id: message.id }));
      },
      deleteMany: async ({ where }: any) => {
        const index = state.messages.findIndex((message) => message.id === where.id);
        if (index < 0) return { count: 0 };
        state.messages.splice(index, 1);
        state.media.delete(where.id);
        return { count: 1 };
      },
    },
  };

  return { repository, state };
}

test('removes all status data for an instance that did not opt in', async () => {
  const { repository, state } = createRepository(
    [
      { id: 'disabled-status', instanceId: 'disabled', remoteJid: STATUS_BROADCAST_JID, messageTimestamp: now },
      { id: 'chat-message', instanceId: 'disabled', remoteJid: '5511999999999@s.whatsapp.net', messageTimestamp: now },
    ],
    [],
    { 'disabled-status': { fileName: 'disabled/status.mp4' } },
  );
  const removedFiles: string[] = [];
  const service = new StatusBroadcastRetentionService(repository as any, async (fileName) => {
    removedFiles.push(fileName);
    return true;
  });

  await service.prune();

  assert.deepEqual(removedFiles, ['disabled/status.mp4']);
  assert.deepEqual(state.messages.map((message) => message.id), ['chat-message']);
});

test('keeps an opted-in status only through WhatsApp status lifetime', async () => {
  const { repository, state } = createRepository(
    [
      { id: 'fresh-enabled', instanceId: 'enabled', remoteJid: STATUS_BROADCAST_JID, messageTimestamp: now },
      {
        id: 'expired-enabled',
        instanceId: 'enabled',
        remoteJid: STATUS_BROADCAST_JID,
        messageTimestamp: now - STATUS_BROADCAST_TTL_SECONDS - 1,
      },
      { id: 'fresh-disabled', instanceId: 'disabled', remoteJid: STATUS_BROADCAST_JID, messageTimestamp: now },
    ],
    [{ instanceId: 'enabled', readStatus: true }],
  );
  const service = new StatusBroadcastRetentionService(repository as any, async () => true);

  await service.prune();

  assert.deepEqual(state.messages.map((message) => message.id), ['fresh-enabled']);
});

test('keeps database metadata for a retry when object storage removal fails', async () => {
  const { repository, state } = createRepository(
    [{ id: 'status-with-media', instanceId: 'disabled', remoteJid: STATUS_BROADCAST_JID, messageTimestamp: now }],
    [],
    { 'status-with-media': { fileName: 'disabled/status.mp4' } },
  );
  const service = new StatusBroadcastRetentionService(repository as any, async () => false);

  await service.prune();

  assert.deepEqual(state.messages.map((message) => message.id), ['status-with-media']);
});
