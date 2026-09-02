from pathlib import Path
import re

ROOT = Path('.')

PG_MODEL = r'''

model TemplateInteractionSession {
  id                String    @id @default(cuid())
  outboundMessageId String    @db.VarChar(255)
  inboundMessageId  String?   @db.VarChar(255)
  remoteJid         String    @db.VarChar(150)
  templateName      String    @db.VarChar(255)
  language          String    @default("pt_BR") @db.VarChar(20)
  variables         Json?     @db.JsonB
  actions           Json?     @db.JsonB
  status            String    @default("OPEN") @db.VarChar(40)
  expiresAt         DateTime? @db.Timestamp
  lastError         String?   @db.Text
  createdAt         DateTime  @default(now()) @db.Timestamp
  updatedAt         DateTime  @updatedAt @db.Timestamp
  Instance          Instance  @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  instanceId        String

  @@unique([instanceId, outboundMessageId])
  @@index([instanceId, remoteJid, status])
}
'''

MYSQL_MODEL = r'''

model TemplateInteractionSession {
  id                String    @id @default(cuid())
  outboundMessageId String    @db.VarChar(255)
  inboundMessageId  String?   @db.VarChar(255)
  remoteJid         String    @db.VarChar(150)
  templateName      String    @db.VarChar(255)
  language          String    @default("pt_BR") @db.VarChar(20)
  variables         Json?     @db.Json
  actions           Json?     @db.Json
  status            String    @default("OPEN") @db.VarChar(40)
  expiresAt         DateTime? @db.Timestamp
  lastError         String?   @db.Text
  createdAt         DateTime  @default(dbgenerated("CURRENT_TIMESTAMP")) @db.Timestamp
  updatedAt         DateTime  @updatedAt @db.Timestamp
  Instance          Instance  @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  instanceId        String

  @@unique([instanceId, outboundMessageId])
  @@index([instanceId, remoteJid, status])
}
'''

for rel, model in [
    ('prisma/postgresql-schema.prisma', PG_MODEL),
    ('prisma/psql_bouncer-schema.prisma', PG_MODEL),
    ('prisma/mysql-schema.prisma', MYSQL_MODEL),
]:
    path = ROOT / rel
    source = path.read_text()
    relation_anchor = '  ActionExecution         ActionExecution[]\n'
    if relation_anchor not in source:
        raise SystemExit(f'Instance ActionExecution relation anchor missing in {rel}')
    if '  TemplateInteractionSession TemplateInteractionSession[]\n' not in source:
        source = source.replace(
            relation_anchor,
            relation_anchor + '  TemplateInteractionSession TemplateInteractionSession[]\n',
            1,
        )
    if 'model TemplateInteractionSession {' not in source:
        match = re.search(r'model ActionExecution \{.*?\n\}', source, flags=re.S)
        if not match:
            raise SystemExit(f'ActionExecution model anchor missing in {rel}')
        source = source[:match.end()] + model + source[match.end():]
    path.write_text(source)

pg_migration = ROOT / 'prisma/postgresql-migrations/20260902070000_interaction_engine/migration.sql'
pg_migration.parent.mkdir(parents=True, exist_ok=True)
pg_migration.write_text('''-- Connect|API Interaction Engine\nCREATE TABLE "TemplateInteractionSession" (\n  "id" TEXT NOT NULL,\n  "outboundMessageId" VARCHAR(255) NOT NULL,\n  "inboundMessageId" VARCHAR(255),\n  "remoteJid" VARCHAR(150) NOT NULL,\n  "templateName" VARCHAR(255) NOT NULL,\n  "language" VARCHAR(20) NOT NULL DEFAULT 'pt_BR',\n  "variables" JSONB,\n  "actions" JSONB,\n  "status" VARCHAR(40) NOT NULL DEFAULT 'OPEN',\n  "expiresAt" TIMESTAMP(3),\n  "lastError" TEXT,\n  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,\n  "updatedAt" TIMESTAMP(3) NOT NULL,\n  "instanceId" TEXT NOT NULL,\n  CONSTRAINT "TemplateInteractionSession_pkey" PRIMARY KEY ("id")\n);\n\nCREATE UNIQUE INDEX "TemplateInteractionSession_instanceId_outboundMessageId_key" ON "TemplateInteractionSession"("instanceId", "outboundMessageId");\nCREATE INDEX "TemplateInteractionSession_instanceId_remoteJid_status_idx" ON "TemplateInteractionSession"("instanceId", "remoteJid", "status");\nALTER TABLE "TemplateInteractionSession" ADD CONSTRAINT "TemplateInteractionSession_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;\n''')

