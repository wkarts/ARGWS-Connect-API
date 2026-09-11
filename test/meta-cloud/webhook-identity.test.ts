import assert from 'node:assert/strict';

import { MetaCloudAuthService } from '../../src/api/compat/meta-cloud/meta-cloud-auth.service';
import { MetaCloudIdentityResolver } from '../../src/api/compat/meta-cloud/meta-cloud-identity.resolver';
import { MetaCloudStatusMapper } from '../../src/api/compat/meta-cloud/meta-cloud-status.mapper';
import { MetaCloudWebhookSerializer } from '../../src/api/compat/meta-cloud/meta-cloud-webhook.serializer';

const phone = '557596236940', pn = `${phone}@s.whatsapp.net`, lid = '22654721644999@lid';
const own = '5575988449231', ownJid = `${own}@s.whatsapp.net`;
const identity: any = { instanceId: 'a', instanceName: 'fixture', provider: 'WHATSAPP-ZAPO', phoneNumberId: own,
  displayPhoneNumber: own, businessAccountId: own, token: 'instance-token-fixture', instance: {} };
const unpack = (payload: any) => payload.entry[0].changes[0].value;
const input = (extras: any = {}) => ({ key: { id: 'PHONE-OUT-1', remoteJid: lid, remoteJidAlt: pn, fromMe: false },
  messageTimestamp: 1789052400, message: { conversation: 'Enviado pelo smartphone' }, ...extras });
const contact = (extras: any = {}) => ({ instanceId: 'a', remoteJid: pn, pushName: 'Contato remoto',
  profilePicUrl: 'https://example.invalid/remote.jpg', updatedAt: new Date('2026-09-10'), ...extras });
