// Consumer-neutral webhook regressions. All contacts/HTTP identities are fixtures.
import assert from 'node:assert/strict';

import { MetaCloudAuthService } from '../../src/api/compat/meta-cloud/meta-cloud-auth.service';
import { MetaCloudIdentityResolver } from '../../src/api/compat/meta-cloud/meta-cloud-identity.resolver';
import { MetaCloudStatusMapper } from '../../src/api/compat/meta-cloud/meta-cloud-status.mapper';
import { MetaCloudWebhookSerializer } from '../../src/api/compat/meta-cloud/meta-cloud-webhook.serializer';

const phone = '557596236940';
const pn = `${phone}@s.whatsapp.net`;
const lid = '22654721644999@lid';
const ownPhone = '5575988449231';
const ownJid = `${ownPhone}@s.whatsapp.net`;
const identity: any = {
  instanceId: 'instance-a', instanceName: 'fixture', provider: 'WHATSAPP-ZAPO',
  phoneNumberId: ownPhone, businessAccountId: ownPhone, displayPhoneNumber: ownPhone,
  token: 'instance-token-fixture', instance: { profileName: 'Own Account' },
};
const value = (payload: any) => payload.entry[0].changes[0].value;
const record = (extra: any = {}) => ({
  key: { id: 'PHONE-OUT-1', remoteJid: lid, remoteJidAlt: pn, fromMe: false },
  messageTimestamp: 1789052400,
  message: { conversation: 'Enviado pelo smartphone' },
  ...extra,
});
function setup(rows: any[] = []) {
  const queries: any[] = [];
  const prisma: any = {
    instance: { findUnique: async () => ({ id: identity.instanceId, name: identity.instanceName,
      integration: identity.provider, number: ownPhone, token: identity.token }) },
    contact: { findMany: async (query: any) => {
      queries.push(query);
      return rows.filter((row) => row.instanceId === query.where.instanceId &&
        query.where.remoteJid.in.includes(row.remoteJid)).map((row) => ({ ...row }));
    } },
  };
  const resolver = new MetaCloudIdentityResolver(prisma);
  return { resolver, queries, serializer: new MetaCloudWebhookSerializer(resolver, new MetaCloudStatusMapper()) };
}
const contact = (extra: any = {}) => ({
  instanceId: identity.instanceId, remoteJid: pn, pushName: 'Known Contact',
  profilePicUrl: 'https://example.invalid/contact.jpg', updatedAt: new Date('2026-09-10'), ...extra,
});

