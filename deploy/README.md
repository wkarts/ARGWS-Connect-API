# Deployments oficiais — ARGWS Connect API

O Connect|API mantém deployments independentes para produção, homologação, develop, canonical, DOCs e Platform. Cada stack possui project name e network previsíveis e pode coexistir no mesmo host sem colisão de nomes físicos.

## Portas locais oficiais

As stacks completas publicam portas separadas para API e Connect|API DOCs; a infraestrutura permanece somente nas redes Docker internas.

- Produção: API `127.0.0.1:38080` | DOCs `127.0.0.1:38180`
- Homologação: API `127.0.0.1:38081` | DOCs `127.0.0.1:38181`
- Develop: API `127.0.0.1:38082` | DOCs `127.0.0.1:38182`
- Canonical: API `127.0.0.1:38083` | DOCs `127.0.0.1:38183`

`/health`, `/metrics`, WebSocket, webhooks e demais rotas do Engine permanecem no endpoint da API. O DOCs/Scalar usa o service físico `docs-argws-connect-<deployment>` correspondente a cada stack.

## Core padrão

Sem profiles adicionais, as stacks completas sobem:

- Connect|API Engine;
- Connect|API DOCs;
- PostgreSQL;
- Redis;
- RabbitMQ;
- MinIO.

PostgreSQL é o banco oficial do Engine, Redis é cache/estado rápido, RabbitMQ é o event bus/fila padrão e MinIO é o storage S3 local.

## Mensageria opcional

NATS e Kafka permanecem disponíveis por profiles e ficam desligados por padrão. Enquanto desligados, seus containers não são criados e não consomem CPU/RAM do runtime.

- `nats` → sobe NATS com JetStream;
- `kafka` → sobe Kafka + Zookeeper;
- `extended` → sobe NATS + Kafka + Zookeeper.

Exemplos:

```bash
COMPOSE_PROFILES=nats ./deploy.sh
COMPOSE_PROFILES=kafka ./deploy.sh
COMPOSE_PROFILES=extended ./deploy.sh
```

Eles não substituem Redis. RabbitMQ continua como mensageria padrão; NATS atende pub/sub de baixa latência e Kafka atende retenção/replay e alto volume de eventos.

## Manager legado

O Manager histórico foi aposentado. O Engine não serve mais `/manager`; a interface administrativa completa pertence à Connect|API Platform (`platform/web`). API REST, DOCs, providers, Templates, Actions, Recipes, Micro Apps, Webhooks e Events permanecem no Engine.

## Deploy sem preencher segredos manualmente

Nos deployments que possuem `prepare-env.sh`, a primeira execução cria `.env` a partir de `env.example`, gera segredos fortes localmente, aplica `chmod 600` e mantém o arquivo fora do Git.

```bash
./registry-login.sh   # somente se o GHCR exigir autenticação
./deploy.sh
```

## Persistência

As stacks oficiais sob `deploy/` usam bind mounts locais, por exemplo:

```text
./volumes/
├── instances/
├── postgres/
├── redis/
├── rabbitmq/
├── minio/
├── logs/
└── backups/
```

Profiles opcionais podem usar também `./volumes/nats`, `./volumes/kafka` e `./volumes/zookeeper`.

Os Compose auxiliares históricos sob `Docker/` são executáveis isolados de componentes e podem continuar usando named volumes próprios; eles também obedecem ao contrato global de project/service/container/network.

## GHCR

Produção e homologação consomem exclusivamente imagens `ghcr.io/wkarts/argws-connect-*`. As imagens de Engine, DOCs, Platform e infraestrutura seguem o lifecycle canônico do Connect|API.

`production/`, `homologation/`, `develop/` e `canonical/` são stacks operacionais completas. CloudPanel e Dockge permanecem integrações operacionais. `deploy/platform/` oferece API-only, API+DOCs e Platform completa por profiles.

## DOCs standalone / always-on

`deploy/docs/` mantém o Connect|API DOCs online de forma independente na porta local `38280`.

## Connect|API DOCs — hostnames públicos

- `deploy/docs/` → `https://docs.connect.argws.com.br` → `127.0.0.1:38280` → `:latest`;
- `deploy/docs-develop/` → `https://d.docs.connect.argws.com.br` → `127.0.0.1:38282` → `:develop`.

As stacks completas mantêm DOCs integrados nas portas `38180` a `38183`. A variável `ARGWS_CONNECT_DOCS_PUBLIC_URL` define o destino público usado pela aplicação; somente o deployment `develop` usa por padrão `d.docs.connect.argws.com.br`.

## Convenção canônica de nomenclatura

Para todo Docker Compose versionado no repositório:

- project: `argws-connect-<deployment>`;
- network: `argws-connect-<deployment>-net`;
- service: `<recurso>-argws-connect-<deployment>`;
- `container_name`: idêntico ao service;
- overlays declaram explicitamente o **mesmo** `name:` da stack-base e nunca criam project paralelo.

Exemplos:

```text
api-argws-connect-develop
postgres-argws-connect-production
platform-api-argws-connect-platform
platform-web-argws-connect-develop
```

Overlays atualmente existentes:

- `deploy/develop/compose.platform.yaml` → `argws-connect-develop` / `argws-connect-develop-net`;
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
