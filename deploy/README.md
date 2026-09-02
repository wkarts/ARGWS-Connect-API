# Deployments oficiais — ARGWS Connect API

A plataforma possui duas stacks oficiais e autocontidas: `deploy/production/` e `deploy/homologation/`.

Cada ambiente possui projeto Compose, rede, banco, cache, event bus, bucket e persistência física próprios e pode rodar simultaneamente no mesmo host.

## Portas locais oficiais

Cada stack publica duas portas de aplicação: API e Connect|API DOCs. A infraestrutura continua interna.

- Produção: API `127.0.0.1:38080` | DOCs `127.0.0.1:38180`
- Homologação: API `127.0.0.1:38081` | DOCs `127.0.0.1:38181`
- Develop: API `127.0.0.1:38082` | DOCs `127.0.0.1:38182`
- Canonical: API `127.0.0.1:38083` | DOCs `127.0.0.1:38183`

`/manager`, `/health`, `/metrics`, WebSocket, webhooks e demais rotas da aplicação continuam no endpoint da API. O Scalar roda no service `docs`.

## Core padrão

Sem nenhum profile adicional, as duas stacks sobem:

- API;
- Connect|API DOCs;
- PostgreSQL;
- Redis;
- RabbitMQ;
- MinIO.

PostgreSQL é o banco oficial, Redis é cache/estado rápido, RabbitMQ é o event bus/fila padrão e MinIO é o storage S3 local.

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

Eles não substituem Redis. NATS/Kafka sobrepõem parte do papel de mensageria do RabbitMQ, mas atendem cenários diferentes: RabbitMQ continua como padrão; NATS é útil para pub/sub de baixa latência e comunicação entre serviços; Kafka é útil para alto volume, retenção e replay de eventos. Zookeeper é infraestrutura do Kafka usado nessa versão e não é consumido diretamente pela API.

## Manager

O Manager atual é servido em `/manager` pela própria API e não possui service/container separado.

## Deploy sem preencher segredos manualmente

Na primeira execução, `prepare-env.sh` cria `.env` a partir de `env.example`, gera os segredos fortes localmente, aplica `chmod 600` e mantém o arquivo fora do Git.

```bash
./registry-login.sh   # somente se o GHCR exigir autenticação
./deploy.sh
```

## Persistência

Core:

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

Profiles opcionais podem usar também `./volumes/nats`, `./volumes/kafka` e `./volumes/zookeeper`. Não são usados named volumes.

## GHCR

Produção e homologação consomem exclusivamente imagens `ghcr.io/wkarts/argws-connect-*`. O bootstrap inicial já foi executado com sucesso e o workflow de sincronização mantém core e mensageria opcional espelhados no GHCR.

`production/` e `homologation/` são as referências canônicas para o provisionamento futuro do Control Plane; CloudPanel e Dockge continuam como integrações operacionais.
