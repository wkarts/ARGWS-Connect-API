from pathlib import Path
import re

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


def patch_prisma(path, postgres=True):
    text = read(path)
    if 'MetaConversationWindow       MetaConversationWindow[]' not in text:
        text = replace_once(
            text,
            '  TemplateInteractionSession TemplateInteractionSession[]\n',
            '  TemplateInteractionSession TemplateInteractionSession[]\n  MetaConversationWindow       MetaConversationWindow[]\n',
            f'{path}: instance relation',
        )

    meta_re = re.compile(r'model MetaCompatibility \{.*?\n\}', re.S)
    m = meta_re.search(text)
    if not m:
        raise RuntimeError(f'{path}: MetaCompatibility not found')
    block = m.group(0)
    if 'policyMode' not in block:
        block = block.replace(
            '  webhookUrl String?',
            '  webhookUrl String?\n  policyMode String   @default("PERMISSIVE") @db.VarChar(20)\n  windowSeconds Int   @default(86400)\n  templateRequiredOutsideWindow Boolean @default(true)',
        )
        text = text[:m.start()] + block + text[m.end():]

    tis_re = re.compile(r'model TemplateInteractionSession \{.*?\n\}', re.S)
    m = tis_re.search(text)
    if not m:
        raise RuntimeError(f'{path}: TemplateInteractionSession not found')
    block = m.group(0)
    if 'strongBindingId' not in block:
        marker = '  lastError         String?'
        if marker not in block:
            # MySQL/Postgres definitions still have same semantic field but alignment may differ.
            marker = re.search(r'^\s+lastError\s+String\?.*$', block, re.M).group(0)
            insertion = marker + '\n  strongBindingId    String?   @db.VarChar(255)\n  strongInput        Json?\n  strongRequestedAt  DateTime?\n  strongDecisionAt   DateTime?\n  strongDecisionBy   String?   @db.VarChar(255)\n  strongDecisionReason String?  @db.Text'
            block = block.replace(marker, insertion, 1)
        else:
            block = block.replace(marker, marker + '\n  strongBindingId    String?   @db.VarChar(255)\n  strongInput        Json?\n  strongRequestedAt  DateTime?\n  strongDecisionAt   DateTime?\n  strongDecisionBy   String?   @db.VarChar(255)\n  strongDecisionReason String?  @db.Text', 1)
        text = text[:m.start()] + block + text[m.end():]

    if 'model MetaConversationWindow {' not in text:
        relation = 'Json?     @db.JsonB' if postgres else 'Json?'
        model = '''\n\nmodel MetaConversationWindow {
  id                 String    @id @default(cuid())
  instanceId         String
  remoteJid          String    @db.VarChar(150)
  lastInboundAt      DateTime?
  windowExpiresAt    DateTime?
  lastOutboundAt     DateTime?
  lastPolicyDecision String?   @db.VarChar(100)
  lastPolicyAt       DateTime?
  violationCount     Int       @default(0)
  createdAt          DateTime  @default(now())
  updatedAt          DateTime  @updatedAt
  Instance           Instance  @relation(fields: [instanceId], references: [id], onDelete: Cascade)

  @@unique([instanceId, remoteJid])
  @@index([instanceId, windowExpiresAt])
}
'''
        text += model

    write(path, text)


for schema, postgres in [
    ('prisma/postgresql-schema.prisma', True),
    ('prisma/psql_bouncer-schema.prisma', True),
    ('prisma/mysql-schema.prisma', False),
]:
    patch_prisma(schema, postgres)

# Recipe DTO
path = 'src/api/dto/recipe.dto.ts'
text = read(path)
if 'export class RecipeInstallDto' not in text:
    text += '''\nexport class RecipeInstallDto {
  packageKey: string;
  baseUrl: string;
  credentialRef?: string;
  allowPrivateNetwork?: boolean;
}
'''
write(path, text)