mysql_migration = ROOT / 'prisma/mysql-migrations/20260902070000_interaction_engine/migration.sql'
mysql_migration.parent.mkdir(parents=True, exist_ok=True)
mysql_migration.write_text('''-- Connect|API Interaction Engine\nCREATE TABLE `TemplateInteractionSession` (\n  `id` VARCHAR(191) NOT NULL,\n  `outboundMessageId` VARCHAR(255) NOT NULL,\n  `inboundMessageId` VARCHAR(255) NULL,\n  `remoteJid` VARCHAR(150) NOT NULL,\n  `templateName` VARCHAR(255) NOT NULL,\n  `language` VARCHAR(20) NOT NULL DEFAULT 'pt_BR',\n  `variables` JSON NULL,\n  `actions` JSON NULL,\n  `status` VARCHAR(40) NOT NULL DEFAULT 'OPEN',\n  `expiresAt` TIMESTAMP(3) NULL,\n  `lastError` TEXT NULL,\n  `createdAt` TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),\n  `updatedAt` TIMESTAMP(3) NOT NULL,\n  `instanceId` VARCHAR(191) NOT NULL,\n  PRIMARY KEY (`id`),\n  UNIQUE INDEX `TemplateInteractionSession_instanceId_outboundMessageId_key` (`instanceId`, `outboundMessageId`),\n  INDEX `TemplateInteractionSession_instanceId_remoteJid_status_idx` (`instanceId`, `remoteJid`, `status`),\n  CONSTRAINT `TemplateInteractionSession_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE\n) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n''')

# Template send variables need to pass native validation.
message_schema = ROOT / 'src/validate/message.schema.ts'
source = message_schema.read_text()
anchor = "    components: { type: 'array' },\n    webhookUrl: { type: 'string' },\n"
if anchor not in source:
    raise SystemExit('templateMessageSchema anchor missing')
if "    variables: { type: 'object' },\n" not in source.split('export const templateMessageSchema', 1)[1].split('};', 1)[0]:
    source = source.replace(anchor, "    components: { type: 'array' },\n    variables: { type: 'object' },\n    webhookUrl: { type: 'string' },\n", 1)
message_schema.write_text(source)

# Template controller should expose the expanded DTO without narrowing it again.
controller = ROOT / 'src/api/controllers/template.controller.ts'
source = controller.read_text()
source = source.replace(
    "import { TemplateDto } from '@api/dto/template.dto';",
    "import { TemplateDeleteDto, TemplateDto, TemplateEditDto } from '@api/dto/template.dto';",
)
source = re.sub(
    r"  public async editTemplate\(\n    instance: InstanceDto,\n    data: \{.*?\},\n  \) \{\n    return this\.templateService\.edit\(instance, data\);\n  \}",
    "  public async editTemplate(instance: InstanceDto, data: TemplateEditDto) {\n    return this.templateService.edit(instance, data);\n  }",
    source,
    flags=re.S,
)
source = source.replace(
    "  public async deleteTemplate(instance: InstanceDto, data: { name: string; hsmId?: string }) {",
    "  public async deleteTemplate(instance: InstanceDto, data: TemplateDeleteDto) {",
)
controller.write_text(source)

# Baileys provider: preserve native payload, attach canonical interaction metadata.
baileys = ROOT / 'src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts'
source = baileys.read_text()
import_anchor = "import { CacheService } from '@api/services/cache.service';\n"
if import_anchor not in source:
    raise SystemExit('Baileys CacheService import anchor missing')
