import assert from 'node:assert/strict';
import fs from 'node:fs';

import { extractBaileysInteraction, extractMetaInteraction } from '../../src/api/services/interaction-normalizer';

const meta = extractMetaInteraction({
  type: 'interactive',
  context: { id: 'wamid.outbound' },
  interactive: { type: 'button_reply', button_reply: { id: 'confirm', title: 'Confirmar' } },
});
assert.equal(meta?.id, 'confirm');
assert.equal(meta?.title, 'Confirmar');
assert.equal(meta?.contextMessageId, 'wamid.outbound');

const baileys = extractBaileysInteraction({
  viewOnceMessage: {
    message: {
      buttonsResponseMessage: {
        selectedButtonId: 'confirm',
        selectedDisplayText: 'Confirmar',
        contextInfo: { stanzaId: 'BAILEYS-OUTBOUND' },
      },
    },
  },
});
assert.equal(baileys?.id, 'confirm');
assert.equal(baileys?.contextMessageId, 'BAILEYS-OUTBOUND');

const nativeFlow = extractBaileysInteraction({
  interactiveResponseMessage: {
    nativeFlowResponseMessage: { name: 'quick_reply', paramsJson: JSON.stringify({ id: 'reschedule', display_text: 'Reagendar' }) },
    contextInfo: { stanzaId: 'FLOW-OUTBOUND' },
  },
});
assert.equal(nativeFlow?.id, 'reschedule');
assert.equal(nativeFlow?.title, 'Reagendar');

const textFallback = extractBaileysInteraction({ conversation: 'Confirmar' });
assert.equal(textFallback?.type, 'text_reply');
assert.equal(textFallback?.id, 'Confirmar');

const metaTextFallback = extractMetaInteraction({ type: 'text', text: { body: 'Cancelar' } });
assert.equal(metaTextFallback?.type, 'text_reply');
assert.equal(metaTextFallback?.title, 'Cancelar');

const engine = fs.readFileSync('src/api/services/interaction-engine.service.ts', 'utf8');
assert.match(engine, /templateInteractionSession/);
assert.match(engine, /binding\.type === 'RECIPE'/);
assert.match(engine, /binding\.type === 'ACTION'/);
assert.match(engine, /confirmation === 'STRONG'/);
assert.match(engine, /WAITING_STRONG_CONFIRMATION/);

const templateEngine = fs.readFileSync('src/api/services/template-engine.service.ts', 'utf8');
assert.match(templateEngine, /registerInteractionSession/);
assert.match(templateEngine, /interactionTtlSeconds/);
assert.match(templateEngine, /TEXT_FALLBACK/);
assert.match(templateEngine, /templateExecution/);

// UI contracts are validated by Platform Integrity. The legacy Manager assets
// were intentionally retired; this foundation test now covers Engine behavior only.
console.log('interaction engine foundation: ok');
