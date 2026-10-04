import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import {
  extractStatusViewerReceipt,
  listStatusViewers,
  recordStatusViewerReceipt,
  STATUS_BROADCAST_JID,
} from '@api/services/status-broadcast-viewers.service';

const ownReadReceipt = {
  key: { id: 'status-1', remoteJid: STATUS_BROADCAST_JID, fromMe: true },
  receipt: { userJid: '5511999999999@s.whatsapp.net', readTimestamp: 1 },
};

test('extracts only read or played receipts for this instance outgoing Status', () => {
  assert.deepEqual(extractStatusViewerReceipt(ownReadReceipt), {
    statusId: 'status-1',
    participant: '5511999999999@s.whatsapp.net',
    status: 'VIEWED',
  });
  assert.equal(extractStatusViewerReceipt({ ...ownReadReceipt, receipt: { deliveredTimestamp: 1 } }), null);
  assert.equal(extractStatusViewerReceipt({ ...ownReadReceipt, key: { ...ownReadReceipt.key, fromMe: false } }), null);
  assert.equal(extractStatusViewerReceipt({ ...ownReadReceipt, key: { ...ownReadReceipt.key, remoteJid: 'chat@s.whatsapp.net' } }), null);
});

test('stores each viewer receipt once and scopes the lookup to the instance', async () => {
  const created: any[] = [];
  let existing = false;
  let messageQuery: any;
  const repository = {
    message: {
      findFirst: async (query: any) => {
        messageQuery = query;
        return { id: 'local-message-1' };
      },
    },
    messageUpdate: {
      findFirst: async () => existing ? { id: 'receipt-1' } : null,
      create: async (query: any) => {
        created.push(query.data);
        existing = true;
      },
    },
  };

  assert.equal(await recordStatusViewerReceipt(repository, 'instance-a', ownReadReceipt), true);
  assert.equal(await recordStatusViewerReceipt(repository, 'instance-a', ownReadReceipt), false);
  assert.equal(messageQuery.where.instanceId, 'instance-a');
  assert.equal(created.length, 1);
  assert.equal(created[0].messageId, 'local-message-1');
  assert.equal(created[0].participant, '5511999999999@s.whatsapp.net');
});

test('returns unique viewer identifiers for a locally retained outgoing Status', async () => {
  const repository = {
    message: { findFirst: async () => ({ id: 'local-message-1' }) },
    messageUpdate: {
      findMany: async () => [
        { participant: '5511999999999@s.whatsapp.net', status: 'VIEWED' },
        { participant: '5511999999999@s.whatsapp.net', status: 'VIEWED' },
        { participant: '5511888888888@s.whatsapp.net', status: 'VIEWED' },
      ],
    },
  };

  assert.deepEqual(await listStatusViewers(repository, 'instance-a', 'status-1'), {
    id: 'status-1',
    count: 2,
    viewers: [
      { participant: '5511999999999@s.whatsapp.net', status: 'VIEWED' },
      { participant: '5511888888888@s.whatsapp.net', status: 'VIEWED' },
    ],
  });
});