if "@api/services/interaction-normalizer" not in source:
    source = source.replace(import_anchor, import_anchor + "import { extractBaileysInteraction } from '@api/services/interaction-normalizer';\n", 1)
prep_anchor = "  private prepareMessage(message: proto.IWebMessageInfo): any {\n    const contentType = getContentType(message.message);\n    const contentMsg = message?.message[contentType] as any;\n\n    const messageRaw = {\n"
if prep_anchor not in source:
    raise SystemExit('Baileys prepareMessage anchor missing')
source = source.replace(
    prep_anchor,
    "  private prepareMessage(message: proto.IWebMessageInfo): any {\n    const contentType = getContentType(message.message);\n    const contentMsg = message?.message[contentType] as any;\n    const interaction = extractBaileysInteraction(message.message);\n\n    const messageRaw: any = {\n",
    1,
)
return_anchor = "    return messageRaw;\n  }\n\n  private async syncChatwootLostMessages()"
if return_anchor not in source:
    raise SystemExit('Baileys prepareMessage return anchor missing')
source = source.replace(
    return_anchor,
    "    if (interaction) messageRaw.interaction = interaction;\n\n    return messageRaw;\n  }\n\n  private async syncChatwootLostMessages()",
    1,
)
baileys.write_text(source)

# Meta Business provider: keep full Cloud payload and expose normalized reply id/title/context.
business = ROOT / 'src/api/integrations/channel/meta/whatsapp.business.service.ts'
source = business.read_text()
import_anchor = "import { CacheService } from '@api/services/cache.service';\n"
if import_anchor not in source:
    raise SystemExit('Business CacheService import anchor missing')
if "@api/services/interaction-normalizer" not in source:
    source = source.replace(import_anchor, import_anchor + "import { extractMetaInteraction } from '@api/services/interaction-normalizer';\n", 1)
message_anchor = "        const message = received.messages[0]; // Añadir esta línea para definir message\n\n        const key = {"
if message_anchor not in source:
    raise SystemExit('Business message anchor missing')
source = source.replace(
    message_anchor,
    "        const message = received.messages[0]; // Añadir esta línea para definir message\n        const interaction = extractMetaInteraction(message);\n\n        const key = {",
    1,
)
attach_anchor = "\n        if (this.localSettings.readMessages) {\n"
if attach_anchor not in source:
    raise SystemExit('Business interaction attach anchor missing')
source = source.replace(
    attach_anchor,
    "\n        if (interaction) messageRaw.interaction = interaction;\n\n        if (this.localSettings.readMessages) {\n",
    1,
)
business.write_text(source)

# Event manager gets an optional InteractionEngine dispatcher.
event_manager = ROOT / 'src/api/integrations/event/event.manager.ts'
source = event_manager.read_text()
prisma_import = "import { PrismaRepository } from '@api/repository/repository.service';\n"
if prisma_import not in source:
    raise SystemExit('EventManager prisma import anchor missing')
if "InteractionEngineService" not in source:
    source = source.replace(prisma_import, prisma_import + "import { InteractionEngineService } from '@api/services/interaction-engine.service';\n", 1)
field_anchor = "  private metaCloudDispatcher?: MetaCloudWebhookDispatcher;\n"
if field_anchor not in source:
    raise SystemExit('EventManager dispatcher field anchor missing')
if "private interactionEngine?: InteractionEngineService;" not in source:
    source = source.replace(field_anchor, field_anchor + "  private interactionEngine?: InteractionEngineService;\n", 1)
setter_anchor = "  public setMetaCloudDispatcher(dispatcher: MetaCloudWebhookDispatcher): void {\n    this.metaCloudDispatcher = dispatcher;\n  }\n"
if setter_anchor not in source:
    raise SystemExit('EventManager setter anchor missing')
