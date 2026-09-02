from pathlib import Path
import re

ROOT = Path('.')

MODELS = r'''

model IntegrationAction {
  id                  String    @id @default(cuid())
  actionKey           String    @db.VarChar(150)
  name                String    @db.VarChar(255)
  description         String?   @db.Text
  method              String    @db.VarChar(10)
  baseUrl             String    @db.VarChar(500)
  path                String    @db.VarChar(500)
  credentialRef       String?   @db.VarChar(100)
  headers             Json?
  requestTemplate     Json?
  inputSchema         Json?
  outputMapping       Json?
  timeoutMs           Int       @default(10000)
  confirmation        String    @default("NONE") @db.VarChar(20)
  allowPrivateNetwork Boolean   @default(false)
  enabled             Boolean   @default(true)
  createdAt           DateTime  @default(now()) @db.Timestamp
  updatedAt           DateTime  @updatedAt @db.Timestamp
  Instance            Instance  @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  instanceId          String

  @@unique([instanceId, actionKey])
  @@index([instanceId, enabled])
}

model Recipe {
  id             String    @id @default(cuid())
  recipeKey      String    @db.VarChar(150)
  name           String    @db.VarChar(255)
  description    String?   @db.Text
  version        Int       @default(1)
  steps          Json
  inputSchema    Json?
  outputTemplate Json?
  confirmation   String    @default("NONE") @db.VarChar(20)
  enabled        Boolean   @default(true)
  createdAt      DateTime  @default(now()) @db.Timestamp
  updatedAt      DateTime  @updatedAt @db.Timestamp
  Instance       Instance  @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  instanceId     String

  @@unique([instanceId, recipeKey])
  @@index([instanceId, enabled])
}

model ActionExecution {
  id           String    @id @default(cuid())
  actionKey    String    @db.VarChar(150)
  recipeKey    String?   @db.VarChar(150)
  status       String    @db.VarChar(30)
  requestMeta  Json?
  responseMeta Json?
  errorMeta    Json?
  startedAt    DateTime  @default(now()) @db.Timestamp
  finishedAt   DateTime? @db.Timestamp
  Instance     Instance  @relation(fields: [instanceId], references: [id], onDelete: Cascade)
  instanceId   String

  @@index([instanceId, actionKey, startedAt])
}
'''

for rel in [
    'prisma/postgresql-schema.prisma',
    'prisma/psql_bouncer-schema.prisma',
    'prisma/mysql-schema.prisma',
]:
    path = ROOT / rel
    source = path.read_text()
    relation_anchor = '  Template                Template[]\n'
    if relation_anchor not in source:
        raise SystemExit(f'Instance Template relation anchor not found in {rel}')
    if '  IntegrationAction       IntegrationAction[]\n' not in source:
        source = source.replace(
            relation_anchor,
            relation_anchor
            + '  IntegrationAction       IntegrationAction[]\n'
            + '  Recipe                  Recipe[]\n'
            + '  ActionExecution         ActionExecution[]\n',
            1,
        )

    if 'model IntegrationAction {' not in source:
        match = re.search(r'model Template \{.*?\n\}', source, flags=re.S)
        if not match:
            raise SystemExit(f'Template model anchor not found in {rel}')
        source = source[: match.end()] + MODELS + source[match.end() :]
    path.write_text(source)

package = ROOT / 'package.json'
source = package.read_text()
old = 'tsx ./test/template-engine/foundation.test.ts"'
new = 'tsx ./test/template-engine/foundation.test.ts && tsx ./test/recipe-action/foundation.test.ts"'
if old not in source:
    raise SystemExit('test:compat anchor not found')
package.write_text(source.replace(old, new, 1))

validate = ROOT / 'src/validate/validate.schema.ts'
source = validate.read_text()
anchor = "export * from './business.schema';\n"
if anchor not in source:
    raise SystemExit('validate export anchor not found')
if "export * from './action.schema';" not in source:
    source = source.replace(anchor, "export * from './action.schema';\n" + anchor, 1)
if "export * from './recipe.schema';" not in source:
    source = source.replace("export * from './proxy.schema';\n", "export * from './proxy.schema';\nexport * from './recipe.schema';\n", 1)
validate.write_text(source)

server = ROOT / 'src/api/server.module.ts'
source = server.read_text()
if "./controllers/action.controller" not in source:
    source = source.replace(
        "import { BusinessController } from './controllers/business.controller';\n",
        "import { ActionController } from './controllers/action.controller';\nimport { BusinessController } from './controllers/business.controller';\n",
        1,
    )
if "./controllers/recipe.controller" not in source:
    source = source.replace(
        "import { ProxyController } from './controllers/proxy.controller';\n",
        "import { ProxyController } from './controllers/proxy.controller';\nimport { RecipeController } from './controllers/recipe.controller';\n",
        1,
    )
if "./services/action-execution.service" not in source:
    source = source.replace(
        "import { CacheService } from './services/cache.service';\n",
        "import { ActionExecutionService } from './services/action-execution.service';\nimport { ActionRegistryService } from './services/action-registry.service';\nimport { CacheService } from './services/cache.service';\n",
        1,
    )
if "./services/recipe.service" not in source:
    source = source.replace(
        "import { ProxyService } from './services/proxy.service';\n",
        "import { ProxyService } from './services/proxy.service';\nimport { RecipeService } from './services/recipe.service';\n",
        1,
    )
exports_anchor = 'export const prismaRepository = new PrismaRepository(configService);\n'
if exports_anchor not in source:
    raise SystemExit('server prisma anchor not found')
if 'export const actionRegistryService' not in source:
    source = source.replace(
        exports_anchor,
        exports_anchor
        + 'export const actionRegistryService = new ActionRegistryService(prismaRepository);\n'
        + 'export const actionExecutionService = new ActionExecutionService(prismaRepository);\n'
        + 'export const actionController = new ActionController(actionRegistryService, actionExecutionService);\n'
        + 'export const recipeService = new RecipeService(prismaRepository, actionExecutionService);\n'
        + 'export const recipeController = new RecipeController(recipeService);\n',
        1,
    )
server.write_text(source)

index = ROOT / 'src/api/routes/index.router.ts'
source = index.read_text()
if "./action.router" not in source:
    source = source.replace(
        "import { BusinessRouter } from './business.router';\n",
        "import { ActionRouter } from './action.router';\nimport { BusinessRouter } from './business.router';\n",
        1,
    )
if "./recipe.router" not in source:
    source = source.replace(
        "import { ProxyRouter } from './proxy.router';\n",
        "import { ProxyRouter } from './proxy.router';\nimport { RecipeRouter } from './recipe.router';\n",
        1,
    )
route_anchor = "  .use('/template', new TemplateRouter(configService, ...guards).router)\n"
if route_anchor not in source:
    raise SystemExit('index route anchor not found')
if "  .use('/action'," not in source:
    source = source.replace(
        route_anchor,
        route_anchor
        + "  .use('/action', new ActionRouter(...guards).router)\n"
        + "  .use('/recipe', new RecipeRouter(...guards).router)\n",
        1,
    )
index.write_text(source)

docs_readme = ROOT / 'docs/README.md'
source = docs_readme.read_text()
marker = '## Recipes e Actions\n'
if marker not in source:
    source += '''\n\n## Recipes e Actions\n\nA camada nativa de orquestração está documentada em [`guides/recipes-actions.md`](guides/recipes-actions.md). Ela separa templates, receitas e ações registradas, com credenciais por referência, `dryRun`, confirmação e proteção contra alvos de rede privada por padrão.\n'''
    docs_readme.write_text(source)
