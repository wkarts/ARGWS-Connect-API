# ARGWS Connect API — Produção

Stack oficial de produção. Somente a API publica `127.0.0.1:38080`; `/manager`, `/health`, `/metrics`, WebSocket e webhooks usam o mesmo endpoint.

## Core padrão

```text
ARGWS Connect API
├── PostgreSQL
├── Redis
├── RabbitMQ
└── MinIO
```

Profiles opcionais disponíveis:

- `nats` → NATS + JetStream;
- `kafka` → Kafka + Zookeeper;
- `extended` → NATS + Kafka + Zookeeper.

Enquanto um profile está desligado, seus containers não são criados.

## Política de imagem

O deployment normal de produção acompanha sempre:

```text
ghcr.io/wkarts/argws-connect-api:latest
```

`latest` é publicado exclusivamente pela release estável da `main`.

Para instalação reproduzível/pinada use `../canonical`, que aplica uma tag SemVer aprovada sobre **a mesma stack de produção**, sem alterar porta, domínio, rede ou volumes.

```text
Production  -> :latest
Canonical   -> :X.Y.Z
Homologação -> :develop
```

## Deploy

```bash
./registry-login.sh   # somente se os packages GHCR forem privados
./deploy.sh
```

Na primeira execução, `prepare-env.sh` cria o `.env`, gera os segredos localmente, aplica `chmod 600`, cria `./volumes`, valida o GHCR e sobe a stack.

Domínio oficial: `https://api.connect.argws.com.br`.

## Atualização

```bash
./update.sh
```

Isso mantém a produção no canal `latest`.

Se precisar fixar uma release específica na mesma stack:

```bash
./promote.sh 1.0.6
```

Esse comando delega ao deployment canonical e não cria um segundo ambiente.

## Persistência

```text
./volumes/instances
./volumes/postgres
./volumes/redis
./volumes/rabbitmq
./volumes/minio
./volumes/logs
./volumes/backups
```

Profiles opcionais usam `./volumes/nats`, `./volumes/kafka` e `./volumes/zookeeper`.

Use `nginx-location.conf.example` no CloudPanel. SSL/TLS termina no CloudPanel/Cloudflare; internamente a API permanece HTTP em `8080`.
