# Deployments oficiais — ARGWS Connect API

O Connect|API mantém deployments independentes para produção, homologação, develop, canonical, DOCs e Platform. Cada stack possui project name e network previsíveis.

## Portas locais oficiais

As stacks completas publicam portas separadas para API e Connect|API DOCs; a infraestrutura permanece somente nas redes Docker internas.

- Produção: API `127.0.0.1:38080` | DOCs `127.0.0.1:38180`
- Homologação: API `127.0.0.1:38081` | DOCs `127.0.0.1:38181`
- Develop clássico: API `127.0.0.1:38082` | DOCs `127.0.0.1:38182`
- Canonical: API `127.0.0.1:38083` | DOCs `127.0.0.1:38183`
- Platform develop: API `127.0.0.1:38082` | DOCs `127.0.0.1:38182` | Gateway `127.0.0.1:38802`

A Platform develop preserva as portas API/DOCs do develop clássico para permitir substituição sem alterar esses dois reverse proxies. Por isso, `argws-connect-develop` e `argws-connect-platform-develop` não devem subir simultaneamente usando as portas padrão. Para operação paralela, altere as portas da Platform develop em sua `.env`.

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

## Platform develop completa

`deploy/platform-develop/` é a stack develop completa da Connect|API Platform e **não é overlay** de `deploy/develop/`.

Identidade:

```text
project: argws-connect-platform-develop
network: argws-connect-platform-develop-net
```

Ela sobe por padrão:

- Engine e DOCs;
- PostgreSQL operacional, Redis, RabbitMQ e MinIO;
- PostgreSQL exclusivo da Platform;
- migrations e bootstrap;
- Control API;
- worker;
- scheduler;
- frontend Vue/PWA;
- gateway da Platform.

Domínios develop:

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

Os hosts da Platform e wildcard de tenants devem apontar para `127.0.0.1:38802` no reverse proxy. A API e o DOCs continuam em `38082` e `38182` por padrão.

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

A Platform develop gera automaticamente valores fortes para todos os placeholders `CHANGE_ME_*` e sincroniza `CONNECT_API_VERSION` com o arquivo `VERSION` da raiz.

## Persistência

As stacks oficiais sob `deploy/` usam bind mounts locais. Na Platform develop:

```text
deploy/platform-develop/volumes/
├── instances/
├── postgres/
├── redis/
├── rabbitmq/
├── minio/
├── platform-postgres/
└── platform-celery/
```

Nenhum volume de `deploy/develop` é compartilhado automaticamente.

Os Compose auxiliares históricos sob `Docker/` são executáveis isolados de componentes e podem continuar usando named volumes próprios; eles também obedecem ao contrato global de project/service/container/network.

## GHCR

Produção e homologação consomem exclusivamente imagens `ghcr.io/wkarts/argws-connect-*`. As imagens de Engine, DOCs, Platform e infraestrutura seguem o lifecycle canônico do Connect|API.

A Platform develop usa o canal `develop` para Engine, DOCs, Control API, Web e Gateway.

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
postgres-argws-connect-production
platform-web-argws-connect-platform
```

A Platform develop é um deployment independente, não overlay. O overlay oficial da Platform permanece apenas:

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