# Recipe schema
path = 'src/validate/recipe.schema.ts'
text = read(path)
if 'recipeInstallSchema' not in text:
    text += '''\nexport const recipeInstallSchema: JSONSchema7 = {
  $id: v4(),
  type: 'object',
  properties: {
    packageKey: { type: 'string', minLength: 1, maxLength: 100 },
    baseUrl: { type: 'string', minLength: 8 },
    credentialRef: { type: 'string', pattern: '^[A-Za-z0-9_-]{2,100}$' },
    allowPrivateNetwork: { type: 'boolean' },
  },
  required: ['packageKey', 'baseUrl'],
  additionalProperties: false,
};
'''
write(path, text)

# Recipe controller
path = 'src/api/controllers/recipe.controller.ts'
text = read(path)
text = text.replace(
    "import { RecipeDeleteDto, RecipeDto, RecipeExecuteDto } from '@api/dto/recipe.dto';",
    "import { RecipeDeleteDto, RecipeDto, RecipeExecuteDto, RecipeInstallDto } from '@api/dto/recipe.dto';",
)
if "RecipeLibraryService" not in text:
    text = text.replace(
        "import { RecipeService } from '@api/services/recipe.service';",
        "import { RecipeLibraryService } from '@api/services/recipe-library.service';\nimport { RecipeService } from '@api/services/recipe.service';",
    )
    text = text.replace(
        '  constructor(private readonly service: RecipeService) {}',
        '  constructor(\n    private readonly service: RecipeService,\n    private readonly libraryService: RecipeLibraryService,\n  ) {}',
    )
    text = text.replace(
        '\n  public create(instance: InstanceDto, data: RecipeDto) {',
        '\n  public library() {\n    return this.libraryService.list();\n  }\n\n  public install(instance: InstanceDto, data: RecipeInstallDto) {\n    return this.libraryService.install(instance, data);\n  }\n\n  public create(instance: InstanceDto, data: RecipeDto) {',
    )
write(path, text)

# Recipe router
path = 'src/api/routes/recipe.router.ts'
text = read(path)
text = text.replace(
    'RecipeDeleteDto, RecipeDto, RecipeExecuteDto',
    'RecipeDeleteDto, RecipeDto, RecipeExecuteDto, RecipeInstallDto',
)
text = text.replace(
    'recipeDeleteSchema, recipeExecuteSchema, recipeSchema',
    'recipeDeleteSchema, recipeExecuteSchema, recipeInstallSchema, recipeSchema',
)
if "routerPath('library')" not in text:
    marker = '    this.router\n'
    insert = '''    this.router
      .get(this.routerPath('library'), ...guards, async (req, res) => {
        try {
          res.status(HttpStatus.OK).json(await recipeController.library());
        } catch (error) {
          const response = createMetaErrorResponse(error, 'recipe_library');
          res.status(response.status).json(response);
        }
      })
      .post(this.routerPath('install'), ...guards, async (req, res) => {
        try {
          const response = await this.dataValidate<RecipeInstallDto>({
            request: req,
            schema: recipeInstallSchema,
            ClassRef: RecipeInstallDto,
            execute: (instance, data) => recipeController.install(instance, data),
          });
          res.status(HttpStatus.CREATED).json(response);
        } catch (error) {
          const response = createMetaErrorResponse(error, 'recipe_install');
          res.status(response.status).json(response);
        }
      })
'''
    text = replace_once(text, marker, insert, 'recipe router start')
write(path, text)

# Global-only auth guard
path = 'src/api/guards/auth.guard.ts'
text = read(path)
if 'async function globalApiKey' not in text:
    text = text.replace(
        '\nexport const authGuard = { apikey };',
        '''\nasync function globalApiKey(req: Request, _: Response, next: NextFunction) {
  const configured = configService.get<Auth>('AUTHENTICATION').API_KEY?.KEY;
  const key = req.get('apikey');
  if (!configured || !key || key !== configured) {
    throw new UnauthorizedException();
  }
  return next();
}

export const authGuard = { apikey, globalApiKey };''',
    )
write(path, text)

