# Connect|API Platform v1 — runtime e deployments

A Platform é uma nova superfície de produto do **mesmo Connect|API**. O Engine Node/TypeScript continua sendo a API canônica e `VERSION`, branches, GitHub Actions, releases e SemVer continuam pertencendo à raiz do repositório.

> Platform controla. Engine executa.

## Perfis genéricos

`deploy/platform/` continua existindo como deployment genérico multi-perfil para API-only, API+DOCs e Platform completa.

### API-only

```bash
docker compose --env-file deploy/platform/.env -f deploy/platform/compose.yaml up -d
```

### API + DOCs

```bash
docker compose --env-file deploy/platform/.env -f deploy/platform/compose.yaml --profile docs up -d
```

### Platform completa

```bash
docker compose --env-file deploy/platform/.env -f deploy/platform/compose.yaml --profile platform up -d
```

## Stacks Platform por ambiente

Os ambientes operacionais completos da Platform são stacks independentes. Eles não são overlays das stacks clássicas de API.

```text
deploy/platform-production/
project: argws-connect-platform-production
network: argws-connect-platform-production-net

deploy/platform-develop/
project: argws-connect-platform-develop
network: argws-connect-platform-develop-net
```

Ambas sobem por padrão todos os componentes necessários: Engine, DOCs, PostgreSQL operacional, Redis, RabbitMQ, MinIO, PostgreSQL da Platform, migrations, bootstrap, Control API, worker, scheduler, Web e gateway.

Não é necessário `--profile platform` nesses dois deployments.

## Platform production

```bash
cd deploy/platform-production
bash prepare-env.sh
bash preflight.sh
bash deploy.sh
```

### Domínios production

| Superfície | Host |
| --- | --- |
| Platform | `connect.argws.com.br` |
| Control Plane | `control.connect.argws.com.br` |
| Admin | `admin.connect.argws.com.br` |
| Partner Plane | `partner.connect.argws.com.br` |
| API | `api.connect.argws.com.br` |
| DOCs | `docs.connect.argws.com.br` |
| Demo | `demo.connect.argws.com.br` |
| Tenants | `<tenant>.connect.argws.com.br` |

Portas locais padrão:

```text
API Engine : 127.0.0.1:38080
DOCs       : 127.0.0.1:38180
Gateway    : 127.0.0.1:38800
```

A stack usa `latest` no deployment operacional e a mesma SemVer imutável do Connect|API nas releases.

`argws-connect-production` e `argws-connect-platform-production` não devem usar simultaneamente as portas padrão. Para substituição, pare a stack clássica e suba a Platform Production. Para execução paralela, altere as portas da Platform Production em sua `.env`.

## Platform develop

```bash
cd deploy/platform-develop
bash prepare-env.sh
bash preflight.sh
bash deploy.sh
```

### Domínios develop

| Superfície | Host |
| --- | --- |
| Platform | `d.connect.argws.com.br` |
| Control Plane | `d.control.connect.argws.com.br` |
| Admin | `d.admin.connect.argws.com.br` |
| Partner Plane | `d.partner.connect.argws.com.br` |
| API | `d.api.connect.argws.com.br` |
| DOCs | `d.docs.connect.argws.com.br` |
| Demo | `d.demo.connect.argws.com.br` |
| Tenants | `<tenant>.d.connect.argws.com.br` |

Portas locais padrão:

```text
API Engine : 127.0.0.1:38082
DOCs       : 127.0.0.1:38182
Gateway    : 127.0.0.1:38802
```

A stack usa o canal `develop` para Engine, DOCs, Control API, Web e Gateway.

`argws-connect-develop` e `argws-connect-platform-develop` também não devem usar simultaneamente as portas padrão. Para operação paralela, altere as portas em `deploy/platform-develop/.env`.

## Isolamento e persistência

Cada stack Platform usa seus próprios bind mounts sob o respectivo diretório `volumes/`. Nenhum volume das stacks clássicas é compartilhado automaticamente.

Isso evita que uma atualização da Platform altere sessões, banco ou infraestrutura de uma stack clássica sem uma migração intencional.

