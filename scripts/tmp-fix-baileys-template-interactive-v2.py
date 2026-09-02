from pathlib import Path

ROOT = Path('.')


def read(path: str) -> str:
    return (ROOT / path).read_text()


def write(path: str, text: str) -> None:
    target = ROOT / path
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(text)


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f'marker not found: {label}')
    return text.replace(old, new, 1)

# Keep poll protocol normalization in the pure interaction normalizer.
path = 'src/api/services/interaction-normalizer.ts'
text = read(path)
if 'export function extractBaileysPollInteraction' not in text:
    marker = 'export function extractMetaInteraction(message: any): NormalizedInteraction | null {'
    helper = '''export function extractBaileysPollInteraction(message: any): NormalizedInteraction | null {\n  const updates = Array.isArray(message?.pollUpdates) ? message.pollUpdates : [];\n  const selectedOptions = updates\n    .filter((update: any) => Array.isArray(update?.voters) && update.voters.length > 0 && update?.name)\n    .map((update: any) => String(update.name));\n  if (!selectedOptions.length) return null;\n\n  const selected = selectedOptions[0];\n  return {\n    type: 'poll_reply',\n    id: selected,\n    title: selected,\n    contextMessageId: message?.message?.pollUpdateMessage?.pollCreationMessageKey?.id || undefined,\n    payload: { selectedOptions },\n  };\n}\n\n'''
    text = replace_once(text, marker, helper + marker, 'poll normalizer export')
write(path, text)

# Interaction Engine consumes the pure normalizer instead of owning protocol parsing.
path = 'src/api/services/interaction-engine.service.ts'
text = read(path)
if "from './interaction-normalizer'" not in text:
    text = replace_once(
        text,
        "import { ActionExecutionService } from './action-execution.service';",
        "import { ActionExecutionService } from './action-execution.service';\nimport { extractBaileysPollInteraction } from './interaction-normalizer';",
        'interaction normalizer import',
    )
text = text.replace(
    'const interaction = message?.interaction || this.pollInteraction(message);',
    'const interaction = message?.interaction || extractBaileysPollInteraction(message);',
    1,
)
start = text.find('  private pollInteraction(message: any) {')
if start >= 0:
    end = text.find('  private async findSession(instanceId: string, message: any, interaction: any) {', start)
    if end < 0:
        raise RuntimeError('findSession marker not found while removing pollInteraction')
    text = text[:start] + text[end:]
write(path, text)

# Replace the regression test with a side-effect-free protocol/structure test.
write('test/template-engine/baileys-compat.test.ts', r'''import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import { extractBaileysPollInteraction } from '../../src/api/services/interaction-normalizer';
import { renderTemplateDefinition } from '../../src/api/services/template-renderer';

const engineSource = readFileSync('src/api/services/template-engine.service.ts', 'utf8');

assert.match(engineSource, /provider === 'WHATSAPP-BAILEYS'/);
assert.match(engineSource, /sendBaileysCompatibleInteraction/);
assert.match(engineSource, /runtime\.pollMessage/);
assert.match(engineSource, /mode: 'POLL_COMPAT'/);
assert.match(engineSource, /compatibilityTransport: 'BAILEYS_OFFICIAL_POLL'/);
assert.match(engineSource, /mode: 'TEXT_COMPAT'/);

const rendered = renderTemplateDefinition(
  {
    components: [
      { type: 'BODY', text: 'Olá {{1}}, confirme sua solicitação.' },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Confirmar', id: 'confirm' },
          { type: 'QUICK_REPLY', text: 'Cancelar', id: 'cancel' },
        ],
      },
    ],
  },
  [{ type: 'body', parameters: [{ type: 'text', text: 'Wallace' }] }],
);
assert.deepEqual(
  rendered.buttons.map((button) => ({ id: button.id, title: button.displayText })),
  [
    { id: 'confirm', title: 'Confirmar' },
    { id: 'cancel', title: 'Cancelar' },
  ],
);

const normalized = extractBaileysPollInteraction({
  message: { pollUpdateMessage: { pollCreationMessageKey: { id: 'poll-outbound-1' } } },
  pollUpdates: [
    { name: 'Confirmar', voters: ['557599999999@s.whatsapp.net'] },
    { name: 'Cancelar', voters: [] },
  ],
});
assert.equal(normalized?.type, 'poll_reply');
assert.equal(normalized?.id, 'Confirmar');
assert.equal(normalized?.title, 'Confirmar');
assert.equal(normalized?.contextMessageId, 'poll-outbound-1');
assert.deepEqual(normalized?.payload, { selectedOptions: ['Confirmar'] });

assert.equal(extractBaileysPollInteraction({ pollUpdates: [] }), null);

console.log('baileys template compatibility: ok');
''')