# Meta controller configuration
path = 'src/api/compat/meta-cloud/meta-cloud.controller.ts'
text = read(path)
if 'MetaCloudPolicyService' not in text:
    text = text.replace(
        "import { MetaCloudIdentityResolver } from './meta-cloud-identity.resolver';",
        "import { MetaCloudIdentityResolver } from './meta-cloud-identity.resolver';\nimport { MetaCloudPolicyService, MetaPolicyMode } from './meta-cloud-policy.service';",
    )
    text = text.replace(
        '    private readonly identityResolver: MetaCloudIdentityResolver,\n  ) {}',
        '    private readonly identityResolver: MetaCloudIdentityResolver,\n    private readonly policy: MetaCloudPolicyService,\n  ) {}',
    )
    text = text.replace(
        '  public async setCompatibility(instanceName: string, data: { enabled?: boolean; webhookUrl?: string | null }) {',
        "  public async setCompatibility(\n    instanceName: string,\n    data: {\n      enabled?: boolean;\n      webhookUrl?: string | null;\n      policyMode?: MetaPolicyMode;\n      windowSeconds?: number;\n      templateRequiredOutsideWindow?: boolean;\n    },\n  ) {",
    )
    text = text.replace(
        '    const current = await this.prisma.metaCompatibility.findUnique({ where: { instanceId: identity.instanceId } });',
        "    const current = await this.prisma.metaCompatibility.findUnique({ where: { instanceId: identity.instanceId } });\n    const policyMode = data.policyMode === undefined ? undefined : this.policy.normalizeMode(data.policyMode);\n    const windowSeconds = data.windowSeconds === undefined ? undefined : this.policy.normalizeWindowSeconds(data.windowSeconds);",
    )
    text = text.replace(
        '        webhookUrl: data.webhookUrl ?? null,\n      },',
        "        webhookUrl: data.webhookUrl ?? null,\n        policyMode: policyMode ?? 'PERMISSIVE',\n        windowSeconds: windowSeconds ?? 86400,\n        templateRequiredOutsideWindow: data.templateRequiredOutsideWindow ?? true,\n      },",
    )
    text = text.replace(
        '        webhookUrl: data.webhookUrl === undefined ? (current?.webhookUrl ?? null) : data.webhookUrl,\n      },',
        "        webhookUrl: data.webhookUrl === undefined ? (current?.webhookUrl ?? null) : data.webhookUrl,\n        ...(policyMode === undefined ? {} : { policyMode }),\n        ...(windowSeconds === undefined ? {} : { windowSeconds }),\n        ...(data.templateRequiredOutsideWindow === undefined\n          ? {}\n          : { templateRequiredOutsideWindow: data.templateRequiredOutsideWindow }),\n      },",
    )
    text = text.replace(
        '  private serializeConfig(identity: any, config: any) {',
        "  public async inspectWindow(instanceName: string, recipient: string) {\n    const identity = await this.identityResolver.resolveByInstanceName(instanceName);\n    return this.policy.inspect(identity.instanceId, recipient);\n  }\n\n  private serializeConfig(identity: any, config: any) {",
    )
    text = text.replace(
        '      webhookUrl: config?.webhookUrl ?? null,\n    };',
        "      webhookUrl: config?.webhookUrl ?? null,\n      policy: {\n        mode: this.policy.normalizeMode(config?.policyMode),\n        windowSeconds: this.policy.normalizeWindowSeconds(config?.windowSeconds),\n        templateRequiredOutsideWindow: config?.templateRequiredOutsideWindow !== false,\n      },\n    };",
    )
write(path, text)

# Meta admin router window inspection (specific route must precede generic)
path = 'src/api/compat/meta-cloud/meta-cloud.router.ts'
text = read(path)
if "'/window/:recipient'" not in text:
    marker = '    this.router.get(\n      \'/:instanceName\','
    route = '''    this.router.get(
      '/:instanceName/window/:recipient',
      ...guards,
      this.wrap(async (req, res) => {
        res.json(await metaCloudController.inspectWindow(req.params.instanceName, req.params.recipient));
      }),
    );
'''
    text = replace_once(text, marker, route + marker, 'meta window route')
write(path, text)

