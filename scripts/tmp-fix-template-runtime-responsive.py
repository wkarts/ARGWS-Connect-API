from pathlib import Path

ROOT = Path('.')


def read(path):
    return (ROOT / path).read_text()


def write(path, text):
    p = ROOT / path
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(text)


def replace_once(text, old, new, label):
    if old not in text:
        raise RuntimeError(f'marker not found: {label}')
    return text.replace(old, new, 1)

# 1) Baileys runtime: interaction is inbound event metadata, not a Prisma Message column.
path = 'src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts'
text = read(path)
text = replace_once(
    text,
    '    const interaction = extractBaileysInteraction(message.message);',
    '    const interaction = message?.key?.fromMe ? null : extractBaileysInteraction(message.message);',
    'interaction only inbound',
)

# Add a single canonical persistence sanitizer before prepareMessage.
marker = '  private prepareMessage(message: proto.IWebMessageInfo): any {'
if 'private messageForPersistence(' not in text:
    helper = '''  private messageForPersistence(messageRaw: any): any {\n    const messageData = { ...messageRaw };\n    // `interaction` is a normalized runtime/event projection consumed by the\n    // Interaction Engine. It intentionally remains outside the legacy Message\n    // table so we do not change the native persistence contract.\n    delete messageData.interaction;\n    delete messageData.pollUpdates;\n    return messageData;\n  }\n\n'''
    text = replace_once(text, marker, helper + marker, 'persistence sanitizer')

text = text.replace(
    '            // eslint-disable-next-line @typescript-eslint/no-unused-vars\n            const { pollUpdates, ...messageData } = messageRaw;\n            const msg = await this.prismaRepository.message.create({ data: messageData });',
    '            const messageData = this.messageForPersistence(messageRaw);\n            const msg = await this.prismaRepository.message.create({ data: messageData });',
    1,
)

# Outbound send path. The transport has already accepted the message before this
# persistence step, so only database-safe fields are submitted to Prisma.
text = text.replace(
    '        const msg = await this.prismaRepository.message.create({ data: messageRaw });',
    '        const messageData = this.messageForPersistence(messageRaw);\n        const msg = await this.prismaRepository.message.create({ data: messageData });',
    1,
)

# Media persistence updates can also happen after interaction normalization.
text = text.replace(
    'await this.prismaRepository.message.update({ where: { id: msg.id }, data: messageRaw });',
    'await this.prismaRepository.message.update({\n                      where: { id: msg.id },\n                      data: this.messageForPersistence(messageRaw),\n                    });',
    1,
)
text = text.replace(
    'await this.prismaRepository.message.update({ where: { id: msg.id }, data: messageRaw });',
    'await this.prismaRepository.message.update({\n                where: { id: msg.id },\n                data: this.messageForPersistence(messageRaw),\n              });',
    1,
)
write(path, text)

# 2) Studio v2: concise user-facing failures and correct transport semantics.
path = 'manager/dist/assets/template-editor-v2.js'
text = read(path)
if 'function humanError' not in text:
    marker = "  const pretty = (value) => {\n"
    # actual source uses one-line function; use stable marker before refreshRegistry instead
    marker2 = '  async function refreshRegistry() {'
    helper = '''  function humanError(value) {\n    const raw = String(value?.message || value || 'Erro desconhecido').replace(/\\s+/g, ' ').trim();\n    const prisma = raw.match(/Unknown argument [`'\"]?([^`'\"\\s]+)|PrismaClientValidationError[:\\s]+([^\\n]+)/i);\n    const concise = prisma ? `Persistência incompatível: ${prisma[1] || prisma[2] || 'erro Prisma'}` : raw;\n    return concise.length > 260 ? `${concise.slice(0, 257)}...` : concise;\n  }\n\n'''
    text = replace_once(text, marker2, helper + marker2, 'human error helper')

# Central toast already receives all errors; summarize only visual error toasts.
text = text.replace(
    "    node.textContent = message;\n    node.classList.toggle('error', error);",
    "    node.textContent = error ? humanError(message) : message;\n    node.classList.toggle('error', error);",
    1,
)

# Diagnostic interception: HTTP acceptance is not delivery confirmation.
old = '''          refs.diagnostic.textContent = pretty({\n            httpStatus: response.status,\n            ok: response.ok,\n            templateExecution: data?.templateExecution || null,\n            response: data,\n          });'''
new = '''          const messageId = data?.key?.id || data?.messages?.[0]?.id || null;\n          refs.diagnostic.textContent = pretty({\n            httpStatus: response.status,\n            ok: response.ok,\n            transportStatus: response.ok ? 'ACCEPTED_BY_PROVIDER' : 'REJECTED',\n            deliveryStatus: response.ok ? 'PENDING_OR_UNKNOWN' : 'NOT_SENT',\n            messageId,\n            templateExecution: data?.templateExecution || null,\n            note: response.ok\n              ? 'O provider aceitou o envio. A confirmação de entrega é assíncrona e não é equivalente ao HTTP 201.'\n              : 'O request falhou antes de uma confirmação de transporte confiável.',\n            response: data,\n          });'''
if old in text:
    text = text.replace(old, new, 1)
