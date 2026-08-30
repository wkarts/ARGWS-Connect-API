# Deployments oficiais — ARGWS Connect API

A plataforma possui duas stacks oficiais e autocontidas:

```text
deploy/
├── production/
│   ├── compose.yaml
│   ├── env.example
│   ├── prepare-env.sh
│   ├── deploy.sh
│   ├── update.sh
│   ├── status.sh
│   ├── preflight.sh
│   ├── registry-login.sh
│   ├── nginx-location.conf.example
│   └── volumes/
│
└── homologation/
    ├── compose.yaml
    ├── env.example
    ├── prepare-env.sh
    ├── deploy.sh
    ├── update.sh
    ├── status.sh
    ├── preflight.sh
    ├── registry-login.sh
    ├── nginx-location.conf.example
    └── volumes/
```

Cada ambiente possui projeto Compose, rede, banco, cache, event bus, bucket e persistência física próprios. Produção e homologação podem rodar simultaneamente no mesmo host.

## Regra de porta única

Somente a API publica porta no host.

Produção:

```text
https://api.connect.argws.com.br
        ↓
127.0.0.1:38080
├── /
├── /manager
├── /health
├── /metrics
├── WebSocket
└── Webhooks / API
```

Homologação:

```text
https://h.api.connect.argws.com.br
        ↓
127.0.0.1:38081
├── /
├── /manager
├── /health
├── /metrics
├── WebSocket
└── Webhooks / API
```

## Serviços locais oficiais

As duas stacks canônicas sobem somente:

- API;
- PostgreSQL;
- Redis;
- RabbitMQ;
- MinIO.

PostgreSQL, Redis, RabbitMQ e MinIO permanecem exclusivamente na rede Docker interna e não publicam portas no host.

O Manager atual é servido em `/manager` pela própria API e não possui service/container separado.

NATS, Kafka, Zookeeper e MySQL não fazem parte das stacks oficiais neste momento porque não trazem benefício operacional para o cenário atual: PostgreSQL é o banco oficial e RabbitMQ já cumpre o papel de event bus/fila.

## Deploy sem preencher segredos manualmente

Na primeira execução, `prepare-env.sh` copia `env.example` para `.env` e substitui automaticamente todos os placeholders `CHANGE_ME_*` por valores criptograficamente aleatórios. O `.env` recebe permissão `600` e nunca é versionado.

Fluxo:

```bash
./registry-login.sh   # apenas quando GHCR exigir autenticacao
./deploy.sh
```

## Persistência

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

Não são usados named volumes nas stacks oficiais.

## GHCR

Produção e homologação consomem exclusivamente imagens `ghcr.io/wkarts/argws-connect-*`.

O bootstrap inicial das imagens de infraestrutura já foi executado com sucesso. O workflow `GHCR - Sync Infrastructure Images` mantém Node/Nginx para build e PostgreSQL/Redis/RabbitMQ/MinIO para runtime espelhados no registry oficial.

## CloudPanel / Dockge

Os diretórios `cloudpanel/` e `dockge/` continuam disponíveis como integrações operacionais. `production/` e `homologation/` passam a ser as referências canônicas para o provisionamento futuro do Control Plane.