# Meta Graph policy enforcement
path = 'src/api/compat/meta-cloud/meta-cloud-graph.controller.ts'
text = read(path)
if 'MetaCloudPolicyService' not in text:
    text = text.replace(
        "import { MetaCloudMessageAdapter } from './meta-cloud-message.adapter';",
        "import { MetaCloudMessageAdapter } from './meta-cloud-message.adapter';\nimport { MetaCloudPolicyService } from './meta-cloud-policy.service';",
    )
    text = text.replace(
        '    private readonly templates: MetaCloudTemplateService,\n  ) {}',
        '    private readonly templates: MetaCloudTemplateService,\n    private readonly policy: MetaCloudPolicyService,\n  ) {}',
    )
    old = '''    const result = await this.adapter.execute(identity, payload || {});
    if (payload?.status !== 'read') metaCloudMetrics.increment('connect_meta_compat_messages_sent_total');
    return result;'''
    new = '''    if (payload?.status !== 'read' && payload?.to) {
      await this.policy.assertOutbound(identity, String(payload.to), String(payload.type || ''));
    }
    const result = await this.adapter.execute(identity, payload || {});
    if (payload?.status !== 'read') {
      metaCloudMetrics.increment('connect_meta_compat_messages_sent_total');
      if (payload?.to) await this.policy.recordOutbound(identity.instanceId, String(payload.to));
    }
    return result;'''
    text = replace_once(text, old, new, 'graph send policy')
write(path, text)

# Event manager policy tracker
path = 'src/api/integrations/event/event.manager.ts'
text = read(path)
if 'MetaCloudPolicyService' not in text:
    text = text.replace(
        "import { MetaCloudWebhookDispatcher } from '@api/compat/meta-cloud/meta-cloud-webhook.dispatcher';",
        "import { MetaCloudPolicyService } from '@api/compat/meta-cloud/meta-cloud-policy.service';\nimport { MetaCloudWebhookDispatcher } from '@api/compat/meta-cloud/meta-cloud-webhook.dispatcher';",
    )
    text = text.replace(
        '  private interactionEngine?: InteractionEngineService;',
        '  private interactionEngine?: InteractionEngineService;\n  private metaCloudPolicy?: MetaCloudPolicyService;',
    )
    text = text.replace(
        '  public setInteractionEngine(engine: InteractionEngineService): void {\n    this.interactionEngine = engine;\n  }',
        '  public setInteractionEngine(engine: InteractionEngineService): void {\n    this.interactionEngine = engine;\n  }\n\n  public setMetaCloudPolicy(policy: MetaCloudPolicyService): void {\n    this.metaCloudPolicy = policy;\n  }',
    )
    text = text.replace(
        '  }): Promise<void> {\n    if (this.metaCloudDispatcher) {',
        '  }): Promise<void> {\n    if (this.metaCloudPolicy) {\n      await this.metaCloudPolicy.handleEvent(eventData).catch(() => undefined);\n    }\n    if (this.metaCloudDispatcher) {',
    )
write(path, text)