else:
    raise RuntimeError('diagnostic marker not found')
write(path, text)

# 3) Phase 4 JS: same concise toast behavior.
path = 'manager/dist/assets/template-editor-phase4.js'
text = read(path)
if 'function conciseError' not in text:
    marker = '  function toast(message, error = false) {'
    helper = '''  function conciseError(value) {\n    const raw = String(value?.message || value || 'Erro desconhecido').replace(/\\s+/g, ' ').trim();\n    return raw.length > 260 ? `${raw.slice(0, 257)}...` : raw;\n  }\n\n'''
    text = replace_once(text, marker, helper + marker, 'phase4 concise error')
text = text.replace('    node.textContent = message;\n    node.classList.toggle(\'error\', error);', "    node.textContent = error ? conciseError(message) : message;\n    node.classList.toggle('error', error);", 1)
write(path, text)

# 4) Responsive CSS: fluid desktop, earlier panel collapse, horizontal mobile catalog,
# safe toast wrapping, dynamic viewport and no fixed overflow traps.
path = 'manager/dist/assets/template-editor.css'
text = read(path)
text = text.replace(
    '.workspace { display: grid; grid-template-columns: 270px minmax(0,1fr) 340px; min-height: calc(100vh - 126px); align-items: stretch; }',
    '.workspace { display: grid; grid-template-columns: clamp(220px,16vw,270px) minmax(0,1fr) clamp(280px,22vw,340px); min-height: calc(100dvh - 126px); align-items: stretch; min-width:0; }',
    1,
)
text = text.replace(
    '.editor-scroll { height: calc(100vh - 252px); overflow: auto; padding: 18px; scrollbar-width: thin; }',
    '.editor-scroll { height: calc(100dvh - 252px); overflow: auto; padding: clamp(12px,1.4vw,18px); scrollbar-width: thin; min-width:0; }',
    1,
)
text = text.replace(
    '.phone { width: 292px; height: 548px;',
    '.phone { width: min(292px,calc(100% - 28px)); height: 548px;',
    1,
)
text = text.replace(
    '.toast { position: fixed; right: 18px; bottom: 18px; z-index: 100; min-width: 260px; max-width: min(460px,calc(100vw - 36px)); padding: 12px 14px; border-radius: 11px; background: #172033; color: white; box-shadow: var(--shadow); opacity: 0; transform: translateY(10px); pointer-events: none; transition: .18s; font-size: 12px; }',
    '.toast { position: fixed; right: 18px; bottom: 18px; z-index: 100; min-width: min(260px,calc(100vw - 36px)); max-width: min(460px,calc(100vw - 36px)); max-height:min(38dvh,280px); overflow:auto; overflow-wrap:anywhere; white-space:normal; padding: 12px 14px; border-radius: 11px; background: #172033; color: white; box-shadow: var(--shadow); opacity: 0; transform: translateY(10px); pointer-events: none; transition: .18s; font-size: 12px; }',
    1,
)