function setup(rows: any[] = []) {
  const queries: any[] = [];
  const prisma: any = {
    instance: { findUnique: async () => ({ id: 'a', name: 'fixture', integration: 'WHATSAPP-ZAPO', number: own }) },
    contact: { findMany: async (query: any) => { queries.push(query); return rows.filter(row =>
      row.instanceId === query.where.instanceId && query.where.remoteJid.in.includes(row.remoteJid)).map(row => ({ ...row })); } },
  };
  const resolver = new MetaCloudIdentityResolver(prisma);
  return { resolver, queries, prisma, serializer: new MetaCloudWebhookSerializer(resolver, new MetaCloudStatusMapper()) };
}
export async function runWebhookIdentityRegression() {
  let passed = 0;
  async function check(name: string, action: () => any) { await action(); passed++; console.log(`meta webhook ok ${passed}: ${name}`); }
  await check('entrada LID+PN: interlocutor e remetente remotos', async () => {
    const { serializer } = setup(); const value = unpack(await serializer.serializeIncoming(identity, input({ pushName: 'Cliente' })));
    assert.equal(value.contacts[0].wa_id, phone); assert.equal(value.messages[0].from, phone);
    assert.equal(value.contacts[0].profile.name, 'Cliente'); assert.equal(value.messages[0].connect_api.from_me, false);
    assert.equal(value.messages[0].id, 'PHONE-OUT-1'); assert.equal(value.messages[0].text.body, 'Enviado pelo smartphone');
  });
  for (const source of ['android', 'ios', 'web', 'api', undefined]) await check(`saída ${source || 'sem origem'}: sem nome/foto próprios no destinatário`, async () => {
    const { serializer } = setup([contact()]);
    const value = unpack(await serializer.serializeIncoming(identity, input({
      key: { id: 'PHONE-OUT-1', remoteJid: lid, remoteJidAlt: pn, fromMe: true }, source,
      pushName: 'Meu perfil', profilePicUrl: 'https://example.invalid/me.jpg',
    })));
    assert.equal(value.contacts[0].wa_id, phone); assert.equal(value.messages[0].from, own);
    assert.equal(value.messages[0].connect_api.from_me, true);
    assert.equal(value.contacts[0].profile.name, 'Contato remoto'); assert.equal(value.contacts[0].profile.picture, 'https://example.invalid/remote.jpg');
    if (source) assert.equal(value.messages[0].connect_api.source, source);
    else assert.equal('source' in value.messages[0].connect_api, false);
  });
  for (const layer of ['key', 'record', 'raw']) await check(`fromMe em ${layer}`, async () => {
    const { serializer } = setup(); const data: any = input({ key: { id: '1', remoteJid: pn } });
    const payload = layer === 'raw' ? { data, fromMe: true } : data;
    if (layer === 'key') data.key.fromMe = true; if (layer === 'record') data.fromMe = true;
    assert.equal(unpack(await serializer.serializeIncoming(identity, payload)).messages[0].from, own);
  });
  await check('false explícito não vira true por fallback', async () => {
    const { serializer } = setup();
    for (const fromMe of [false, 'false']) {
      const data = input({ key: { id: '1', remoteJid: pn, fromMe }, fromMe: true });
      const value = unpack(await serializer.serializeIncoming(identity, { data, fromMe: true }));
      assert.equal(value.messages[0].connect_api.from_me, false); assert.equal(value.messages[0].from, phone);
    }
  });
  for (const remoteJid of [pn, `${phone}@c.us`, `${phone}:17@s.whatsapp.net`, phone]) await check(`PN aceito: ${remoteJid}`, async () => {
    const { serializer } = setup(); const value = unpack(await serializer.serializeIncoming(identity, input({ key: { id: '1', remoteJid } })));
    assert.equal(value.messages[0].from, phone); assert.equal(value.contacts[0].wa_id, phone);
  });
  await check('LID alternativo não oculta PN do campo seguinte', async () => {
    const { serializer } = setup(); const value = unpack(await serializer.serializeIncoming(identity, input({ key: { id: '1', remoteJid: pn, remoteJidAlt: lid } })));
    assert.equal(value.messages[0].from, phone);
  });
  for (const field of ['senderPn', 'participantAlt', 'participant', 'sender']) await check(`PN conhecido em ${field}`, async () => {
    const { serializer } = setup(); const value = unpack(await serializer.serializeIncoming(identity, input({ key: { id: '1', remoteJid: lid }, [field]: pn })));
    assert.equal(value.contacts[0].wa_id, phone);
  });
  await check('LID sem PN não fabrica telefone nem usa remetente próprio', async () => {
    const { serializer } = setup([contact({ remoteJid: lid, pushName: 'Nome pelo LID' })]);
    const value = unpack(await serializer.serializeIncoming(identity, input({ key: { id: '1', remoteJid: lid }, sender: ownJid })));
    assert.equal('wa_id' in value.contacts[0], false); assert.equal('from' in value.messages[0], false);
    assert.equal(value.contacts[0].profile.name, 'Nome pelo LID'); assert.equal(value.messages[0].connect_api.phone_resolved, false);
    assert.equal(value.messages[0].connect_api.remote_jid, lid);
  });
  await check('consulta é exata e isolada por instância', async () => {
    const { serializer, queries } = setup([contact({ instanceId: 'b', pushName: 'Outra empresa' }), contact(), contact({ remoteJid: ownJid })]);
    const value = unpack(await serializer.serializeIncoming(identity, input({ senderPn: ownJid, participantAlt: '5511888888888@s.whatsapp.net' })));
    assert.equal(value.contacts[0].profile.name, 'Contato remoto'); assert.equal(queries.length, 1);
    assert.equal(queries[0].where.instanceId, 'a'); assert.ok(!queries[0].where.remoteJid.in.includes(ownJid));
    assert.ok(!queries[0].where.remoteJid.in.includes('5511888888888@s.whatsapp.net'));
    assert.deepEqual(Object.keys(queries[0].select).sort(), ['profilePicUrl', 'pushName', 'remoteJid', 'updatedAt']);
  });
  await check('participante LID alheio não fornece perfil mais completo ao peer direto', async () => {
    const { serializer, queries } = setup([contact({ profilePicUrl: null }), contact({ remoteJid: '99999999999999@lid', pushName: 'Outra pessoa' })]);
    const value = unpack(await serializer.serializeIncoming(identity, input({ key: { id: '1', remoteJid: pn, participant: '99999999999999@lid', fromMe: true } })));
    assert.equal(value.contacts[0].profile.name, 'Contato remoto'); assert.ok(!queries[0].where.remoteJid.in.includes('99999999999999@lid'));
  });
  await check('evento de entrada tem precedência no perfil sem persistir alterações', async () => {
    const row = contact(); const { serializer } = setup([row]);
    const value = unpack(await serializer.serializeIncoming(identity, input({ pushName: 'Nome do evento', profilePicUrl: 'https://example.invalid/event.jpg' })));
    assert.equal(value.contacts[0].profile.name, 'Nome do evento'); assert.equal(value.contacts[0].profile.picture, 'https://example.invalid/event.jpg');
    assert.equal(row.pushName, 'Contato remoto');
  });
  await check('perfil somente no banco é reutilizado', async () => {
    const { serializer } = setup([contact()]); const value = unpack(await serializer.serializeIncoming(identity, input({ pushName: ' ', profilePicUrl: '' })));
    assert.equal(value.contacts[0].profile.name, 'Contato remoto'); assert.equal(value.contacts[0].profile.picture, 'https://example.invalid/remote.jpg');
  });
  await check('foto e nome próprios na saída não são fallback remoto', async () => {
    const { serializer } = setup(); const value = unpack(await serializer.serializeIncoming(identity, input({
      key: { id: '1', remoteJid: pn, fromMe: true }, pushName: 'Meu perfil', profilePicUrl: 'https://example.invalid/me.jpg' })));
    assert.equal(value.contacts[0].profile.name, phone); assert.equal('picture' in value.contacts[0].profile, false);
  });
  await check('completude e depois atualização ordenam aliases persistidos', async () => {
    const { resolver, queries } = setup([contact({ profilePicUrl: null }), contact({ remoteJid: lid, pushName: 'Completo antigo', updatedAt: new Date('2020-01-01') }), contact({ remoteJid: `${phone}@c.us`, pushName: 'Completo recente' })]);
    assert.equal((await resolver.resolveContactProfile('a', [lid, `${phone}:3@s.whatsapp.net`, lid]))?.pushName, 'Completo recente');
    assert.equal(await resolver.resolveContactProfile('a', []), null);
    assert.equal(await resolver.resolveContactProfile('', [pn]), null);
    assert.equal(await resolver.resolveContactProfile('a', ['text123@lid', '123@g.us']), null); assert.equal(queries.length, 1);
    assert.equal(new Set(queries[0].where.remoteJid.in).size, queries[0].where.remoteJid.in.length);
  });
  for (const type of ['image', 'video', 'audio', 'document', 'sticker']) await check(`mídia ${type} mantém ID e semântica`, async () => {
    const { serializer } = setup(); const value = unpack(await serializer.serializeIncoming(identity, input({ key: { id: 'MEDIA1', remoteJid: pn, fromMe: true }, message: { [`${type}Message`]: { mimetype: 'application/fixture', caption: 'Legenda', fileName: 'a.bin' } } })));
    const message = value.messages[0]; assert.equal(message.from, own); assert.equal(message.type, type);
    assert.equal(message[type].id, 'MEDIA1'); assert.equal(message[type].mime_type, 'application/fixture');
  });
  for (const [state, expected] of [['SERVER_ACK', 'sent'], ['DELIVERY_ACK', 'delivered'], ['READ', 'read'], ['PLAYED', 'read'], ['ERROR', 'failed'], ['DELETED', 'deleted']]) await check(`status ${state} preservado`, () => {
    const { serializer, queries } = setup(); const value = unpack(serializer.serializeStatus(identity, input({ update: { status: state } })));
    assert.equal(value.statuses[0].id, 'PHONE-OUT-1'); assert.equal(value.statuses[0].status, expected);
    assert.equal(value.statuses[0].recipient_id, phone); assert.equal(queries.length, 0); assert.equal('messages' in value, false);
  });
  await check('status pending e destinatário LID desconhecido', () => {
    const { serializer } = setup(); assert.equal(serializer.serializeStatus(identity, input({ status: 'PENDING' })), null);
    const value = unpack(serializer.serializeStatus(identity, input({ key: { id: '1', remoteJid: lid }, status: 'READ' })));
    assert.equal(value.statuses[0].recipient_id, '');
  });
  await check('grupo mantém JID da conversa separado do participante', async () => {
    const { serializer } = setup(); const group = '123456789-123456@g.us';
    const value = unpack(await serializer.serializeIncoming(identity, input({ key: { id: 'G1', remoteJid: group, participant: lid, participantAlt: pn }, pushName: 'Participante' })));
    assert.equal(value.messages[0].from, phone); assert.equal(value.messages[0].connect_api.remote_jid, group);
    assert.equal(value.messages[0].connect_api.participant, lid); assert.equal(value.contacts[0].wa_id, phone);
  });
  await check('saída em grupo sem participante não cria contato de grupo telefônico', async () => {
    const { serializer } = setup(); const value = unpack(await serializer.serializeIncoming(identity, input({ key: { id: 'G1', remoteJid: '12345@g.us', fromMe: true } })));
    assert.equal(value.contacts.length, 0); assert.equal(value.messages[0].from, own);
  });
  await check('eco de grupo não atribui o perfil do participante local ao destinatário', async () => {
    const { serializer } = setup([contact({ remoteJid: lid, pushName: 'Meu perfil' })]);
    const value = unpack(await serializer.serializeIncoming(identity, input({ key: { id: 'G1', remoteJid: '12345@g.us', participant: lid, participantAlt: ownJid, fromMe: true } })));
    assert.equal(value.contacts.length, 0); assert.equal(value.messages[0].from, own);
  });
  await check('payload oficial de entrada conserva metadados e campos existentes', async () => {
    const { serializer, resolver } = setup();
    const business = resolver.identityFromInstance({ id: 'a', name: 'official', integration: 'WHATSAPP-BUSINESS', number: '123456789012345', businessId: 'waba-fixture' });
    const value = unpack(await serializer.serializeIncoming(business, input({ key: { id: 'wamid.actual-id', remoteJid: pn, fromMe: false }, pushName: 'Cliente oficial' })));
    assert.deepEqual(value.metadata, { display_phone_number: '123456789012345', phone_number_id: '123456789012345' });
    const { connect_api, ...standard } = value.messages[0]; assert.equal(connect_api.from_me, false);
    assert.deepEqual(standard, { from: phone, id: 'wamid.actual-id', timestamp: '1789052400', type: 'text', text: { body: 'Enviado pelo smartphone' } });
  });
  await check('Graph object ID não é telefone do remetente oficial', async () => {
    const { serializer } = setup(); const business = { ...identity, provider: 'WHATSAPP-BUSINESS', phoneNumberId: '123456789012345', displayPhoneNumber: '123456789012345' };
    const data = input({ key: { id: '1', remoteJid: pn, fromMe: true } });
    assert.equal('from' in unpack(await serializer.serializeIncoming(business, data)).messages[0], false);
    const value = unpack(await serializer.serializeIncoming(business, { ...data, metadata: { display_phone_number: own } }));
    assert.equal(value.messages[0].from, own); assert.equal(value.metadata.phone_number_id, '123456789012345');
  });
  await check('falha de enriquecimento não descarta mensagem', async () => {
    const { serializer, prisma } = setup(); prisma.contact.findMany = async () => { throw new Error('database fixture failure'); };
    const value = unpack(await serializer.serializeIncoming(identity, input({ pushName: 'Evento' })));
    assert.equal(value.messages[0].from, phone); assert.equal(value.contacts[0].profile.name, 'Evento');
  });
  await check('serialização aguarda consulta assíncrona e aceita evento uppercase', async () => {
    const { serializer, prisma } = setup(); let release: (value: any) => void = () => undefined;
    prisma.contact.findMany = () => new Promise(resolve => { release = resolve; });
    let complete = false; const result = serializer.serialize({ instanceName: 'fixture', event: 'MESSAGES_UPSERT', data: input() } as any).then(payload => { complete = true; return payload; });
    await new Promise(resolve => setTimeout(resolve, 0)); assert.equal(complete, false); release([contact()]);
    assert.equal(unpack(await result).contacts[0].profile.name, 'Contato remoto');
  });
  await check('campos da chave parcial preservam fallback bruto', async () => {
    const { serializer } = setup(); const value = unpack(await serializer.serializeIncoming(identity, {
      key: { id: '1', remoteJid: lid, remoteJidAlt: pn, fromMe: true }, data: { key: { id: '1' }, message: { conversation: 'Parcial' } } }));
    assert.equal(value.messages[0].from, own); assert.equal(value.contacts[0].wa_id, phone);
  });
  await check('broadcast e canal não viram conversas individuais', async () => {
    const { serializer } = setup(); for (const remoteJid of ['status@broadcast', '12345@newsletter', '12345@invalid'])
      assert.equal(await serializer.serializeIncoming(identity, input({ key: { id: '1', remoteJid } })), null);
  });
  await check('Bearer continua exclusivo ao token da instância', () => {
    const auth = new MetaCloudAuthService(); auth.assertAuthorized(identity, 'Bearer instance-token-fixture');
    for (const token of ['Bearer global-key', 'Bearer wrong', undefined]) assert.throws(() => auth.assertAuthorized(identity, token), (error: any) => error.graphCode === 190);
  });
  console.log(`Meta webhook regression: ${passed}/${passed} passed`);
}
