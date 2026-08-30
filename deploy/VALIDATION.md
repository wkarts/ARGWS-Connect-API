# Validação do deployment — ARGWS Connect API

## Contrato obrigatório

- somente `api` publica porta no host;
- target interno da API: `8080`;
- Manager servido em `/manager` pela própria API;
- PostgreSQL, Redis, RabbitMQ, MinIO, MySQL, NATS, Kafka e Zookeeper não publicam portas;
- imagens de runtime exclusivamente `ghcr.io/wkarts/argws-connect-*`;
- bind mounts relativos `./volumes/...`;
- sem named volumes na stack canônica;
- API healthcheck em `GET /health`;
- migrations com retry antes do runtime;
- Docker log rotation habilitada;
- CloudPanel, Dockge e root Compose seguem o mesmo contrato.

## Stack padrão

```text
api
postgres
redis
rabbitmq
minio
```

Perfis opcionais:

```text
nats
kafka + zookeeper
extended
mysql
```

MongoDB não faz parte deste contrato porque não existe suporte MongoDB no código atual.

## CI

`deployment-integrity.yml` valida sintaxe do Compose, uma única porta publicada, ausência do Manager separado, bind mounts, imagens GHCR e disponibilidade das imagens core usando autenticação do GitHub Actions.

`database-integrity.yml` continua validando PostgreSQL, MySQL e PgBouncer.

## GHCR

O workflow `ghcr-sync-infrastructure.yml` espelha infraestrutura para o GHCR em execução manual, semanal e também quando mudanças de deployment entram na `main`.

Hosts externos ainda precisam de `docker login ghcr.io` se os packages estiverem privados.