# Replace responsive tail wholesale so breakpoints are coherent.
media_start = text.index('@media (max-width: 1400px)')
text = text[:media_start] + '''@media (max-width: 1500px) {\n  .workspace { grid-template-columns: 225px minmax(0,1fr) 285px; }\n  .phone { width:min(252px,calc(100% - 24px)); height:500px; }\n  .chat-bg { min-height:424px; }\n}\n@media (max-width: 1360px) {\n  .workspace { grid-template-columns: 220px minmax(0,1fr); }\n  .preview-panel { grid-column:1/-1; border-left:0; border-top:1px solid var(--border); display:grid; grid-template-columns:minmax(190px,240px) minmax(250px,320px) 1fr; align-items:start; gap:12px; padding:0 18px 20px; }\n  .preview-panel .panel-title { border-bottom:0; }\n  .phone { margin:18px 0 0; width:250px; }\n  .preview-help { align-self:center; text-align:left; max-width:430px; }\n  .editor-scroll { height:auto; min-height:calc(100dvh - 252px); }\n  .template-list { height:calc(100dvh - 310px); }\n  .integration-grid { grid-template-columns:1fr; }\n}\n@media (max-width: 1024px) {\n  .topbar { padding:9px 12px; }\n  .brand span { display:none; }\n  .connection-panel { grid-template-columns:1fr 1fr; padding:12px; }\n  .connection-panel .button { grid-column:1/-1; }\n  .workspace { display:block; }\n  .catalog-panel { border-right:0; border-bottom:1px solid var(--border); }\n  .catalog-panel .panel-title { min-height:62px; }\n  .catalog-stats { max-width:420px; }\n  .template-list { display:flex; gap:7px; height:auto; max-height:none; overflow-x:auto; overflow-y:hidden; padding:0 12px 12px; scroll-snap-type:x proximity; }\n  .template-item { flex:0 0 min(210px,70vw); margin:0; scroll-snap-align:start; }\n  .editor-toolbar { padding:12px; align-items:flex-start; }\n  .toolbar-actions { flex-wrap:wrap; justify-content:flex-end; }\n  .tabs { padding:0 8px; }\n  .editor-scroll { padding:12px; height:auto; min-height:0; overflow:visible; }\n  .preview-panel { display:block; padding:0 12px 20px; }\n  .preview-panel .panel-title { min-height:60px; }\n  .phone { margin:10px auto 0; width:min(292px,calc(100vw - 34px)); }\n  .preview-help { text-align:center; margin:12px auto 0; }\n  .form-grid.two,.form-grid.three,.card-grid,.card-grid.binding,.binding-json,.compact-grid { grid-template-columns:1fr !important; }\n  .integration-hero { display:block; }\n  .integration-hero .button { margin-top:12px; }\n}\n@media (max-width: 680px) {\n  .topbar { align-items:flex-start; min-height:58px; }\n  .brand-mark { display:none; }\n  .brand .back { width:34px; height:34px; flex-basis:34px; }\n  .brand strong { font-size:13px; }\n  .top-actions { gap:5px; }\n  .top-actions .badge { display:none; }\n  .top-actions .button { padding:8px 9px; min-height:34px; }\n  .connection-panel { grid-template-columns:1fr; padding:10px; }\n  .connection-panel .button { grid-column:auto; width:100%; }\n  .editor-toolbar { display:block; }\n  .toolbar-actions { margin-top:10px; justify-content:flex-start; }\n  .toolbar-actions .button { flex:1 1 auto; }\n  .section-card { padding:13px; border-radius:13px; }\n  .section-heading { align-items:flex-start; }\n  .integration-actions .button { flex:1 1 auto; }\n  .phone { height:500px; border-width:7px; }\n  .chat-bg { min-height:427px; }\n  .result-console,.phase4-console { max-height:220px !important; font-size:10px; }\n}\n@media (max-width: 420px) {\n  .brand strong { max-width:190px; }\n  .top-actions .button { font-size:11px; }\n  .tabs { gap:0; }\n  .tab { padding:11px 10px; font-size:11px; }\n  .catalog-stats { grid-template-columns:repeat(3,minmax(70px,1fr)); overflow-x:auto; }\n  .section-card { padding:11px; }\n  .button { min-height:40px; }\n}\n'''
write(path, text)

# 5) Phase 4 injected grid should follow the same responsive breakpoints.
path = 'manager/dist/assets/template-editor-phase4.js'
text = read(path)
text = text.replace(
    '@media(max-width:1200px){.phase4-grid{grid-template-columns:1fr 1fr}.phase4-card:last-child{grid-column:1/-1}}\n      @media(max-width:760px){.phase4-grid{grid-template-columns:1fr}.phase4-card:last-child{grid-column:auto}.phase4-fields.two{grid-template-columns:1fr}}',
    '@media(max-width:1360px){.phase4-grid{grid-template-columns:1fr 1fr}.phase4-card:last-child{grid-column:1/-1}}\n      @media(max-width:900px){.phase4-grid{grid-template-columns:1fr}.phase4-card:last-child{grid-column:auto}.phase4-fields.two{grid-template-columns:1fr}}',
    1,
)
write(path, text)

# 6) Regression test kept in ignored test/ intentionally; CI stages it with -f.
write('test/template-runtime/foundation.test.ts', r'''import { readFileSync } from 'fs';
import { describe, expect, it } from 'vitest';

const baileys = readFileSync('src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts', 'utf8');
const studio = readFileSync('manager/dist/assets/template-editor-v2.js', 'utf8');
const css = readFileSync('manager/dist/assets/template-editor.css', 'utf8');

describe('template runtime persistence and responsive studio', () => {
  it('keeps normalized interaction out of the legacy Prisma Message payload', () => {
    expect(baileys).toContain('message?.key?.fromMe ? null : extractBaileysInteraction');
    expect(baileys).toContain('private messageForPersistence(');
    expect(baileys).toContain('delete messageData.interaction');
    expect(baileys).toContain('delete messageData.pollUpdates');
  });

  it('distinguishes transport acceptance from asynchronous delivery', () => {
    expect(studio).toContain("transportStatus: response.ok ? 'ACCEPTED_BY_PROVIDER' : 'REJECTED'");
    expect(studio).toContain("deliveryStatus: response.ok ? 'PENDING_OR_UNKNOWN' : 'NOT_SENT'");
  });

  it('has fluid and stacked layouts before mobile widths', () => {
    expect(css).toContain('@media (max-width: 1360px)');
    expect(css).toContain('@media (max-width: 1024px)');
    expect(css).toContain('scroll-snap-type:x proximity');
    expect(css).toContain('overflow-wrap:anywhere');
  });
});
''')

print('template runtime/responsive corrections applied')
