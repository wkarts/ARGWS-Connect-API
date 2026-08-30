# Validação do deployment — ARGWS Connect API

## Contrato canônico

O deployment oficial possui dois ambientes autocontidos:

- `deploy/production/`
- `deploy/homologation/`

Cada ambiente contém Compose, `env.example`, scripts de deploy/update/status/preflight, login GHCR, snippet Nginx e árvore local `./volumes`.

## Porta única

Em qualquer stack oficial, somente o serviço `api` pode declarar `ports:`.

- porta interna da API: `8080`;
- produção: host `127.0.0.1:38080` por padrão;
- homologação: host `127.0.0.1:38081` por padrão.

Manager, healthcheck, métricas, WebSocket e webhooks são servidos pelo mesmo endpoint HTTP da API.

## Serviços

Core obrigatório:

- API;
- PostgreSQL;
- Redis;
- RabbitMQ;
- MinIO.

Opcionais via profiles:

- MySQL;
- NATS;
- Kafka;
- Zookeeper.

## Persistência

Somente bind mounts relativos:

```text
./volumes/instances
./volumes/postgres
./volumes/redis
./volumes/rabbitmq
./volumes/minio
./volumes/mysql
./volumes/nats
./volumes/kafka
./volumes/zookeeper/data
./volumes/zookeeper/log
./volumes/logs
./volumes/backups
```

Named volumes não pertencem ao contrato canônico.

## Isolamento produção/homologação

As stacks canônicas não usam `container_name` fixo. `COMPOSE_PROJECT_NAME`, rede, database, cache prefix, RabbitMQ e bucket possuem nomes próprios por ambiente, permitindo coexistência no mesmo host.

## GHCR

Todos os serviços usam `ghcr.io/wkarts/*`. O host deve fazer login com `read:packages` quando os packages forem privados.

O workflow `GHCR - Sync Infrastructure Images` espelha as imagens de infraestrutura. O `preflight.sh` verifica manifests antes do `docker compose pull` para produzir erro claro quando um package/tag não existe ou não está acessível.

## CI

`deployment-integrity.yml` valida:

- root Compose, CloudPanel, Dockge, produção e homologação;
- sintaxe normal e com todos os profiles;
- exatamente uma porta publicada e somente pela API;
- target interno `8080`;
- ausência de Manager separado;
- serviços core e opcionais esperados;
- imagens exclusivamente GHCR;
- bind mounts;
- ausência de `container_name` fixo nas stacks production/homologation;
- portas distintas entre produção e homologação;
- paridade das chaves de `env.example` de production/homologation;
- scripts executáveis e sintaticamente válidos;
- existência dos manifests core no GHCR.

A integridade de PostgreSQL, MySQL e PgBouncer continua coberta separadamente por `database-integrity.yml`.
