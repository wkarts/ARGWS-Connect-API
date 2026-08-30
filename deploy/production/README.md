# ARGWS Connect API — Produção

Stack oficial de produção, pronta para subir somente com os serviços locais necessários ao runtime atual.

## Árvore

```text
production/
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
    ├── instances/
    ├── postgres/
    ├── redis/
    ├── rabbitmq/
    ├── minio/
    ├── logs/
    └── backups/
```

## Topologia

```text
https://api.connect.argws.com.br
             │
     Cloudflare / CloudPanel
             │
       127.0.0.1:38080
             │
       ARGWS Connect API
       ├── /manager
       ├── /health
       ├── /metrics
       ├── WebSocket
       └── Webhooks / API
             │
      rede Docker interna
       ├── PostgreSQL
       ├── Redis
       ├── RabbitMQ
       └── MinIO
```

Somente a API publica uma porta. PostgreSQL, Redis, RabbitMQ e MinIO usam apenas `expose` na rede Docker.

O Manager atual já está incorporado à imagem da API e é servido em `/manager`; não existe container separado.

## Deploy direto

```bash
./registry-login.sh   # necessário apenas se os packages GHCR forem privados
./deploy.sh
```

Na primeira execução, `deploy.sh` chama `prepare-env.sh`, cria o `.env`, gera automaticamente senhas/tokens fortes, aplica `chmod 600`, cria a árvore `./volumes`, valida os manifests GHCR e sobe a stack.

Não é necessário copiar senha manualmente para PostgreSQL, Redis, RabbitMQ, MinIO, métricas, webhook ou API key.

## Atualização

```bash
./update.sh
```

## Status

```bash
./status.sh
```

## Reverse proxy

Use `nginx-location.conf.example` no CloudPanel. SSL/TLS termina no CloudPanel/Cloudflare; a API permanece HTTP internamente em `8080`.

## Persistência

Todos os dados persistentes ficam fisicamente dentro da pasta da stack em `./volumes/...`. Não são utilizados named volumes Docker.