if "setInteractionEngine" not in source:
    source = source.replace(
        setter_anchor,
        setter_anchor + "\n  public setInteractionEngine(engine: InteractionEngineService): void {\n    this.interactionEngine = engine;\n  }\n",
        1,
    )
emit_anchor = "    if (this.metaCloudDispatcher) {\n      void this.metaCloudDispatcher.handleEvent(eventData).catch(() => undefined);\n    }\n"
if emit_anchor not in source:
    raise SystemExit('EventManager emit anchor missing')
if "this.interactionEngine.handleEvent" not in source:
    source = source.replace(
        emit_anchor,
        emit_anchor + "    if (this.interactionEngine) {\n      void this.interactionEngine.handleEvent(eventData).catch(() => undefined);\n    }\n",
        1,
    )
event_manager.write_text(source)

# Server module wires InteractionEngine after TemplateEngine exists.
server = ROOT / 'src/api/server.module.ts'
source = server.read_text()
import_anchor = "import { CacheService } from './services/cache.service';\n"
if import_anchor not in source:
    raise SystemExit('Server CacheService import anchor missing')
if "./services/interaction-engine.service" not in source:
    source = source.replace(import_anchor, import_anchor + "import { InteractionEngineService } from './services/interaction-engine.service';\n", 1)
template_anchor = "export const templateEngine = new TemplateEngineService(waMonitor, prismaRepository);\n"
if template_anchor not in source:
    raise SystemExit('Server templateEngine anchor missing')
if "export const interactionEngine" not in source:
    source = source.replace(
        template_anchor,
        template_anchor
        + "export const interactionEngine = new InteractionEngineService(\n"
        + "  prismaRepository,\n"
        + "  actionExecutionService,\n"
        + "  recipeService,\n"
        + "  templateEngine,\n"
        + "  waMonitor,\n"
        + ");\n",
        1,
    )
event_anchor = "export const eventManager = new EventManager(prismaRepository, waMonitor);\n"
if event_anchor not in source:
    raise SystemExit('Server eventManager anchor missing')
if "eventManager.setInteractionEngine" not in source:
    source = source.replace(event_anchor, event_anchor + "eventManager.setInteractionEngine(interactionEngine);\n", 1)
server.write_text(source)

# Add Phase 3 compatibility test to the existing fast suite.
package = ROOT / 'package.json'
source = package.read_text()
old = 'tsx ./test/recipe-action/foundation.test.ts"'
new = 'tsx ./test/recipe-action/foundation.test.ts && tsx ./test/interaction-engine/foundation.test.ts"'
if new not in source:
    if old not in source:
        raise SystemExit('test:compat anchor missing')
    source = source.replace(old, new, 1)
package.write_text(source)

test = ROOT / 'test/interaction-engine/foundation.test.ts'
test.parent.mkdir(parents=True, exist_ok=True)
test.write_text(r'''import assert from 'node:assert/strict';
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

const engine = fs.readFileSync('src/api/services/interaction-engine.service.ts', 'utf8');
assert.match(engine, /templateInteractionSession/);
assert.match(engine, /binding\.type === 'RECIPE'/);
assert.match(engine, /binding\.type === 'ACTION'/);
assert.match(engine, /confirmation === 'STRONG'/);
assert.match(engine, /WAITING_STRONG_CONFIRMATION/);

const templateEngine = fs.readFileSync('src/api/services/template-engine.service.ts', 'utf8');
assert.match(templateEngine, /registerInteractionSession/);
assert.match(templateEngine, /interactionTtlSeconds/);

const editor = fs.readFileSync('manager/dist/assets/template-editor.js', 'utf8');
assert.match(editor, /\/template\/find\//);
assert.match(editor, /\/action\/find\//);
assert.match(editor, /\/recipe\/find\//);
assert.match(editor, /\/message\/sendTemplate\//);

console.log('interaction engine foundation: ok');
''')

