# ARGWS Connect API — Homologação

Stack oficial de homologação, isolada da produção por projeto Compose, rede, banco, cache, RabbitMQ, bucket e diretório físico próprios.

## Arquivos da stack

```text
homologation/
├── compose.yaml
├── env.example        # fonte canônica de configuração
├── deploy.sh
├── update.sh
├── status.sh
├── preflight.sh
├── registry-login.sh
├── nginx-location.conf.example
└── volumes/
```

O `.env` real não é versionado. Crie-o com `cp env.example .env`.

## Porta pública

Somente a API publica porta no host:

- `127.0.0.1:38081` → API
- `/manager` → Manager embutido na API
- `/health` → healthcheck
- `/metrics` → métricas quando habilitadas
- WebSocket e webhooks usam o mesmo endpoint da API

PostgreSQL, Redis, RabbitMQ, MinIO e serviços opcionais ficam exclusivamente na rede Docker.

## Imagem da API

O exemplo usa `ghcr.io/wkarts/argws-connect-api:homolog`. A tag deve ser publicada pelo pipeline de homologação antes do primeiro deploy.

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

Produção e homologação podem residir no mesmo host sem compartilhar esses diretórios, desde que cada stack permaneça em sua própria pasta.

## CloudPanel / Nginx

Use `nginx-location.conf.example` no reverse proxy de `h.api.connect.argws.com.br`. SSL/TLS termina no CloudPanel/Cloudflare; internamente a API permanece HTTP em `8080`.

## Atualização e status

```bash
./update.sh
./status.sh
```

O `preflight.sh` impede o deploy quando existem segredos `CHANGE_ME_*`, YAML inválido ou imagens core ausentes/inacessíveis no GHCR.