# Interaction Engine strong queue methods + storage
path = 'src/api/services/interaction-engine.service.ts'
text = read(path)
if 'listStrongConfirmations' not in text:
    old = '''        await this.prisma.templateInteractionSession.update({
          where: { id: session.id },
          data: { status: 'WAITING_STRONG_CONFIRMATION' },
        });'''
    new = '''        await this.prisma.templateInteractionSession.update({
          where: { id: session.id },
          data: {
            status: 'WAITING_STRONG_CONFIRMATION',
            strongBindingId: binding.id,
            strongInput: input as any,
            strongRequestedAt: new Date(),
            strongDecisionAt: null,
            strongDecisionBy: null,
            strongDecisionReason: null,
          },
        });'''
    text = replace_once(text, old, new, 'strong persist')
    marker = '\n  private async findSession(instanceId: string, message: any, interaction: any) {'
    methods = '''
  public async listStrongConfirmations(instanceName: string) {
    const instance = await this.prisma.instance.findUnique({ where: { name: instanceName }, select: { id: true } });
    if (!instance) return [];
    return this.prisma.templateInteractionSession.findMany({
      where: { instanceId: instance.id, status: 'WAITING_STRONG_CONFIRMATION' },
      orderBy: { strongRequestedAt: 'asc' },
      select: {
        id: true,
        remoteJid: true,
        templateName: true,
        language: true,
        strongBindingId: true,
        strongInput: true,
        strongRequestedAt: true,
        expiresAt: true,
        createdAt: true,
      },
    });
  }

  public async approveStrongConfirmation(instanceName: string, sessionId: string, actor: string, reason?: string) {
    return this.decideStrongConfirmation(instanceName, sessionId, 'APPROVE', actor, reason);
  }

  public async rejectStrongConfirmation(instanceName: string, sessionId: string, actor: string, reason?: string) {
    return this.decideStrongConfirmation(instanceName, sessionId, 'REJECT', actor, reason);
  }

  private async decideStrongConfirmation(
    instanceName: string,
    sessionId: string,
    decision: 'APPROVE' | 'REJECT',
    actor: string,
    reason?: string,
  ) {
    const instanceRow = await this.prisma.instance.findUnique({
      where: { name: instanceName },
      select: { id: true, name: true, integration: true },
    });
    if (!instanceRow) throw new Error(`Instance ${instanceName} was not found.`);

    const session = await this.prisma.templateInteractionSession.findFirst({
      where: { id: sessionId, instanceId: instanceRow.id },
    });
    if (!session || session.status !== 'WAITING_STRONG_CONFIRMATION') {
      throw new Error('Strong confirmation is no longer pending.');
    }

    if (decision === 'REJECT') {
      const changed = await this.prisma.templateInteractionSession.updateMany({
        where: { id: session.id, status: 'WAITING_STRONG_CONFIRMATION' },
        data: {
          status: 'REJECTED',
          strongDecisionAt: new Date(),
          strongDecisionBy: actor,
          strongDecisionReason: reason || null,
        },
      });
      if (!changed.count) throw new Error('Strong confirmation was already decided.');
      const instance: InstanceDto = {
        instanceName: instanceRow.name,
        instanceId: instanceRow.id,
        integration: instanceRow.integration,
      };
      await this.sendConfiguredResponse(
        instance,
        session.remoteJid,
        { type: 'TEXT', text: 'Operação não autorizada pelo responsável.' },
        { session: { id: session.id } },
      );
      return { sessionId: session.id, status: 'REJECTED', actor, reason: reason || null };
    }

    const claimed = await this.prisma.templateInteractionSession.updateMany({
      where: { id: session.id, status: 'WAITING_STRONG_CONFIRMATION' },
      data: {
        status: 'PROCESSING_STRONG_CONFIRMATION',
        strongDecisionAt: new Date(),
        strongDecisionBy: actor,
        strongDecisionReason: reason || null,
        lastError: null,
      },
    });
    if (!claimed.count) throw new Error('Strong confirmation was already decided.');

    const binding = this.bindings(session.actions).find((item) => item.id === session.strongBindingId);
    if (!binding || binding.type === 'NONE' || !binding.key) {
      await this.prisma.templateInteractionSession.update({
        where: { id: session.id },
        data: { status: 'FAILED', lastError: 'Strong binding is unavailable.' },
      });
      throw new Error('Strong binding is unavailable.');
    }

    const instance: InstanceDto = {
      instanceName: instanceRow.name,
      instanceId: instanceRow.id,
      integration: instanceRow.integration,
    };
    const input = ((session.strongInput as any) || {}) as Record<string, unknown>;
    try {
      let result: any;
      if (binding.type === 'RECIPE') {
        result = await this.recipeService.execute(instance, {
          recipeKey: binding.key,
          input,
          confirmed: true,
          dryRun: false,
        });
      } else {
        result = await this.actionExecution.execute(instance, {
          actionKey: binding.key,
          input,
          confirmed: true,
          dryRun: false,
        });
      }
      if (binding.response) {
        await this.sendConfiguredResponse(instance, session.remoteJid, binding.response, {
          session: { id: session.id, variables: (session.variables as any) || {} },
          result,
        });
      }
      await this.prisma.templateInteractionSession.update({
        where: { id: session.id },
        data: { status: 'COMPLETED', lastError: null },
      });
      return { sessionId: session.id, status: 'COMPLETED', actor, reason: reason || null, result };
    } catch (error) {
      const messageText = error instanceof Error ? error.message : String(error);
      await this.prisma.templateInteractionSession.update({
        where: { id: session.id },
        data: { status: 'FAILED', lastError: messageText.slice(0, 4000) },
      });
      throw error;
    }
  }
'''
    text = replace_once(text, marker, methods + marker, 'strong methods')
