import assert from 'node:assert/strict';

import { validate } from 'jsonschema';

import { normalizeMessagePayload } from '../src/api/compat/message-payload.compat';
import {
  audioMessageSchema,
  buttonsMessageSchema,
  contactMessageSchema,
  listMessageSchema,
  locationMessageSchema,
  mediaMessageSchema,
  pollMessageSchema,
  ptvMessageSchema,
  reactionMessageSchema,
  statusMessageSchema,
  stickerMessageSchema,
  templateMessageSchema,
  textMessageSchema,
} from '../src/validate/message.schema';

const normalize = (payload: Record<string, any>) => normalizeMessagePayload(payload) as Record<string, any>;
const expectValid = (payload: Record<string, any>, schema: any) => {
  const result = validate(payload, schema);
  assert.equal(result.valid, true, result.errors.map((error) => error.stack).join('; '));
};

const text = normalize({
  number: '5575988449231',
  options: { delay: 123, linkPreview: true, mentions: { everyOne: false, mentioned: ['5575000000000'] } },
  textMessage: { text: 'TESTE' },
});
assert.equal(text.number, '5575988449231');
assert.equal(text.text, 'TESTE');
assert.equal(text.delay, 123);
assert.equal(text.linkPreview, true);
assert.equal(text.mentionsEveryOne, false);
assert.equal(text.everyOne, false);
assert.deepEqual(text.mentioned, ['5575000000000']);
assert.equal(text.textMessage, undefined);
assert.equal(text.options, undefined);
expectValid(text, textMessageSchema);

const serializedText = normalize({
  number: '5575988449231',
  options: '{"delay":321,"linkPreview":false}',
  textMessage: '{"text":"MULTIPART"}',
  mentions: '{"everyOne":false,"mentioned":["5575000000000"]}',
});
assert.equal(serializedText.text, 'MULTIPART');
assert.equal(serializedText.delay, 321);
assert.equal(serializedText.linkPreview, false);
assert.deepEqual(serializedText.mentioned, ['5575000000000']);
expectValid(serializedText, textMessageSchema);

const rootMentions = normalize({
  number: '5575988449231',
  textMessage: { text: 'MENCAO' },
  mentions: { everyOne: false, mentioned: ['5575000000000'] },
});
assert.deepEqual(rootMentions.mentioned, ['5575000000000']);
expectValid(rootMentions, textMessageSchema);

const currentWins = normalize({
  number: '5575988449231',
  text: 'ATUAL',
  delay: 10,
  options: { delay: 999 },
  textMessage: { text: 'LEGADO' },
});
assert.equal(currentWins.text, 'ATUAL');
assert.equal(currentWins.delay, 10);
expectValid(currentWins, textMessageSchema);

const media = normalize({
  number: '5575988449231',
  options: { delay: 1200, presence: 'composing' },
  mediaMessage: {
    mediatype: 'image',
    mimetype: 'image/jpeg',
    caption: 'Foto',
    media: 'https://example.com/foto.jpg',
  },
});
assert.equal(media.mediatype, 'image');
assert.equal(media.media, 'https://example.com/foto.jpg');
assert.equal(media.caption, 'Foto');
assert.equal(media.delay, 1200);
expectValid(media, mediaMessageSchema);

const serializedMedia = normalize({
  number: '5575988449231',
  options: '{"delay":1500}',
  mediaMessage:
    '{"mediaType":"document","filename":"legado.pdf","mimetype":"application/pdf","media":"https://example.com/legado.pdf"}',
});
assert.equal(serializedMedia.mediatype, 'document');
assert.equal(serializedMedia.fileName, 'legado.pdf');
assert.equal(serializedMedia.delay, 1500);
expectValid(serializedMedia, mediaMessageSchema);

const legacyMediaAliases = normalize({
  number: '5575988449231',
  mediaMessage: {
    mediaType: 'document',
    filename: 'arquivo.pdf',
    media: 'https://example.com/arquivo.pdf',
  },
});
assert.equal(legacyMediaAliases.mediatype, 'document');
assert.equal(legacyMediaAliases.fileName, 'arquivo.pdf');
expectValid(legacyMediaAliases, mediaMessageSchema);

