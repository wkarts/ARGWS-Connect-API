import assert from 'node:assert/strict';
import { test } from 'node:test';

import { normalizeStatusRecipient, selectStatusRecipientJids } from '../src/utils/status-recipient.utils';

test('normaliza números enviados pelo Manager e deduplica destinatários do Status', () => {
  assert.deepEqual(
    selectStatusRecipientJids(['+55 (11) 99999-9999', '5511999999999@s.whatsapp.net', '5511888888888@lid']),
    ['5511999999999@s.whatsapp.net', '5511888888888@lid'],
  );
});

test('recusa grupo e identificadores não telefônicos em um broadcast', () => {
  assert.equal(normalizeStatusRecipient('12345@g.us'), null);
  assert.equal(normalizeStatusRecipient('status@broadcast'), null);
  assert.equal(normalizeStatusRecipient('contato@example.com'), null);
  assert.deepEqual(selectStatusRecipientJids(['12345@g.us', '5511999999999']), ['5511999999999@s.whatsapp.net']);
});