write(path, text)

# Server module wiring
path = 'src/api/server.module.ts'
text = read(path)
if 'MetaCloudPolicyService' not in text:
    text = text.replace(
        "import { MetaCloudMessageAdapter } from './compat/meta-cloud/meta-cloud-message.adapter';",
        "import { MetaCloudMessageAdapter } from './compat/meta-cloud/meta-cloud-message.adapter';\nimport { MetaCloudPolicyService } from './compat/meta-cloud/meta-cloud-policy.service';",
    )
text = text.replace(
    "import { SettingsController } from './controllers/settings.controller';",
    "import { SettingsController } from './controllers/settings.controller';\nimport { StrongConfirmationController } from './controllers/strong-confirmation.controller';",
)
if "RecipeLibraryService" not in text:
    text = text.replace(
        "import { RecipeService } from './services/recipe.service';",
        "import { RecipeLibraryService } from './services/recipe-library.service';\nimport { RecipeService } from './services/recipe.service';",
    )
text = text.replace(
    'export const recipeService = new RecipeService(prismaRepository, actionExecutionService);\nexport const recipeController = new RecipeController(recipeService);',
    'export const recipeService = new RecipeService(prismaRepository, actionExecutionService);\nexport const recipeLibraryService = new RecipeLibraryService(prismaRepository, actionRegistryService, recipeService);\nexport const recipeController = new RecipeController(recipeService, recipeLibraryService);',
)
if 'export const metaCloudPolicyService' not in text:
    text = text.replace(
        'export const metaCloudIdentityResolver = new MetaCloudIdentityResolver(prismaRepository);',
        'export const metaCloudIdentityResolver = new MetaCloudIdentityResolver(prismaRepository);\nexport const metaCloudPolicyService = new MetaCloudPolicyService(prismaRepository);',
    )
text = text.replace(
    'export const metaCloudController = new MetaCloudController(prismaRepository, metaCloudIdentityResolver);',
    'export const metaCloudController = new MetaCloudController(\n  prismaRepository,\n  metaCloudIdentityResolver,\n  metaCloudPolicyService,\n);',
)
if 'strongConfirmationController' not in text:
    text = text.replace(
        'const proxyService = new ProxyService(waMonitor);',
        'export const strongConfirmationController = new StrongConfirmationController(interactionEngine);\n\nconst proxyService = new ProxyService(waMonitor);',
    )
text = text.replace(
    '  metaCloudTemplateService,\n);',
    '  metaCloudTemplateService,\n  metaCloudPolicyService,\n);',
)
if 'eventManager.setMetaCloudPolicy' not in text:
    text = text.replace(
        'eventManager.setInteractionEngine(interactionEngine);',
        'eventManager.setInteractionEngine(interactionEngine);\neventManager.setMetaCloudPolicy(metaCloudPolicyService);',
    )
write(path, text)

# Index router wiring strong admin
path = 'src/api/routes/index.router.ts'
text = read(path)
if "StrongConfirmationRouter" not in text:
    text = text.replace(
        "import { SettingsRouter } from './settings.router';",
        "import { SettingsRouter } from './settings.router';\nimport { StrongConfirmationRouter } from './strong-confirmation.router';",
    )
    text = text.replace(
        "  .use('/recipe', new RecipeRouter(...guards).router)",
        "  .use('/recipe', new RecipeRouter(...guards).router)\n  .use(\n    '/interaction/strong',\n    new StrongConfirmationRouter(instanceExistsGuard, authGuard['globalApiKey']).router,\n  )",
    )
write(path, text)