const list = normalize({
  number: '5575988449231',
  options: { delay: 1000 },
  listMessage: {
    title: 'Menu',
    description: 'Escolha',
    buttonText: 'Abrir',
    footerText: 'Rodape',
    sections: [{ title: 'Secao', rows: [{ title: 'Item', description: 'Descricao', rowId: 'item-1' }] }],
  },
});
assert.equal(list.title, 'Menu');
assert.equal(list.buttonText, 'Abrir');
assert.equal(list.sections[0].rows[0].rowId, 'item-1');
expectValid(list, listMessageSchema);

const serializedList = normalize({
  number: '5575988449231',
  listMessage:
    '{"title":"Menu serializado","description":"Escolha","buttonText":"Abrir","footerText":"Rodape","sections":[{"title":"Secao","rows":[{"title":"Item","description":"Descricao","rowId":"item-2"}]}]}',
});
assert.equal(serializedList.title, 'Menu serializado');
expectValid(serializedList, listMessageSchema);

const buttons = normalize({
  number: '5575988449231',
  buttonMessage: {
    title: 'Escolha',
    description: 'Selecione',
    footer: 'Rodape',
    buttons: [{ type: 'reply', displayText: 'Sim', id: 'yes' }],
  },
});
assert.equal(buttons.buttons[0].id, 'yes');
expectValid(buttons, buttonsMessageSchema);

const poll = normalize({
  number: '5575988449231',
  pollMessage: { name: 'Pergunta', selectableCount: 1, values: ['A', 'B'] },
});
assert.equal(poll.name, 'Pergunta');
assert.deepEqual(poll.values, ['A', 'B']);
expectValid(poll, pollMessageSchema);

const location = normalize({
  number: '5575988449231',
  locationMessage: { latitude: -12.9, longitude: -38.5, name: 'Local', address: 'Endereco' },
});
assert.equal(location.latitude, -12.9);
assert.equal(location.address, 'Endereco');
expectValid(location, locationMessageSchema);

const contacts = [{ fullName: 'Contato', wuid: '5575988449231', phoneNumber: '+55 75 98844-9231' }];
const contact = normalize({ number: '5575988449231', contactMessage: { contact: contacts } });
assert.deepEqual(contact.contact, contacts);
expectValid(contact, contactMessageSchema);
assert.deepEqual(normalize({ number: '5575988449231', contactMessage: { contacts } }).contact, contacts);
assert.deepEqual(normalize({ number: '5575988449231', contactMessage: contacts }).contact, contacts);
assert.deepEqual(
  normalize({ number: '5575988449231', contactMessage: JSON.stringify({ contacts }) }).contact,
  contacts,
);

const audio = normalize({ number: '1', audioMessage: { audio: 'https://example.com/a.ogg' } });
assert.equal(audio.audio, 'https://example.com/a.ogg');
expectValid(audio, audioMessageSchema);

const sticker = normalize({ number: '1', stickerMessage: { sticker: 'https://example.com/s.webp' } });
assert.equal(sticker.sticker, 'https://example.com/s.webp');
expectValid(sticker, stickerMessageSchema);

const ptv = normalize({ number: '1', ptvMessage: { video: 'https://example.com/v.mp4' } });
assert.equal(ptv.video, 'https://example.com/v.mp4');
expectValid(ptv, ptvMessageSchema);

const status = normalize({ statusMessage: { type: 'text', content: 'Status' } });
assert.equal(status.content, 'Status');
expectValid(status, statusMessageSchema);

const template = normalize({ number: '1', templateMessage: { name: 'hello', language: 'pt_BR', components: [] } });
assert.equal(template.name, 'hello');
expectValid(template, templateMessageSchema);

const reaction = normalize({
  reactionMessage: { key: { id: 'ABC', remoteJid: '5575988449231@s.whatsapp.net', fromMe: false }, reaction: '👍' },
});
assert.equal(reaction.reaction, '👍');
assert.equal(reaction.key.id, 'ABC');
expectValid(reaction, reactionMessageSchema);

console.log('message payload compatibility: ok');
