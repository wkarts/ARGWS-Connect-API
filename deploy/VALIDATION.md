# Validação do deployment — ARGWS Connect API

## Contrato canônico

O deployment oficial possui dois ambientes autocontidos: `deploy/production/` e `deploy/homologation/`.

## Porta única

Somente `api` publica porta no host.

- API interna: `8080`;
- produção: `127.0.0.1:38080`;
- homologação: `127.0.0.1:38081`.

Manager, healthcheck, métricas, WebSocket e webhooks usam esse mesmo endpoint.

## Core obrigatório

Sem profiles adicionais, ambas as stacks contêm exatamente:

- API;
- PostgreSQL;
- Redis;
- RabbitMQ;
- MinIO.

## Profiles opcionais

As duas stacks também preservam:

- `nats` → NATS + JetStream;
- `kafka` → Kafka + Zookeeper;
- `extended` → NATS + Kafka + Zookeeper.

Esses containers não são criados quando o profile não está habilitado. MySQL não faz parte das stacks oficiais; PostgreSQL é o provider canônico de deployment.

## Persistência

Core:

```text
./volumes/instances
./volumes/postgres
./volumes/redis
./volumes/rabbitmq
./volumes/minio
./volumes/logs
./volumes/backups
```

Profiles opcionais:

```text
./volumes/nats
./volumes/kafka
./volumes/zookeeper/data
./volumes/zookeeper/log
```

Named volumes não pertencem ao contrato canônico.

## Segredos

`env.example` contém placeholders seguros. `prepare-env.sh` cria o `.env` real localmente, gera valores fortes, aplica `chmod 600` e não altera um `.env` já existente.

## Isolamento

Produção e homologação não usam `container_name` fixo e possuem project name, rede, database, cache prefix, RabbitMQ, bucket, porta e diretório físico próprios.

## Domínios

- Produção: `https://api.connect.argws.com.br`
- Homologação: `https://h.api.connect.argws.com.br`

## GHCR

Core e mensageria opcional são consumidos via `ghcr.io/wkarts/*`. O bootstrap inicial foi executado com sucesso. O workflow de sincronização mantém as imagens necessárias espelhadas.

## CI

`deployment-integrity.yml` valida:

- root Compose, CloudPanel, Dockge, produção e homologação;
- core padrão sem profiles;
- NATS/Kafka/Zookeeper com todos os profiles ativados;
- exatamente uma porta publicada e somente pela API;
- target interno `8080`;
- ausência de Manager separado;
- ausência de MySQL nas stacks canônicas;
- imagens exclusivamente GHCR;
- somente bind mounts;
- ausência de `container_name` fixo;
- portas distintas entre produção e homologação;
- paridade de env;
- scripts executáveis;
- manifests GHCR do core.
