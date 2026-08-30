# Deployments oficiais — ARGWS Connect API

A plataforma possui duas stacks oficiais e autocontidas:

```text
deploy/
├── production/
│   ├── compose.yaml
│   ├── env.example
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
127.0.0.1:38081
├── /
├── /manager
├── /health
├── /metrics
├── WebSocket
└── Webhooks / API
```

PostgreSQL, Redis, RabbitMQ, MinIO e os serviços opcionais usam apenas a rede Docker interna. Nenhum deles publica porta no host.

## Serviços locais

A stack padrão sobe:

- API;
- PostgreSQL;
- Redis;
- RabbitMQ;
- MinIO.

Perfis opcionais:

- `nats`;
- `kafka` + `zookeeper`;
- `extended` (NATS + Kafka + Zookeeper);
- `mysql` como provider alternativo.

## Persistência

Todos os dados usam bind mounts relativos ao diretório de cada stack:

```text
./volumes/
├── instances/
├── postgres/
├── redis/
├── rabbitmq/
├── minio/
├── mysql/
├── nats/
├── kafka/
├── zookeeper/
├── logs/
└── backups/
```

Não são usados named volumes nas stacks oficiais.

## GHCR

Produção e homologação consomem exclusivamente `ghcr.io/wkarts/argws-connect-*`.

Antes do primeiro deploy em um host com packages privados:

```bash
./registry-login.sh
```

Use um PAT com `read:packages`. O token não é salvo no `.env` da aplicação.

O `preflight.sh` diferencia falha de autenticação/disponibilidade antes do `docker compose pull`. O workflow `GHCR - Sync Infrastructure Images` mantém as imagens de infraestrutura espelhadas no registry oficial.

## CloudPanel / Dockge

Os diretórios `cloudpanel/` e `dockge/` continuam disponíveis como integrações operacionais. As árvores `production/` e `homologation/` são a referência canônica de ambiente e devem orientar o provisionamento futuro do Control Plane.