Se houver sessões WhatsApp existentes em uma stack clássica, a migração de arquivos/sessões deve ocorrer de forma controlada com a origem parada. Nunca use o mesmo diretório de sessão simultaneamente em dois projects diferentes.

## Adoção de instâncias existentes

A Platform não precisa recriar uma instância que já esteja funcionando em um Engine acessível. Em **Instâncias → Adotar existente**, ela consulta `/instance/fetchInstances` e cria apenas um `EngineBinding` tenant-safe.

A adoção:

- não chama `/instance/create`;
- não gera QR/pairing code;
- não altera o nome real da instância;
- não desconecta a sessão;
- não move nem apaga contatos, chats ou mensagens.

Uma instância adotada tem origem `ADOPTED_EXISTING`. Ao removê-la da Platform, a ação disponível é **Desvincular da Platform**, que apaga somente o binding.

## Manager legado

O frontend histórico em `manager/dist` foi aposentado. A imagem do Engine usa `SERVER_DISABLE_MANAGER=true`; a superfície administrativa passa a ser `platform/web`.

A retirada do Manager não remove endpoints REST, Templates, Actions, Recipes, Micro Apps, providers, Webhooks ou Events do Engine.

## Versionamento e imagens

A Platform não possui versão independente. Platform API, Platform Web e Gateway seguem os mesmos canais do Connect|API:

- `develop` para a branch `develop`;
- SemVer e `latest` somente pelo release canônico em `main`.

Platform develop:

```text
ghcr.io/wkarts/argws-connect-api:develop
ghcr.io/wkarts/argws-connect-docs:develop
ghcr.io/wkarts/argws-connect-platform-api:develop
ghcr.io/wkarts/argws-connect-platform-web:develop
ghcr.io/wkarts/argws-connect-platform-gateway:develop
```

Platform production:

```text
ghcr.io/wkarts/argws-connect-api:latest
ghcr.io/wkarts/argws-connect-docs:latest
ghcr.io/wkarts/argws-connect-platform-api:latest
ghcr.io/wkarts/argws-connect-platform-web:latest
ghcr.io/wkarts/argws-connect-platform-gateway:latest
```

## Convenção de project name dos deployments

Todo deployment Compose independente do Connect|API deve declarar `name: ${COMPOSE_PROJECT_NAME:-...}` e manter o mesmo valor em `env.example`. O padrão canônico é `argws-connect-<deployment>`; quando houver rede dedicada, use `argws-connect-<deployment>-net`.

| Deployment | Project name | Network |
| --- | --- | --- |
| canonical | `argws-connect-canonical` | `argws-connect-canonical-net` |
| develop | `argws-connect-develop` | `argws-connect-develop-net` |
| platform-develop | `argws-connect-platform-develop` | `argws-connect-platform-develop-net` |
| homologation | `argws-connect-homologation` | `argws-connect-homologation-net` |
| production | `argws-connect-production` | `argws-connect-production-net` |
| platform-production | `argws-connect-platform-production` | `argws-connect-platform-production-net` |
| docs | `argws-connect-docs` | gerenciada pelo próprio compose |
| docs-develop | `argws-connect-docs-develop` | gerenciada pelo próprio compose |
| cloudpanel | `argws-connect-cloudpanel` | `argws-connect-cloudpanel-net` |
| dockge | `argws-connect-dockge` | `argws-connect-dockge-net` |
| platform | `argws-connect-platform` | `argws-connect-platform-net` |

O único overlay oficial da Platform permanece `deploy/platform/compose.local-build.yaml`, que declara explicitamente o mesmo project `argws-connect-platform` da stack-base e apenas troca imagens por builds locais.

### Convenção dos services

Todo service de um deployment independente segue `recurso-argws-connect-deployment`, e o `container_name` deve ser idêntico ao service.

Exemplos:

```text
api-argws-connect-develop
api-argws-connect-platform-develop
platform-api-argws-connect-platform-develop
api-argws-connect-platform-production
platform-api-argws-connect-platform-production
platform-web-argws-connect-platform-production
```

Aliases internos estáveis (`connect-engine`, `connect-platform-api`, `argws-connect-postgres` etc.) podem existir para desacoplar a comunicação interna da nomenclatura física.
