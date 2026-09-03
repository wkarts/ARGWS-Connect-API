# Deployments oficiais — ARGWS Connect API

O Connect|API mantém deployments independentes para produção, homologação, develop, canonical, DOCs e Platform. Cada stack possui project name e network previsíveis.

## Portas locais oficiais

As stacks completas publicam portas separadas para API e Connect|API DOCs; a infraestrutura permanece somente nas redes Docker internas.

- Produção clássica: API `127.0.0.1:38080` | DOCs `127.0.0.1:38180`
- Platform production: API `127.0.0.1:38080` | DOCs `127.0.0.1:38180` | Gateway `127.0.0.1:38800`
- Homologação: API `127.0.0.1:38081` | DOCs `127.0.0.1:38181`
- Develop clássico: API `127.0.0.1:38082` | DOCs `127.0.0.1:38182`
- Platform develop: API `127.0.0.1:38082` | DOCs `127.0.0.1:38182` | Gateway `127.0.0.1:38802`
- Canonical: API `127.0.0.1:38083` | DOCs `127.0.0.1:38183`

As stacks Platform preservam as portas API/DOCs do ambiente clássico correspondente para permitir substituição sem alterar esses reverse proxies. Por isso, a stack clássica e a stack Platform do mesmo ambiente não devem subir simultaneamente usando as portas padrão. Para operação paralela, altere as portas da stack Platform em sua `.env`.

`/health`, `/metrics`, WebSocket, webhooks e demais rotas do Engine permanecem no endpoint da API. O DOCs/Scalar usa o service físico `docs-argws-connect-<deployment>` correspondente.

## Core padrão

As stacks operacionais clássicas sobem:

- Connect|API Engine;
- Connect|API DOCs;
- PostgreSQL;
- Redis;
- RabbitMQ;
- MinIO.

PostgreSQL é o banco oficial do Engine, Redis é cache/estado rápido, RabbitMQ é o event bus/fila padrão e MinIO é o storage S3 local.

## Platform completa por ambiente

A Platform completa possui stacks próprias e independentes:

```text
deploy/platform-production/  → argws-connect-platform-production
deploy/platform-develop/     → argws-connect-platform-develop
```

Nenhuma delas é overlay das stacks clássicas `deploy/production/` ou `deploy/develop/`.

Ambas sobem por padrão:

- Engine e DOCs;
- PostgreSQL operacional, Redis, RabbitMQ e MinIO;
- PostgreSQL exclusivo da Platform;
- migrations e bootstrap;
- Control API;
- worker;
- scheduler;
- frontend Vue/PWA;
- gateway da Platform.

### Platform production

Identidade:

```text
project: argws-connect-platform-production
network: argws-connect-platform-production-net
```

Domínios:

```text
connect.argws.com.br
control.connect.argws.com.br
admin.connect.argws.com.br
partner.connect.argws.com.br
api.connect.argws.com.br
docs.connect.argws.com.br
demo.connect.argws.com.br
<tenant>.connect.argws.com.br
```

Hosts da Platform/tenants → `127.0.0.1:38800`.

Lifecycle de imagens:

```text
Engine/DOCs/Platform → :latest
SemVer imutável       → mesma VERSION do Connect|API
```

Primeiro deploy:

```bash
cd deploy/platform-production
bash prepare-env.sh
bash preflight.sh
bash deploy.sh
```

### Platform develop

Identidade:

```text
project: argws-connect-platform-develop
network: argws-connect-platform-develop-net
```

Domínios:

```text
d.connect.argws.com.br
d.control.connect.argws.com.br
d.admin.connect.argws.com.br
d.partner.connect.argws.com.br
d.api.connect.argws.com.br
d.docs.connect.argws.com.br
d.demo.connect.argws.com.br
<tenant>.d.connect.argws.com.br
```

Hosts da Platform/tenants → `127.0.0.1:38802`.

Lifecycle de imagens:

```text
Engine/DOCs/Platform → :develop
```

Primeiro deploy:

```bash
cd deploy/platform-develop
bash prepare-env.sh
bash preflight.sh
bash deploy.sh
```

## Mensageria opcional

NATS e Kafka permanecem disponíveis por profiles nas stacks clássicas e ficam desligados por padrão.

- `nats` → sobe NATS com JetStream;
- `kafka` → sobe Kafka + Zookeeper;
- `extended` → sobe NATS + Kafka + Zookeeper.

RabbitMQ continua como mensageria padrão; NATS atende pub/sub de baixa latência e Kafka atende retenção/replay e alto volume de eventos.

## Manager legado

O Manager histórico foi aposentado. O Engine não serve mais `/manager`; a interface administrativa completa pertence à Connect|API Platform (`platform/web`). API REST, DOCs, providers, Templates, Actions, Recipes, Micro Apps, Webhooks e Events permanecem no Engine.

## Deploy e segredos

Nos deployments que possuem `prepare-env.sh`, a primeira execução cria `.env` a partir de `env.example`, gera ou exige segredos fortes localmente e mantém o arquivo fora do Git.

As stacks Platform geram automaticamente valores fortes para placeholders `CHANGE_ME_*` e sincronizam `CONNECT_API_VERSION` com o arquivo `VERSION` da raiz.

## Persistência

Cada stack Platform tem persistência própria:

```text
volumes/
├── instances/
├── postgres/
├── redis/
├── rabbitmq/
├── minio/
├── platform-postgres/
└── platform-celery/
```

Nenhum volume das stacks clássicas é compartilhado automaticamente.

Os Compose auxiliares históricos sob `Docker/` são executáveis isolados de componentes e também obedecem ao contrato global de project/service/container/network.

## GHCR

Produção e homologação consomem exclusivamente imagens `ghcr.io/wkarts/argws-connect-*`. As imagens de Engine, DOCs, Platform e infraestrutura seguem o lifecycle canônico do Connect|API.

- Platform production usa `latest`/SemVer;
- Platform develop usa `develop`.

## DOCs standalone / always-on

`deploy/docs/` mantém o Connect|API DOCs online de forma independente na porta local `38280`.

- `deploy/docs/` → `https://docs.connect.argws.com.br` → `127.0.0.1:38280` → `:latest`;
- `deploy/docs-develop/` → `https://d.docs.connect.argws.com.br` → `127.0.0.1:38282` → `:develop`.

## Convenção canônica de nomenclatura

Para todo Docker Compose versionado no repositório:

- project: `argws-connect-<deployment>`;
- network: `argws-connect-<deployment>-net`;
- service: `<recurso>-argws-connect-<deployment>`;
- `container_name`: idêntico ao service;
- overlays declaram explicitamente o **mesmo** `name:` da stack-base.

Exemplos:

```text
api-argws-connect-develop
api-argws-connect-platform-develop
platform-api-argws-connect-platform-develop
api-argws-connect-platform-production
platform-web-argws-connect-platform-production
postgres-argws-connect-production
```

Platform production e Platform develop são deployments independentes, não overlays. O overlay oficial da Platform permanece apenas:

- `deploy/platform/compose.local-build.yaml` → `argws-connect-platform` / `argws-connect-platform-net`.

O `docker-compose.dev.yaml` da raiz é um deployment auxiliar próprio com `argws-connect-api-dev` / `argws-connect-api-dev-net`.

Os Compose isolados em `Docker/` usam o componente como deployment:

- PostgreSQL/pgAdmin → `argws-connect-postgres`;
- Redis → `argws-connect-redis`;
- RabbitMQ → `argws-connect-rabbitmq`;
- MinIO → `argws-connect-minio`;
- MySQL → `argws-connect-mysql`;
- Kafka/Zookeeper → `argws-connect-kafka`.

O workflow **Deployment Naming Integrity** descobre todos os arquivos `compose*.yml/yaml` e `docker-compose*.yml/yaml` versionados. Qualquer arquivo novo que não esteja coberto pelo contrato faz o CI falhar.
