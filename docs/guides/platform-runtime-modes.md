# Connect|API Platform v1 — runtime e deployments

A Platform é uma nova superfície de produto do **mesmo Connect|API**. O Engine Node/TypeScript continua sendo a API canônica e `VERSION`, branches, GitHub Actions, releases e SemVer continuam pertencendo à raiz do repositório.

> Platform controla. Engine executa.

## Perfis oficiais

### API-only

É o deployment headless e continua plenamente suportado. Inclui o Connect|API Engine e a infraestrutura necessária para REST, Webhooks, Events e providers. Não inclui frontend administrativo.

No compose unificado da Platform (`deploy/platform/compose.yaml`), é o perfil padrão, sem `--profile` adicional.

### API + DOCs

Adiciona o Connect|API DOCs/Scalar ao deployment API-only.

```bash
docker compose --env-file deploy/platform/.env -f deploy/platform/compose.yaml --profile docs up -d
```

### Platform completa

Adiciona Control API, frontend Vue/PWA, banco de governança da Platform, workers/scheduler e gateway. O Engine permanece como serviço especializado e mantém seu banco operacional separado.

```bash
docker compose --env-file deploy/platform/.env -f deploy/platform/compose.yaml --profile platform up -d
```

## Platform develop independente

O ambiente develop da Platform possui agora um deployment próprio e completo em:

```text
deploy/platform-develop/
```

Ele **não é overlay** de `deploy/develop/` e não depende de outro Compose para funcionar.

Identidade física:

```text
project: argws-connect-platform-develop
network: argws-connect-platform-develop-net
```

A stack sobe por padrão todos os componentes necessários: Engine, DOCs, PostgreSQL operacional, Redis, RabbitMQ, MinIO, PostgreSQL da Platform, migrations, bootstrap, Control API, worker, scheduler, Web e gateway.

```bash
cd deploy/platform-develop
bash prepare-env.sh
bash preflight.sh
bash deploy.sh
```

Não é necessário `--profile platform` neste deployment.

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

A API e o DOCs preservam as portas usadas pelo develop clássico para permitir troca de stack sem mudar esses dois reverse proxies. Consequentemente, `argws-connect-develop` e `argws-connect-platform-develop` não devem operar ao mesmo tempo com as portas padrão. Se for necessário executar ambos simultaneamente, altere as portas da Platform develop em sua `.env`.

Os hosts `d.connect`, `d.control`, `d.admin`, `d.partner`, `d.demo` e o wildcard de tenants devem apontar para o gateway local da Platform develop.

## Isolamento e persistência

`deploy/platform-develop` usa seus próprios bind mounts em `deploy/platform-develop/volumes/`. Nenhum volume de `deploy/develop` é compartilhado automaticamente.

Isso evita que uma atualização da Platform altere sessões, banco ou infraestrutura da stack develop clássica sem uma migração intencional.

Se houver sessões WhatsApp existentes em `deploy/develop/volumes/instances`, a migração deve ocorrer com a stack antiga parada e de forma controlada. Não use o mesmo diretório de sessões simultaneamente entre dois projects.

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

O frontend histórico em `manager/dist` foi aposentado nesta frente. A imagem do Engine usa `SERVER_DISABLE_MANAGER=true`; a superfície administrativa passa a ser `platform/web`.

A retirada do Manager não remove endpoints REST, Templates, Actions, Recipes, Micro Apps, providers, Webhooks ou Events do Engine.

## Versionamento e imagens

A Platform não possui versão independente. Platform API, Platform Web e Gateway seguem os mesmos canais do Connect|API:

- `develop` para a branch `develop`;
- SemVer e `latest` somente pelo release canônico em `main`.

O deployment `platform-develop` usa explicitamente:

```text
ghcr.io/wkarts/argws-connect-api:develop
ghcr.io/wkarts/argws-connect-docs:develop
ghcr.io/wkarts/argws-connect-platform-api:develop
ghcr.io/wkarts/argws-connect-platform-web:develop
ghcr.io/wkarts/argws-connect-platform-gateway:develop
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
platform-web-argws-connect-platform
```

Aliases internos estáveis (`connect-engine`, `connect-platform-api`, `argws-connect-postgres` etc.) podem existir para desacoplar a comunicação interna da nomenclatura física.
