# ARGWS Connect API — Produção

Stack oficial de produção com todos os serviços locais necessários ao runtime principal.

## Porta pública

Somente a API publica porta no host:

- `127.0.0.1:38080` → API
- `/manager` → Manager embutido na API
- `/health` → healthcheck
- `/metrics` → métricas quando habilitadas
- WebSocket e webhooks usam o mesmo endpoint da API

PostgreSQL, Redis, RabbitMQ, MinIO e serviços opcionais ficam exclusivamente na rede Docker.

## Serviços padrão

`docker compose up -d` sobe API, PostgreSQL, Redis, RabbitMQ e MinIO.

Perfis opcionais:

- `nats`
- `kafka` (Kafka + Zookeeper)
- `extended` (NATS + Kafka + Zookeeper)
- `mysql` (provider alternativo)

## Instalação

```bash
cp env.example .env
chmod 600 .env
./registry-login.sh
./deploy.sh
```

O PAT usado em `registry-login.sh` precisa de `read:packages` quando os packages GHCR forem privados. O token não é salvo no `.env` da aplicação.

## Persistência

Todos os dados físicos ficam ao lado da própria stack:

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

Não são utilizados named volumes Docker.

## CloudPanel / Nginx

Use `nginx-location.conf.example` no reverse proxy. SSL/TLS termina no CloudPanel/Cloudflare; internamente a API permanece HTTP em `8080`.

## Atualização e status

```bash
./update.sh
./status.sh
```

O `preflight.sh` impede o deploy quando existem segredos `CHANGE_ME_*`, YAML inválido ou imagens core ausentes/inacessíveis no GHCR.
