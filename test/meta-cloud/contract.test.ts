// Contract-level non-regression coverage for the additive Meta Cloud Compatible façade.
import assert from 'node:assert/strict';
import fs from 'node:fs';

import { MetaCloudMessageAdapter } from '../../src/api/compat/meta-cloud/meta-cloud-message.adapter';
import { MetaCloudResponseSerializer } from '../../src/api/compat/meta-cloud/meta-cloud-response.serializer';
import { MetaCloudStatusMapper } from '../../src/api/compat/meta-cloud/meta-cloud-status.mapper';
import { isMetaGraphVersion } from '../../src/api/compat/meta-cloud/meta-cloud-version';
import { MetaCloudWebhookSerializer } from '../../src/api/compat/meta-cloud/meta-cloud-webhook.serializer';

async function main() {
  const calls: string[] = [];
  const send: any = {
    sendText: async () => (calls.push('text'), { key: { id: 'TEXT1' } }),
    sendMedia: async (_i: any, data: any) => (calls.push(data.mediatype), { key: { id: `${data.mediatype}1` } }),
    sendWhatsAppAudio: async () => (calls.push('audio'), { key: { id: 'AUDIO1' } }),
    sendLocation: async () => (calls.push('location'), { key: { id: 'LOCATION1' } }),
    sendContact: async () => (calls.push('contacts'), { key: { id: 'CONTACT1' } }),
    sendReaction: async () => (calls.push('reaction'), { key: { id: 'REACTION1' } }),
    sendButtons: async () => (calls.push('button'), { key: { id: 'BUTTON1' } }),
    sendList: async () => (calls.push('list'), { key: { id: 'LIST1' } }),
  };
  const chat: any = { readMessage: async () => calls.push('read') };
  const prisma: any = {
    message: {
      findFirst: async () => ({
        key: { id: 'M1', remoteJid: '5511999999999@s.whatsapp.net', fromMe: false },
      }),
    },
  };
  const monitor: any = { waInstances: { cliente01: { connectionStatus: { state: 'open' } } } };
  const media: any = { resolveOutbound: async (value: any) => value?.link || 'https://signed.example/media' };
  const responses = new MetaCloudResponseSerializer();
  const adapter = new MetaCloudMessageAdapter(send, chat, prisma, monitor, media, responses);
  const identity: any = {
    instanceId: 'i1',
    instanceName: 'cliente01',
    provider: 'WHATSAPP-BAILEYS',
    phoneNumberId: '5575999999999',
    businessAccountId: '5575999999999',
    displayPhoneNumber: '5575999999999',
    token: 'x',
    instance: {},
  };

  assert.equal(isMetaGraphVersion('v18.0'), true);
  assert.equal(isMetaGraphVersion('v22.0'), true);
  assert.equal(isMetaGraphVersion('20.0'), false);

  assert.equal(
    (
      await adapter.execute(identity, {
        messaging_product: 'whatsapp',
        to: '5511888888888',
        type: 'text',
        text: { body: 'Olá' },
      })
    ).messages[0].id,
    'TEXT1',
  );
  await adapter.execute(identity, {
    to: '5511888888888',
    type: 'image',
    image: { link: 'https://e/i.jpg' },
  });
  await adapter.execute(identity, {
    to: '5511888888888',
    type: 'video',
    video: { link: 'https://e/v.mp4' },
  });
  await adapter.execute(identity, {
    to: '5511888888888',
    type: 'document',
    document: { link: 'https://e/f.pdf', filename: 'f.pdf' },
  });
  await adapter.execute(identity, {
    to: '5511888888888',
    type: 'audio',
    audio: { link: 'https://e/a.ogg' },
  });
  await adapter.execute(identity, {
    to: '5511888888888',
    type: 'location',
    location: { latitude: -12.9, longitude: -38.5 },
  });
  await adapter.execute(identity, {
    to: '5511888888888',
    type: 'contacts',
    contacts: [
      {
        name: { formatted_name: 'Cliente' },
        phones: [{ phone: '5511888888888' }],
      },
    ],
  });
  await adapter.execute(identity, {
    to: '5511888888888',
    type: 'reaction',
    reaction: { message_id: 'ABC', emoji: '👍' },
  });
  await adapter.execute(identity, {
    to: '5511888888888',
    type: 'interactive',
    interactive: {
      type: 'button',
      body: { text: 'Escolha' },
      action: {
        buttons: [{ type: 'reply', reply: { id: '1', title: 'Um' } }],
      },
    },
  });
  await adapter.execute(identity, {
    to: '5511888888888',
    type: 'interactive',
    interactive: {
      type: 'list',
      body: { text: 'Escolha' },
      action: {
        button: 'Abrir',
        sections: [
          {
            title: 'S',
            rows: [{ id: '1', title: 'Um', description: 'D' }],
          },
        ],
      },
    },
  });
  await adapter.execute(identity, { status: 'read', message_id: 'M1' });

  for (const name of [
    'text',
    'image',
    'video',
    'document',
    'audio',
    'location',
    'contacts',
    'reaction',
    'button',
    'list',
    'read',
  ]) {
    assert.ok(calls.includes(name), `missing adapter call: ${name}`);
  }

  const statusMapper = new MetaCloudStatusMapper();
  const serializer = new MetaCloudWebhookSerializer({} as any, statusMapper);
  const incoming = serializer.serializeIncoming(identity, {
    key: { id: 'ABC123', remoteJid: '5511888888888@s.whatsapp.net' },
    pushName: 'Cliente',
    messageTimestamp: 1788230000,
    message: { conversation: 'Olá' },
  });
  assert.equal(incoming?.entry[0].changes[0].value.messages[0].id, 'ABC123');
  assert.equal(incoming?.entry[0].changes[0].value.messages[0].text.body, 'Olá');

  const mediaWebhook = serializer.serializeIncoming(identity, {
    key: { id: 'MEDIA123', remoteJid: '5511888888888@s.whatsapp.net' },
    messageTimestamp: 1788230000,
    message: { imageMessage: { mimetype: 'image/jpeg' } },
  });
  assert.equal(mediaWebhook?.entry[0].changes[0].value.messages[0].image.id, 'MEDIA123');

  const delivered = serializer.serializeStatus(identity, {
    key: { id: 'ABC123', remoteJid: '5511888888888@s.whatsapp.net' },
    update: { status: 'DELIVERY_ACK' },
  });
  assert.equal(delivered?.entry[0].changes[0].value.statuses[0].id, 'ABC123');
  assert.equal(delivered?.entry[0].changes[0].value.statuses[0].status, 'delivered');
  assert.equal(
    serializer.serializeStatus(identity, {
      key: { id: 'ABC123' },
      update: { status: 'PENDING' },
    }),
    null,
  );

  const eventManagerSource = fs.readFileSync('src/api/integrations/event/event.manager.ts', 'utf8');
  assert.match(eventManagerSource, /metaCloudDispatcher\.handleEvent/);

  const dispatcherSource = fs.readFileSync(
    'src/api/compat/meta-cloud/meta-cloud-webhook.dispatcher.ts',
    'utf8',
  );
  assert.doesNotMatch(dispatcherSource, /\.message\.create\s*\(/);

  const adapterSource = fs.readFileSync('src/api/compat/meta-cloud/meta-cloud-message.adapter.ts', 'utf8');
  assert.doesNotMatch(adapterSource, /makeWASocket|\.sendMessage\s*\(/);

  const integrationTypes = fs.readFileSync('src/api/types/wa.types.ts', 'utf8');
  assert.doesNotMatch(
    integrationTypes,
    /META-COMPATIBLE|META-CLOUD-COMPATIBLE|WHATSAPP-META-COMPAT|GRAPH-API/,
  );

  const officialBusiness = fs.readFileSync(
    'src/api/integrations/channel/meta/whatsapp.business.service.ts',
    'utf8',
  );
  assert.doesNotMatch(officialBusiness, /message\.from === received\.metadata\.phone_number_id/);

  const officialRouter = fs.readFileSync('src/api/integrations/channel/meta/meta.router.ts', 'utf8');
  assert.match(officialRouter, /mode !== 'subscribe'/);

  console.log('meta-cloud contract compatibility: ok');
}

void main();