# Documentation guide
write('docs/guides/conversational-platform-phase4.md', '''# Conversational Platform — Fase 4

A Fase 4 adiciona três capacidades incrementais ao Connect|API sem alterar o comportamento da API nativa existente.

## Meta Policy Engine

O Meta Compatible continua sempre disponível. A política é aplicada apenas às chamadas de envio via `/graph`, enquanto mensagens recebidas alimentam a janela de atendimento independentemente do provider.

- `PERMISSIVE` (padrão): não bloqueia integrações existentes; registra violações fora da janela.
- `OBSERVE`: calcula exatamente o que seria bloqueado em modo estrito e registra `WOULD_BLOCK_OUTSIDE_WINDOW`, sem impedir o envio.
- `STRICT`: para providers simulados, exige template para reengajamento fora da janela configurada.
- `WHATSAPP-BUSINESS`: a Meta oficial continua soberana; a decisão local é `DELEGATED_TO_META`.

A duração padrão é 86400 segundos (24h). A configuração fica em `MetaCompatibility`, não desabilita a fachada e pode ser inspecionada por destinatário.

## Strong Confirmation

Actions e Recipes `STRONG` nunca são executadas por um simples clique no WhatsApp. O Interaction Engine cria uma pendência e preserva o input resolvido. A aprovação/rejeição administrativa exige a API key global e é atômica para impedir execução dupla.

Rotas:

- `GET /interaction/strong/pending/{instanceName}`
- `POST /interaction/strong/approve/{instanceName}`
- `POST /interaction/strong/reject/{instanceName}`

A aprovação executa a Action/Recipe com `confirmed=true`; falhas terminam em `FAILED` para evitar repetição ambígua de efeitos críticos.

## Pacotes oficiais de Recipes

`GET /recipe/library/{instanceName}` lista pacotes disponíveis. `POST /recipe/install/{instanceName}` instala Actions, Recipes e templates em uma instância usando uma Base URL e `credentialRef`, sem persistir segredos no catálogo.

O primeiro pacote é `scheduler-pro` e inclui consulta, confirmação, cancelamento e reagendamento de agendamentos, além do template `scheduler_appointment_confirmation`.
''')

# Foundation test
write('test/conversational-platform/foundation.test.ts', '''import assert from 'node:assert/strict';
import fs from 'node:fs';

const policy = fs.readFileSync('src/api/compat/meta-cloud/meta-cloud-policy.service.ts', 'utf8');
assert.match(policy, /PERMISSIVE/);
assert.match(policy, /OBSERVE/);
assert.match(policy, /STRICT/);
assert.match(policy, /131047/);
assert.match(policy, /DELEGATED_TO_META/);

const interaction = fs.readFileSync('src/api/services/interaction-engine.service.ts', 'utf8');
assert.match(interaction, /listStrongConfirmations/);
assert.match(interaction, /approveStrongConfirmation/);
assert.match(interaction, /PROCESSING_STRONG_CONFIRMATION/);
assert.match(interaction, /strongInput/);

const packageSource = fs.readFileSync('src/api/recipes/official/scheduler-pro.ts', 'utf8');
for (const key of [
  'scheduler.appointment.get',
  'scheduler.appointment.confirm',
  'scheduler.appointment.cancel',
  'scheduler.appointment.reschedule',
  'scheduler.availability.find',
  'scheduler_appointment_confirmation',
]) assert.match(packageSource, new RegExp(key.replaceAll('.', '\\\\.')));

const router = fs.readFileSync('src/api/routes/index.router.ts', 'utf8');
assert.match(router, /globalApiKey/);
assert.match(router, /interaction\\/strong/);

console.log('conversational platform phase4: ok');
''')

# Add test to compat package script if absent
path = 'package.json'
text = read(path)
if 'conversational-platform/foundation.test.ts' not in text:
    text = text.replace(
        'tsx ./test/interaction-engine/foundation.test.ts',
        'tsx ./test/interaction-engine/foundation.test.ts && tsx ./test/conversational-platform/foundation.test.ts',
    )
write(path, text)

