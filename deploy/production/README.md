# ARGWS Connect API — Produção

Stack oficial de produção com core enxuto e mensageria avançada opcional.

## Core padrão

Sem profiles adicionais, sobe apenas:

```text
ARGWS Connect API
├── PostgreSQL
├── Redis
├── RabbitMQ
└── MinIO
```

Somente a API publica `127.0.0.1:38080`; `/manager`, `/health`, `/metrics`, WebSocket e webhooks usam esse mesmo endpoint.

## Mensageria opcional

O Compose também contém:

- profile `nats` → NATS + JetStream;
- profile `kafka` → Kafka + Zookeeper;
- profile `extended` → NATS + Kafka + Zookeeper.

Enquanto um profile está desligado, seus containers não são criados e não consomem recursos do runtime.

Exemplos:

```bash
COMPOSE_PROFILES=nats ./deploy.sh
COMPOSE_PROFILES=kafka ./deploy.sh
COMPOSE_PROFILES=extended ./deploy.sh
```

RabbitMQ continua sendo o event bus/fila padrão. NATS é indicado para pub/sub de baixa latência e comunicação entre serviços; Kafka para retenção, replay e alto volume de eventos. Zookeeper existe somente como dependência do Kafka nesta versão.

## Deploy direto

```bash
./registry-login.sh   # somente se os packages GHCR forem privados
./deploy.sh
```

Na primeira execução, `prepare-env.sh` cria o `.env`, gera os segredos localmente, aplica `chmod 600`, cria `./volumes`, valida o GHCR e sobe a stack.

Domínio oficial: `https://api.connect.argws.com.br`.

## Persistência

Core:

```text
./volumes/instances
./volumes/postgres
./volumes/redis
./volumes/rabbitmq
./volumes/minio
./volumes/logs
./volumes/backups
```

Profiles opcionais podem usar `./volumes/nats`, `./volumes/kafka` e `./volumes/zookeeper`.

## Operação

```bash
./update.sh
./status.sh
```

Use `nginx-location.conf.example` no CloudPanel. SSL/TLS termina no CloudPanel/Cloudflare; internamente a API permanece HTTP em `8080`.