# Document Phase 3 and legacy Template Studio contract.
guide = ROOT / 'docs/guides/interactions-template-studio.md'
guide.write_text(r'''# Interaction Engine e Template Studio

A Fase 3 conecta templates, respostas interativas, Actions e Recipes sem tornar a UI do Manager parte do contrato de negócio.

## Template Studio no Manager legado

O Manager empacotado atual permanece como console operacional legado. O editor é uma extensão isolada e removível em `/manager/template-editor.html`, sem alteração do bundle minificado principal.

O editor permite:

- listar e pesquisar templates da instância;
- criar, editar e duplicar templates;
- montar `HEADER`, `BODY`, `FOOTER` e botões;
- usar `QUICK_REPLY`, `URL`, `PHONE_NUMBER` e `COPY_CODE`;
- vincular Quick Replies a Actions ou Recipes;
- editar `actions` e `policy` em modo visual ou JSON;
- visualizar preview do WhatsApp;
- enviar um template de teste pela API nativa.

O backend continua sendo a fonte de verdade. Uma futura UI pode substituir o Manager sem migrar os templates.

## Bindings de interação

`Template.actions` pode conter `bindings`:

```json
{
  "bindings": [
    {
      "id": "confirm",
      "matchTitle": "Confirmar",
      "type": "RECIPE",
      "key": "scheduler.appointment.confirm",
      "confirmOnInteraction": true,
      "input": {
        "appointmentId": "{{session.variables.appointmentId}}"
      },
      "response": {
        "type": "TEXT",
        "text": "✅ Agendamento confirmado."
      },
      "onError": {
        "type": "TEXT",
        "text": "Não foi possível confirmar agora."
      },
      "keepSessionOpen": false
    }
  ]
}
```

O `id` é o identificador estável do botão. `matchTitle` é fallback de compatibilidade quando um provider devolve somente o título.

## Sessão interativa

Quando um template com bindings é enviado, o Connect|API registra uma sessão por mensagem de saída. A sessão guarda apenas metadados necessários à correlação: instância, mensagem, destinatário, nome/idioma do template, variáveis e bindings.

`policy.interactionTtlSeconds` controla a validade. O padrão é 86400 segundos; a implementação limita o valor entre 60 segundos e 30 dias.

Quando chega uma resposta:

1. Baileys ou Meta Business normaliza a interação em `{ type, id, title, contextMessageId }`;
2. o Interaction Engine localiza a sessão pela mensagem respondida ou, como fallback, pela conversa;
3. o binding resolve o input com `session`, `interaction` e `message`;
4. a Action ou Recipe é executada pelo motor seguro da Fase 2;
5. o resultado pode gerar texto ou outro template;
6. a sessão termina, continua aberta ou falha de acordo com o binding.

## Confirmação

- `NONE`: executa normalmente;
- `CONFIRM`: o clique explícito do usuário pode valer como confirmação quando `confirmOnInteraction` não é `false`;
- `STRONG`: nunca é executada automaticamente pelo clique do WhatsApp. A sessão passa para `WAITING_STRONG_CONFIRMATION` até existir fluxo administrativo forte/RBAC/2FA.

Isso permite ações simples como confirmar agenda e preserva proteção para ações críticas como emissão/cancelamento fiscal, bloqueio de veículo ou operações financeiras.

## Segurança

Templates e Recipes não armazenam credenciais. Integrações usam `credentialRef` nas Actions. O Interaction Engine reaproveita os controles de rede, timeout, validação, auditoria e SSRF do Action Engine.

## Providers

A interação é canônica e não pertence ao Meta Compatible:

- Baileys normaliza respostas nativas e native-flow;
- WhatsApp Business normaliza `interactive` e `button` do webhook Meta;
- API nativa e `/graph` continuam compartilhando o mesmo Template Engine.
''')

docs_readme = ROOT / 'docs/README.md'
source = docs_readme.read_text()
line = '- [Interaction Engine e Template Studio](guides/interactions-template-studio.md)\n'
if line not in source:
    marker = '## Recipes e Actions\n'
    if marker in source:
        source = source.replace(marker, line + '\n' + marker, 1)
    else:
        source += '\n' + line
    docs_readme.write_text(source)
