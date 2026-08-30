# Validação do deployment — ARGWS Connect API

## Contrato atual

- imagens de runtime referenciadas por `ghcr.io/wkarts/argws-connect-*`;
- nenhuma compilação da aplicação em CloudPanel/Dockge;
- CloudPanel e Dockge mantêm a mesma arquitetura de serviços;
- persistência através de bind mounts relativos `./volumes/...`;
- sem named volumes para Instance, PostgreSQL, Redis, RabbitMQ e MinIO;
- API healthcheck em `GET /health`;
- migrations executadas antes da API com retry configurável;
- URI do banco não é impressa pelo script de boot;
- `.env` não é incorporado à imagem final.

## Persistência esperada

```text
./volumes/instances
./volumes/postgres
./volumes/redis
./volumes/rabbitmq
./volumes/minio
./volumes/logs
./volumes/backups
```

Variáveis opcionais de override:

```text
ARGWS_CONNECT_INSTANCES_DATA_PATH
ARGWS_CONNECT_POSTGRES_DATA_PATH
ARGWS_CONNECT_REDIS_DATA_PATH
ARGWS_CONNECT_RABBITMQ_DATA_PATH
ARGWS_CONNECT_MINIO_DATA_PATH
```

## CI

A integridade do banco continua coberta por `database-integrity.yml` para PostgreSQL, MySQL e PgBouncer.

O deployment é validado separadamente por `deployment-integrity.yml`, que verifica sintaxe/expansão dos dois Compose e o contrato de bind mounts.

## Backup

A organização física da stack facilita backup e migração. Entretanto, bancos em execução devem ser salvos por ferramentas consistentes do próprio engine; a existência de `./volumes/postgres` não autoriza cópia a quente dos arquivos do PostgreSQL.