# Migrations
pg = '''ALTER TABLE "MetaCompatibility" ADD COLUMN "policyMode" VARCHAR(20) NOT NULL DEFAULT 'PERMISSIVE';
ALTER TABLE "MetaCompatibility" ADD COLUMN "windowSeconds" INTEGER NOT NULL DEFAULT 86400;
ALTER TABLE "MetaCompatibility" ADD COLUMN "templateRequiredOutsideWindow" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "TemplateInteractionSession" ADD COLUMN "strongBindingId" VARCHAR(255);
ALTER TABLE "TemplateInteractionSession" ADD COLUMN "strongInput" JSONB;
ALTER TABLE "TemplateInteractionSession" ADD COLUMN "strongRequestedAt" TIMESTAMP(3);
ALTER TABLE "TemplateInteractionSession" ADD COLUMN "strongDecisionAt" TIMESTAMP(3);
ALTER TABLE "TemplateInteractionSession" ADD COLUMN "strongDecisionBy" VARCHAR(255);
ALTER TABLE "TemplateInteractionSession" ADD COLUMN "strongDecisionReason" TEXT;

CREATE TABLE "MetaConversationWindow" (
  "id" TEXT NOT NULL,
  "instanceId" TEXT NOT NULL,
  "remoteJid" VARCHAR(150) NOT NULL,
  "lastInboundAt" TIMESTAMP(3),
  "windowExpiresAt" TIMESTAMP(3),
  "lastOutboundAt" TIMESTAMP(3),
  "lastPolicyDecision" VARCHAR(100),
  "lastPolicyAt" TIMESTAMP(3),
  "violationCount" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "MetaConversationWindow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "MetaConversationWindow_instanceId_remoteJid_key" ON "MetaConversationWindow"("instanceId", "remoteJid");
CREATE INDEX "MetaConversationWindow_instanceId_windowExpiresAt_idx" ON "MetaConversationWindow"("instanceId", "windowExpiresAt");
ALTER TABLE "MetaConversationWindow" ADD CONSTRAINT "MetaConversationWindow_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "Instance"("id") ON DELETE CASCADE ON UPDATE CASCADE;
'''
mysql = '''ALTER TABLE `MetaCompatibility` ADD COLUMN `policyMode` VARCHAR(20) NOT NULL DEFAULT 'PERMISSIVE';
ALTER TABLE `MetaCompatibility` ADD COLUMN `windowSeconds` INTEGER NOT NULL DEFAULT 86400;
ALTER TABLE `MetaCompatibility` ADD COLUMN `templateRequiredOutsideWindow` BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE `TemplateInteractionSession` ADD COLUMN `strongBindingId` VARCHAR(255) NULL;
ALTER TABLE `TemplateInteractionSession` ADD COLUMN `strongInput` JSON NULL;
ALTER TABLE `TemplateInteractionSession` ADD COLUMN `strongRequestedAt` DATETIME(3) NULL;
ALTER TABLE `TemplateInteractionSession` ADD COLUMN `strongDecisionAt` DATETIME(3) NULL;
ALTER TABLE `TemplateInteractionSession` ADD COLUMN `strongDecisionBy` VARCHAR(255) NULL;
ALTER TABLE `TemplateInteractionSession` ADD COLUMN `strongDecisionReason` TEXT NULL;

CREATE TABLE `MetaConversationWindow` (
  `id` VARCHAR(191) NOT NULL,
  `instanceId` VARCHAR(191) NOT NULL,
  `remoteJid` VARCHAR(150) NOT NULL,
  `lastInboundAt` DATETIME(3) NULL,
  `windowExpiresAt` DATETIME(3) NULL,
  `lastOutboundAt` DATETIME(3) NULL,
  `lastPolicyDecision` VARCHAR(100) NULL,
  `lastPolicyAt` DATETIME(3) NULL,
  `violationCount` INTEGER NOT NULL DEFAULT 0,
  `createdAt` DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  `updatedAt` DATETIME(3) NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE INDEX `MetaConversationWindow_instanceId_remoteJid_key` (`instanceId`, `remoteJid`),
  INDEX `MetaConversationWindow_instanceId_windowExpiresAt_idx` (`instanceId`, `windowExpiresAt`),
  CONSTRAINT `MetaConversationWindow_instanceId_fkey` FOREIGN KEY (`instanceId`) REFERENCES `Instance`(`id`) ON DELETE CASCADE ON UPDATE CASCADE
) DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
'''
write('prisma/postgresql-migrations/20260902090000_conversational_policy_phase4/migration.sql', pg)
write('prisma/mysql-migrations/20260902090000_conversational_policy_phase4/migration.sql', mysql)

print('phase4 materialization applied')
