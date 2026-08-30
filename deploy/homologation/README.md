# ARGWS Connect API — Homologação

Stack oficial de homologação, isolada da produção e pronta para subir com os serviços locais necessários ao runtime atual.

## Árvore

```text
homologation/
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
https://h.api.connect.argws.com.br
               │
       Cloudflare / CloudPanel
               │
         127.0.0.1:38081
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

O Manager atual está incorporado à imagem da API e é servido em `/manager`; não existe container separado.

## Imagem

A homologação usa `ghcr.io/wkarts/argws-connect-api:homolog`, permitindo testar a linha de homologação sem alterar a produção.

## Deploy direto

```bash
./registry-login.sh   # necessário apenas se os packages GHCR forem privados
./deploy.sh
```

Na primeira execução, `deploy.sh` chama `prepare-env.sh`, cria o `.env`, gera automaticamente senhas/tokens fortes, aplica `chmod 600`, cria a árvore `./volumes`, valida os manifests GHCR e sobe a stack.

Produção e homologação possuem senhas, banco, Redis, RabbitMQ, bucket, rede, porta e diretório físico independentes.

## Atualização

```bash
./update.sh
```

## Status

```bash
./status.sh
```

## Reverse proxy

Use `nginx-location.conf.example` no CloudPanel para `h.api.connect.argws.com.br`. SSL/TLS termina no CloudPanel/Cloudflare; a API permanece HTTP internamente em `8080`.

## Persistência

Todos os dados persistentes ficam em `./volumes/...` dentro da pasta da própria stack. Não são utilizados named volumes Docker.
