import assert from 'node:assert/strict';

import { normalizeMessagePayload } from '../src/api/compat/message-payload.compat';

const normalize = (payload: Record<string, any>) => normalizeMessagePayload(payload) as Record<string, any>;

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

const currentWins = normalize({
  number: '5575988449231',
  text: 'ATUAL',
  delay: 10,
  options: { delay: 999 },
  textMessage: { text: 'LEGADO' },
});
assert.equal(currentWins.text, 'ATUAL');
assert.equal(currentWins.delay, 10);

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

const poll = normalize({
  number: '5575988449231',
  pollMessage: { name: 'Pergunta', selectableCount: 1, values: ['A', 'B'] },
});
assert.equal(poll.name, 'Pergunta');
assert.deepEqual(poll.values, ['A', 'B']);

const location = normalize({
  number: '5575988449231',
  locationMessage: { latitude: -12.9, longitude: -38.5, name: 'Local', address: 'Endereco' },
});
assert.equal(location.latitude, -12.9);
assert.equal(location.address, 'Endereco');

const contacts = [{ fullName: 'Contato', wuid: '5575988449231', phoneNumber: '+55 75 98844-9231' }];
assert.deepEqual(normalize({ number: '5575988449231', contactMessage: { contact: contacts } }).contact, contacts);
assert.deepEqual(normalize({ number: '5575988449231', contactMessage: { contacts } }).contact, contacts);
assert.deepEqual(normalize({ number: '5575988449231', contactMessage: contacts }).contact, contacts);

assert.equal(normalize({ number: '1', audioMessage: { audio: 'https://example.com/a.ogg' } }).audio, 'https://example.com/a.ogg');
assert.equal(normalize({ number: '1', stickerMessage: { sticker: 'https://example.com/s.webp' } }).sticker, 'https://example.com/s.webp');
assert.equal(normalize({ number: '1', ptvMessage: { video: 'https://example.com/v.mp4' } }).video, 'https://example.com/v.mp4');
assert.equal(normalize({ statusMessage: { type: 'text', content: 'Status' } }).content, 'Status');
assert.equal(normalize({ number: '1', templateMessage: { name: 'hello', language: 'pt_BR', components: [] } }).name, 'hello');

const reaction = normalize({
  reactionMessage: { key: { id: 'ABC', remoteJid: '5575988449231@s.whatsapp.net', fromMe: false }, reaction: '👍' },
});
assert.equal(reaction.reaction, '👍');
assert.equal(reaction.key.id, 'ABC');

console.log('message payload compatibility: ok');
