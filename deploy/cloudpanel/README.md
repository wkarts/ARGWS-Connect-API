# Deploy — CloudPanel

Este diretório contém o deployment oficial do ARGWS Connect API para CloudPanel. O servidor não compila a aplicação: ele consome exclusivamente imagens publicadas no GHCR.

## Persistência da stack

O deployment usa **bind mounts relativos à própria pasta da stack**. Os dados não ficam em named volumes escondidos em `/var/lib/docker/volumes`.

Estrutura padrão criada em runtime:

```text
./volumes/
├── instances/
├── postgres/
├── redis/
├── rabbitmq/
├── minio/
├── logs/
└── backups/
```

Os caminhos usados pelo Compose podem ser sobrescritos no `.env`, quando necessário:

```env
ARGWS_CONNECT_INSTANCES_DATA_PATH=./volumes/instances
ARGWS_CONNECT_POSTGRES_DATA_PATH=./volumes/postgres
ARGWS_CONNECT_REDIS_DATA_PATH=./volumes/redis
ARGWS_CONNECT_RABBITMQ_DATA_PATH=./volumes/rabbitmq
ARGWS_CONNECT_MINIO_DATA_PATH=./volumes/minio
```

Sem essas variáveis, os caminhos `./volumes/...` acima são usados automaticamente.

## Pré-requisitos

- Docker Engine + Docker Compose v2
- CloudPanel com dois sites/reverse proxies (recomendado)
- acesso ao GHCR se os packages estiverem privados

## Preparar e subir

```bash
cp .env.example .env
chmod 600 .env
```

Troque obrigatoriamente `CHANGE_ME_*`, ajuste `SERVER_URL` e configure os domínios. Depois:

```bash
./deploy.sh
```

O script valida o Compose antes do pull e cria a árvore `./volumes` automaticamente.

### Perfis opcionais

```bash
# RabbitMQ
docker compose --profile messaging up -d

# MinIO
docker compose --profile storage up -d

# Stack completa
docker compose --profile full up -d
```

## CloudPanel

Crie dois sites Reverse Proxy:

- API -> `http://127.0.0.1:8080`
- Manager -> `http://127.0.0.1:3000`

Ative SSL/Let's Encrypt pelo CloudPanel. Para WebSocket, preserve os headers `Upgrade` e `Connection`.

## Atualização

```bash
./update.sh
docker image prune -f
```

Os bind mounts permanecem no diretório da stack durante pull/redeploy.

## Backup

A pasta `./volumes` facilita inventário, cópia e migração da instalação, mas o PostgreSQL deve ser copiado com backup consistente (`pg_dump`, `pg_dumpall` ou mecanismo equivalente), nunca copiando os arquivos do banco enquanto o serviço está ativo.

Dados persistentes principais:

- `./volumes/instances`
- `./volumes/postgres`
- `./volumes/redis`
- `./volumes/rabbitmq` (quando habilitado)
- `./volumes/minio` (quando habilitado)

`./volumes/logs` e `./volumes/backups` ficam reservados para a camada padronizada de observabilidade e backup da plataforma.
