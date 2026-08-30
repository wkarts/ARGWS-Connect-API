# Deployments oficiais — ARGWS Connect API

A stack canônica publica **uma única porta no host: a porta da API**. Todos os demais componentes permanecem na rede Docker interna.

## Topologia padrão

```text
Internet / Cloudflare / CloudPanel
              │
              ▼
     127.0.0.1:38080
              │
       ARGWS Connect API
       ├── /manager
       ├── /health
       ├── /metrics
       ├── WebSocket
       ├── Webhooks
       └── demais endpoints
              │
   ┌──────────┼──────────┐
PostgreSQL   Redis   RabbitMQ   MinIO
   │          │        │         │
   └──────── rede Docker interna ─┘
```

O Manager atual já está empacotado na imagem da API e é servido em `/manager`; não existe motivo para publicar um segundo container/porta apenas para ele.

## Serviços locais

A stack padrão sobe automaticamente:

- API;
- PostgreSQL;
- Redis;
- RabbitMQ;
- MinIO.

Serviços opcionais presentes no Compose:

- `nats` — profile `nats`;
- `kafka` + `zookeeper` — profile `kafka`;
- NATS + Kafka — profile `extended`;
- MySQL — profile `mysql`, como provider alternativo.

MongoDB **não foi incluído** porque o runtime atual não possui driver, configuração ou repositório MongoDB. Incluir um container sem consumidor só aumentaria consumo e criaria uma falsa indicação de compatibilidade.

## Persistência

Todos os dados usam bind mounts relativos à pasta da stack:

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

Não são usados named volumes na stack canônica.

## GHCR

Produção/homologação consomem somente `ghcr.io/wkarts/argws-connect-*`.

Se o Docker retornar `denied` ao consultar um manifest, o package está privado ou o host ainda não está autenticado. Use `registry-login.sh` com um PAT `read:packages`, ou torne os packages de runtime públicos no GHCR.

O workflow `GHCR - Sync Infrastructure Images` também é executado quando mudanças de deployment chegam à `main`, garantindo o espelhamento das imagens de infraestrutura.
