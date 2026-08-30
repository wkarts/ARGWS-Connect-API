# Deploy — Dockge

Este stack foi preparado para uso no Dockge e consome somente imagens do GHCR.

## Regra de persistência

A stack usa bind mounts relativos ao diretório onde o `compose.yaml` está armazenado. Assim, os dados físicos acompanham a própria stack:

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

Não são utilizados named volumes Docker para esses dados.

Opcionalmente, os caminhos podem ser sobrescritos no `.env`:

```env
ARGWS_CONNECT_INSTANCES_DATA_PATH=./volumes/instances
ARGWS_CONNECT_POSTGRES_DATA_PATH=./volumes/postgres
ARGWS_CONNECT_REDIS_DATA_PATH=./volumes/redis
ARGWS_CONNECT_RABBITMQ_DATA_PATH=./volumes/rabbitmq
ARGWS_CONNECT_MINIO_DATA_PATH=./volumes/minio
```

Sem override, o Compose já usa `./volumes/...` como padrão.

## Instalação

1. Crie a stack `argws-connect-api` no Dockge.
2. Mantenha `compose.yaml`, `.env` e a pasta `volumes/` no mesmo diretório da stack.
3. Copie as variáveis de `.env.example` para o `.env` e altere todos os valores `CHANGE_ME_*`.
4. Se o GHCR for privado, autentique o host Docker:

```bash
echo "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
```

5. Faça **Pull** e depois **Deploy/Up**.

## Portas

- API: `127.0.0.1:8080`
- Manager: `127.0.0.1:3000`

Para exposição direta, altere `ARGWS_CONNECT_BIND_ADDRESS=0.0.0.0`. Com reverse proxy no mesmo host, mantenha `127.0.0.1`.

## Perfis opcionais

O stack padrão sobe API, Manager, PostgreSQL e Redis. RabbitMQ e MinIO usam profiles `messaging`, `storage` e `full`.

## Atualização

Use **Pull** e depois **Redeploy**. Não existe build da aplicação no servidor e os dados permanecem em `./volumes`.

## Observabilidade e backup

As pastas `./volumes/logs` e `./volumes/backups` ficam reservadas para os containers padronizados de observabilidade e backup que serão incorporados ao ARGWS Platform Template. Elas não alteram o runtime atual do Connect API.
