from pathlib import Path
import re

ROOT = Path('.')

MODEL = '''model Template {
  id                 String    @id @default(cuid())
  templateId         String    @db.VarChar(255)
  externalTemplateId String?   @db.VarChar(255)
  name               String    @db.VarChar(255)
  language           String    @default("pt_BR") @db.VarChar(20)
  category           String    @default("UTILITY") @db.VarChar(30)
  status             String    @default("APPROVED") @db.VarChar(30)
  origin             String    @default("LOCAL") @db.VarChar(30)
  enabled            Boolean   @default(true)
  isDefault          Boolean   @default(false)
  template           Json
  actions            Json?
  policy             Json?
  webhookUrl         String?   @db.VarChar(500)
  createdAt          DateTime? @default(now()) @db.Timestamp
  updatedAt          DateTime  @updatedAt @db.Timestamp
  Instance           Instance  @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  instanceId         String

  @@unique([instanceId, templateId])
  @@unique([instanceId, name, language])
  @@index([instanceId])
  @@index([instanceId, category, status])
}'''

for rel in [
    'prisma/postgresql-schema.prisma',
    'prisma/psql_bouncer-schema.prisma',
    'prisma/mysql-schema.prisma',
]:
    path = ROOT / rel
    source = path.read_text()
    updated, count = re.subn(r'model Template \{.*?\n\}', MODEL, source, count=1, flags=re.S)
    if count != 1:
        raise SystemExit(f'Could not replace Template model in {rel}')
    path.write_text(updated)

package = ROOT / 'package.json'
source = package.read_text()
old = '"test:compat": "tsx ./test/message-payload.compat.test.ts && tsx ./test/meta-cloud/foundation.test.ts && tsx ./test/meta-cloud/contract.test.ts"'
new = '"test:compat": "tsx ./test/message-payload.compat.test.ts && tsx ./test/meta-cloud/foundation.test.ts && tsx ./test/meta-cloud/contract.test.ts && tsx ./test/template-engine/foundation.test.ts"'
if old not in source:
    raise SystemExit('package test:compat anchor not found')
package.write_text(source.replace(old, new, 1))

schemas = ROOT / 'docs/scripts/meta-compatible-schemas.mjs'
source = schemas.read_text()
anchor = '  MetaReadReceiptRequest: {'
if anchor not in source:
    raise SystemExit('MetaReadReceiptRequest anchor not found')
insert = '''  MetaTemplateLanguage: {
    type: 'object',
    properties: {
      code: string('Código do idioma do template, por exemplo pt_BR.'),
      policy: string('Política de idioma opcional para compatibilidade com clientes Meta.'),
    },
    required: ['code'],
    additionalProperties: false,
  },
  MetaTemplateParameter: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['text', 'currency', 'date_time', 'image', 'video', 'document', 'payload'] },
      text: string('Valor textual do parâmetro.'),
      payload: string('Payload de botão/resposta rápida.'),
      currency: { type: 'object', additionalProperties: true },
      date_time: { type: 'object', additionalProperties: true },
      image: { type: 'object', additionalProperties: true },
      video: { type: 'object', additionalProperties: true },
      document: { type: 'object', additionalProperties: true },
    },
    required: ['type'],
    additionalProperties: true,
  },
  MetaTemplateComponent: {
    type: 'object',
    properties: {
      type: { type: 'string', enum: ['header', 'body', 'button'] },
      sub_type: string('Subtipo do componente, como quick_reply ou url.'),
      index: { type: 'integer', minimum: 0 },
      parameters: { type: 'array', items: ref('MetaTemplateParameter') },
    },
    required: ['type'],
    additionalProperties: true,
  },
  MetaTemplateContent: {
    type: 'object',
    description: 'Template canônico da instância. Em WHATSAPP-BUSINESS é executado como template Meta real; em providers compatíveis é renderizado pelo Connect|API.',
    properties: {
      name: string('Nome do template.'),
      language: ref('MetaTemplateLanguage'),
      components: { type: 'array', items: ref('MetaTemplateComponent') },
    },
    required: ['name', 'language'],
    additionalProperties: false,
  },
  MetaTemplateMessageRequest: {
    allOf: [ref('MetaMessageBase'), { type: 'object', properties: { type: { type: 'string', const: 'template' }, template: ref('MetaTemplateContent') }, required: ['type', 'template'] }],
  },
'''
source = source.replace(anchor, insert + anchor, 1)
old_union = "      ref('MetaContactsMessageRequest'), ref('MetaReactionMessageRequest'), ref('MetaInteractiveMessageRequest'),\n      ref('MetaReadReceiptRequest'),"
new_union = "      ref('MetaContactsMessageRequest'), ref('MetaReactionMessageRequest'), ref('MetaInteractiveMessageRequest'),\n      ref('MetaTemplateMessageRequest'), ref('MetaReadReceiptRequest'),"
if old_union not in source:
    raise SystemExit('MetaMessageRequest union anchor not found')
source = source.replace(old_union, new_union, 1)
schemas.write_text(source)

generator = ROOT / 'docs/scripts/generate-openapi.mjs'
source = generator.read_text()
old_example = "reaction: { value: { messaging_product: 'whatsapp', to: '5575999999999', type: 'reaction', reaction: { message_id: 'REAL_PROVIDER_ID', emoji: '👍' } } }, read: { value: { messaging_product: 'whatsapp', status: 'read', message_id: 'REAL_PROVIDER_ID' } }"
new_example = "reaction: { value: { messaging_product: 'whatsapp', to: '5575999999999', type: 'reaction', reaction: { message_id: 'REAL_PROVIDER_ID', emoji: '👍' } } }, template: { value: { messaging_product: 'whatsapp', to: '5575999999999', type: 'template', template: { name: 'hello_world', language: { code: 'pt_BR' }, components: [{ type: 'body', parameters: [{ type: 'text', text: 'Cliente' }] }] } } }, read: { value: { messaging_product: 'whatsapp', status: 'read', message_id: 'REAL_PROVIDER_ID' } }"
if old_example not in source:
    raise SystemExit('Graph examples anchor not found')
source = source.replace(old_example, new_example, 1)
generator.write_text(source)

guide = ROOT / 'docs/guides/meta-compatible.md'
source = guide.read_text()
marker = '## Templates canônicos por instância'
if marker not in source:
    source += '''\n\n## Templates canônicos por instância\n\nTemplates são um recurso nativo da instância Connect|API e não ficam restritos ao `/graph`. A API nativa e a camada Meta Compatible utilizam o mesmo catálogo.\n\n- `WHATSAPP-BUSINESS`: o envio continua usando o template real/aprovado pelo provider Meta.\n- `WHATSAPP-BAILEYS`: o Connect|API mantém templates locais em formato compatível e renderiza BODY/HEADER/FOOTER e botões suportados para o provider real.\n- O mesmo nome de template pode existir em instâncias diferentes e em idiomas diferentes.\n- Instâncias locais recebem receitas de exemplo `hello_world`, `sample_utility`, `sample_marketing` e `sample_authentication` quando o catálogo ainda não possui esses nomes.\n\nO endpoint `GET /graph/{version}/{businessAccountId}/message_templates` lista o catálogo apropriado ao provider, e `POST /graph/{version}/{phoneNumberId}/messages` aceita `type: template`. O endpoint nativo `POST /message/sendTemplate/{instanceName}` usa o mesmo engine.\n'''
    guide.write_text(source)
