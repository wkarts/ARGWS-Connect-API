# Validação do deployment — ARGWS Connect API

## Contrato canônico

O deployment oficial possui dois ambientes autocontidos:

- `deploy/production/`
- `deploy/homologation/`

Cada ambiente contém Compose, `env.example`, geração automática de `.env`, scripts de deploy/update/status/preflight, login GHCR, snippet Nginx e árvore local `./volumes`.

## Porta única

Em qualquer stack oficial, somente o serviço `api` pode declarar `ports:`.

- porta interna da API: `8080`;
- produção: host `127.0.0.1:38080`;
- homologação: host `127.0.0.1:38081`.

Manager, healthcheck, métricas, WebSocket e webhooks são servidos pelo mesmo endpoint HTTP da API.

## Serviços das stacks oficiais

As stacks canônicas contêm exatamente:

- API;
- PostgreSQL;
- Redis;
- RabbitMQ;
- MinIO.

Não há container Manager separado. Não há MySQL, NATS, Kafka ou Zookeeper nas stacks canônicas.

## Persistência

Somente bind mounts relativos:

```text
./volumes/instances
./volumes/postgres
./volumes/redis
./volumes/rabbitmq
./volumes/minio
./volumes/logs
./volumes/backups
```

Named volumes não pertencem ao contrato canônico.

## Segredos

`env.example` contém somente placeholders seguros. `prepare-env.sh` cria o `.env` real localmente e gera valores independentes para cada placeholder `CHANGE_ME_*`, incluindo senhas de banco/cache/fila/storage, credencial de métricas, token de webhook e API key.

O `.env` recebe `chmod 600` e permanece fora do Git.

## Isolamento produção/homologação

As stacks canônicas não usam `container_name` fixo. `COMPOSE_PROJECT_NAME`, rede, database, cache prefix, RabbitMQ, bucket, porta e diretório físico possuem valores próprios por ambiente, permitindo coexistência no mesmo host.

## Domínios

- Produção: `https://api.connect.argws.com.br`
- Homologação: `https://h.api.connect.argws.com.br`

## GHCR

Todos os serviços usam `ghcr.io/wkarts/*`. O host deve fazer login com `read:packages` quando os packages forem privados.

O bootstrap inicial das imagens de infraestrutura foi executado com sucesso. O workflow `GHCR - Sync Infrastructure Images` mantém as imagens core espelhadas. O `preflight.sh` verifica os manifests antes do `docker compose pull`.

## CI

`deployment-integrity.yml` valida:

- root Compose, CloudPanel, Dockge, produção e homologação;
- exatamente uma porta publicada e somente pela API;
- target interno `8080`;
- ausência de Manager separado;
- exatamente os cinco services esperados nas stacks canônicas;
- imagens exclusivamente GHCR;
- bind mounts;
- ausência de `container_name` fixo nas stacks production/homologation;
- portas distintas entre produção e homologação;
- paridade das chaves de `env.example` de production/homologation;
- scripts executáveis e sintaticamente válidos;
- existência dos manifests core no GHCR.

A integridade de PostgreSQL, MySQL e PgBouncer continua coberta separadamente pelo código/CI da aplicação; MySQL não faz parte do deployment canônico atual.