export async function runWebhookIdentityRegression() {
  let count = 0;
  const check = async (name: string, test: () => unknown | Promise<unknown>) => {
    await test(); count++; console.log(`meta webhook: ok ${count} - ${name}`);
  };
  await check('inbound LID+PN selects peer and preserves message ID/content', async () => {
    const { serializer } = setup();
    const payload = value(await serializer.serializeIncoming(identity, record({ pushName: 'Event Contact' })));
    assert.equal(payload.contacts[0].wa_id, phone);
    assert.equal(payload.contacts[0].profile.name, 'Event Contact');
    assert.equal(payload.messages[0].from, phone);
    assert.equal(payload.messages[0].id, 'PHONE-OUT-1');
    assert.equal(payload.messages[0].text.body, 'Enviado pelo smartphone');
    assert.equal(payload.messages[0].connect_api.from_me, false);
    assert.equal(payload.messages[0].connect_api.remote_jid, lid);
    assert.equal(payload.messages[0].connect_api.remote_jid_alt, pn);
  });
  for (const source of ['android', 'ios', 'web', 'api']) {
    await check(`outbound ${source} uses own phone, not peer, without rewriting source`, async () => {
      const { serializer } = setup([contact()]);
      const payload = value(await serializer.serializeIncoming(identity, record({
        key: { id: 'PHONE-OUT-1', remoteJid: lid, remoteJidAlt: pn, fromMe: true },
        source, pushName: 'Own Account', profilePicUrl: 'https://example.invalid/own.jpg',
      })));
      assert.equal(payload.contacts[0].wa_id, phone);
      assert.equal(payload.messages[0].from, ownPhone);
      assert.equal(payload.messages[0].connect_api.from_me, true);
      assert.equal(payload.messages[0].connect_api.source, source);
      assert.equal(payload.contacts[0].profile.name, 'Known Contact');
      assert.equal(payload.contacts[0].profile.picture, 'https://example.invalid/contact.jpg');
    });
  }
  for (const location of ['key', 'record', 'raw']) {
    await check(`fromMe true at ${location} is retained`, async () => {
      const { serializer } = setup();
      const data: any = record({ key: { id: '1', remoteJid: pn } });
      const input = location === 'raw' ? { data, fromMe: true } : data;
      if (location === 'key') data.key.fromMe = true;
      if (location === 'record') data.fromMe = true;
      assert.equal(value(await serializer.serializeIncoming(identity, input)).messages[0].from, ownPhone);
    });
  }
  await check('explicit false has precedence over fallback true and string false is not truthy', async () => {
    const { serializer } = setup();
    for (const fromMe of [false, 'false']) {
      const payload = value(await serializer.serializeIncoming(identity, {
        data: record({ key: { id: '1', remoteJid: pn, fromMe }, fromMe: true }), fromMe: true,
      }));
      assert.equal(payload.messages[0].from, phone);
      assert.equal(payload.messages[0].connect_api.from_me, false);
    }
  });
  for (const remote of [pn, `${phone}@c.us`, `${phone}:17@s.whatsapp.net`, phone]) {
    await check(`telephone normalization for ${remote}`, async () => {
      const { serializer } = setup();
      const payload = value(await serializer.serializeIncoming(identity, record({ key: { id: '1', remoteJid: remote } })));
      assert.equal(payload.contacts[0].wa_id, phone);
      assert.equal(payload.messages[0].from, phone);
    });
  }
  await check('PN is preferred even when the alternate address is a LID', async () => {
    const { serializer } = setup();
    const payload = value(await serializer.serializeIncoming(identity, record({ key: { id: '1', remoteJid: pn, remoteJidAlt: lid } })));
    assert.equal(payload.contacts[0].wa_id, phone);
  });
  for (const field of ['senderPn', 'participantAlt', 'participant', 'sender']) {
    await check(`legitimate phone fallback in ${field}`, async () => {
      const { serializer } = setup();
      const payload = value(await serializer.serializeIncoming(identity, record({ key: { id: '1', remoteJid: lid }, [field]: pn })));
      assert.equal(payload.contacts[0].wa_id, phone);
    });
  }
  await check('unresolved LID keeps opaque identity and never uses own sender as peer', async () => {
    const { serializer } = setup([contact({ remoteJid: lid, pushName: 'LID Contact' })]);
    const payload = value(await serializer.serializeIncoming(identity, record({ key: { id: '1', remoteJid: lid }, sender: ownJid })));
    assert.equal(payload.contacts[0].wa_id, '');
    assert.equal(payload.messages[0].from, '');
    assert.equal(payload.contacts[0].profile.name, 'LID Contact');
    assert.equal(payload.messages[0].connect_api.remote_jid, lid);
    assert.equal(payload.messages[0].connect_api.phone_resolved, false);
  });
  await check('only matching contacts in this instance can supply name or picture', async () => {
    const { serializer, queries } = setup([
      contact({ instanceId: 'instance-b', pushName: 'Wrong Tenant' }),
      contact({ remoteJid: ownJid, pushName: 'Own Account' }),
      contact({ remoteJid: '5511999999999@s.whatsapp.net', pushName: 'Unrelated' }),
      contact(),
    ]);
    const payload = value(await serializer.serializeIncoming(identity, record({ senderPn: ownJid, participantAlt: '5511999999999@s.whatsapp.net' })));
    assert.equal(payload.contacts[0].profile.name, 'Known Contact');
    assert.equal(queries.length, 1);
    assert.equal(queries[0].where.instanceId, identity.instanceId);
    assert.ok(!queries[0].where.remoteJid.in.includes(ownJid));
    assert.ok(!queries[0].where.remoteJid.in.includes('5511999999999@s.whatsapp.net'));
    assert.deepEqual(Object.keys(queries[0].select).sort(), ['profilePicUrl', 'pushName', 'remoteJid', 'updatedAt']);
  });
  await check('unrelated participant LID cannot override a directly addressed contact', async () => {
    const { serializer, queries } = setup([
      contact({ pushName: 'Correct Peer', profilePicUrl: null }),
      contact({ remoteJid: '999999999999999@lid', pushName: 'Different Participant' }),
    ]);
    const payload = value(await serializer.serializeIncoming(identity, record({
      key: { id: 'DIRECT', remoteJid: pn, participant: '999999999999999@lid', fromMe: true },
    })));
    assert.equal(payload.contacts[0].profile.name, 'Correct Peer');
    assert.ok(!queries[0].where.remoteJid.in.includes('999999999999999@lid'));
  });
  await check('inbound event name/photo precedes stored profile; no database mutation', async () => {
    const row = contact();
    const { serializer } = setup([row]);
    const payload = value(await serializer.serializeIncoming(identity, record({ pushName: 'Current Name', profilePicUrl: 'https://example.invalid/current.jpg' })));
    assert.equal(payload.contacts[0].profile.name, 'Current Name');
    assert.equal(payload.contacts[0].profile.picture, 'https://example.invalid/current.jpg');
    assert.equal(row.pushName, 'Known Contact');
  });
  await check('stored name and picture fill absent event metadata', async () => {
    const { serializer } = setup([contact()]);
    const payload = value(await serializer.serializeIncoming(identity, record({ pushName: ' ', profilePicUrl: '' })));
    assert.equal(payload.contacts[0].profile.name, 'Known Contact');
    assert.equal(payload.contacts[0].profile.picture, 'https://example.invalid/contact.jpg');
  });
  await check('missing name falls back to real phone; no picture/source is invented', async () => {
    const { serializer } = setup();
    const payload = value(await serializer.serializeIncoming(identity, record()));
    assert.equal(payload.contacts[0].profile.name, phone);
    assert.ok(!Object.hasOwn(payload.contacts[0].profile, 'picture'));
    assert.ok(!Object.hasOwn(payload.messages[0].connect_api, 'source'));
  });
  await check('resolver normalizes aliases and ranks completeness then recency', async () => {
    const { resolver, queries } = setup([
      contact({ remoteJid: pn, profilePicUrl: null, updatedAt: new Date('2026-09-11') }),
      contact({ remoteJid: lid, pushName: 'More Complete', updatedAt: new Date('2026-09-01') }),
      contact({ remoteJid: `${phone}@c.us`, pushName: 'Complete and Recent' }),
    ]);
    assert.equal((await resolver.resolveContactProfile(identity.instanceId, [lid, ` ${phone}:3@s.whatsapp.net `, lid]))?.pushName, 'Complete and Recent');
    assert.ok(queries[0].where.remoteJid.in.includes(pn));
    assert.equal(new Set(queries[0].where.remoteJid.in).size, queries[0].where.remoteJid.in.length);
    assert.equal(await resolver.resolveContactProfile('', [pn]), null);
    assert.equal(await resolver.resolveContactProfile(identity.instanceId, []), null);
    assert.equal(await resolver.resolveContactProfile(identity.instanceId, ['nonsense@lid', '123@g.us', 'status@broadcast']), null);
    assert.equal(queries.length, 1);
  });
  for (const [type, key] of [['image', 'imageMessage'], ['audio', 'audioMessage'], ['video', 'videoMessage'], ['document', 'documentMessage'], ['sticker', 'stickerMessage']]) {
    await check(`${type} payload and direction remain correct`, async () => {
      const { serializer } = setup();
      const payload = value(await serializer.serializeIncoming(identity, record({
        key: { id: 'MEDIA-1', remoteJid: lid, remoteJidAlt: pn, fromMe: true },
        message: { [key]: { mimetype: 'application/fixture', caption: 'Caption', fileName: 'file.bin' } },
      })));
      assert.equal(payload.messages[0].type, type);
      assert.equal(payload.messages[0][type].id, 'MEDIA-1');
      assert.equal(payload.messages[0][type].mime_type, 'application/fixture');
      assert.equal(payload.messages[0].from, ownPhone);
    });
  }
  for (const [native, status] of [['SERVER_ACK', 'sent'], ['DELIVERY_ACK', 'delivered'], ['READ', 'read'], ['PLAYED', 'read'], ['ERROR', 'failed'], ['DELETED', 'deleted']]) {
    await check(`status ${status} keeps id and uses real PN recipient`, () => {
      const { serializer, queries } = setup();
      const payload = value(serializer.serializeStatus(identity, record({ update: { status: native } })));
      assert.equal(payload.statuses[0].id, 'PHONE-OUT-1');
      assert.equal(payload.statuses[0].status, status);
      assert.equal(payload.statuses[0].recipient_id, phone);
      assert.equal(queries.length, 0);
      assert.ok(!Object.hasOwn(payload, 'messages'));
    });
  }
  await check('pending status ignored, opaque recipient never rewritten as telephone', () => {
    const { serializer } = setup();
    assert.equal(serializer.serializeStatus(identity, record({ status: 'PENDING' })), null);
    const payload = value(serializer.serializeStatus(identity, record({ key: { id: '1', remoteJid: lid }, status: 'READ' })));
    assert.equal(payload.statuses[0].recipient_id, '');
  });
  await check('group preserves conversation JID and uses participant as inbound sender', async () => {
    const { serializer } = setup([contact()]);
    const group = '120363123456789012@g.us';
    const payload = value(await serializer.serializeIncoming(identity, record({
      key: { id: 'GROUP-1', remoteJid: group, participant: lid, participantAlt: pn, fromMe: false },
      pushName: 'Group Participant',
    })));
    assert.equal(payload.messages[0].from, phone);
    assert.equal(payload.messages[0].connect_api.remote_jid, group);
    assert.equal(payload.messages[0].connect_api.participant, lid);
    assert.equal(payload.messages[0].connect_api.participant_alt, pn);
    assert.notEqual(payload.contacts[0].wa_id, group.split('@')[0]);
  });
  await check('official cloud numeric object ID is not used as outbound sender', async () => {
    const { serializer } = setup();
    const payload = value(await serializer.serializeIncoming({ ...identity, phoneNumberId: '123456789012345678', provider: 'WHATSAPP-BUSINESS' }, record({ fromMe: true, key: { id: '1', remoteJid: pn } })));
    assert.equal(payload.metadata.phone_number_id, '123456789012345678');
    assert.equal(payload.messages[0].from, ownPhone);
  });
  await check('async serialize waits for profile and handles uppercase event', async () => {
    const { serializer } = setup([contact()]);
    const payload = await serializer.serialize({ instanceName: 'fixture', event: 'MESSAGES_UPSERT', data: record(), dateTime: '2026-09-10T12:00:00Z' });
    assert.equal(value(payload).contacts[0].profile.name, 'Known Contact');
  });
  await check('a partial wrapped key retains the raw key alternate and direction', async () => {
    const { serializer } = setup();
    const payload = value(await serializer.serializeIncoming(identity, {
      key: { id: 'WRAPPED', remoteJid: lid, remoteJidAlt: pn, fromMe: true },
      data: { key: { id: 'WRAPPED' }, message: { conversation: 'Wrapped' } },
    }));
    assert.equal(payload.contacts[0].wa_id, phone);
    assert.equal(payload.messages[0].from, ownPhone);
  });
  await check('self-chat still addresses the explicitly provided own PN', async () => {
    const { serializer } = setup();
    const payload = value(await serializer.serializeIncoming(identity, record({ key: { id: 'SELF', remoteJid: ownJid, fromMe: true } })));
    assert.equal(payload.contacts[0].wa_id, ownPhone);
    assert.equal(payload.messages[0].from, ownPhone);
  });
  await check('unsupported addresses do not become phone numbers', async () => {
    const { serializer, resolver } = setup();
    for (const remoteJid of ['1234567890@evil', 'status@broadcast', '120363123456789012@newsletter']) {
      assert.equal(resolver.contactPhone(remoteJid), null);
      assert.equal(await serializer.serializeIncoming(identity, record({ key: { id: 'INVALID', remoteJid } })), null);
    }
  });
  await check('Graph continues to require instance token, without global/customer bypass', () => {
    const auth = new MetaCloudAuthService();
    auth.assertAuthorized(identity, `Bearer ${identity.token}`);
    for (const authorization of ['Bearer global-key-fixture', 'Bearer unrelated', undefined]) {
      assert.throws(() => auth.assertAuthorized(identity, authorization), (error: any) => error.graphCode === 190);
    }
  });
  console.log(`meta-cloud webhook identity: ${count}/${count} passed`);
}
