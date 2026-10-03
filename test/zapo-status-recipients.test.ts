import { strict as assert } from 'node:assert';
import { test } from 'node:test';

import { normalizeStatusRecipient, selectStatusRecipientJids } from '@utils/status-recipient.utils';

test('Status preserva o número brasileiro completo durante a resolução', () => {
  const input = '5575983334153';
  const phoneJid = `${input}@s.whatsapp.net`;
  const lidJid = '123456789012345@lid';

  assert.equal(normalizeStatusRecipient(input), phoneJid);
  assert.deepEqual(
    selectStatusRecipientJids([input], [{ queriedJid: phoneJid, phoneJid, lidJid, exists: true }]),
    [lidJid],
  );
});

test('Status não envia contatos que o usync marcou como inexistentes', () => {
  assert.deepEqual(
    selectStatusRecipientJids(
      ['5511999999999', '5511888888888'],
      [
        { queriedJid: '5511999999999@s.whatsapp.net', phoneJid: '5511999999999@s.whatsapp.net', exists: false },
        { queriedJid: '5511888888888@s.whatsapp.net', phoneJid: '5511888888888@s.whatsapp.net', exists: true },
      ],
    ),
    ['5511888888888@s.whatsapp.net'],
  );
});

test('Status aceita LID já persistido e remove duplicidades', () => {
  const lid = '987654321@lid';
  assert.deepEqual(selectStatusRecipientJids([lid, lid, 'status@broadcast']), [lid]);
});
