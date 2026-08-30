# Deploy — CloudPanel

Deployment oficial do ARGWS Connect API para CloudPanel, sem build no servidor e consumindo somente imagens do GHCR.

## Uma única porta

Somente a API publica porta no host:

```text
127.0.0.1:${ARGWS_CONNECT_API_HOST_PORT:-38080} -> container:8080
```

O Manager é servido pela própria API em `/manager`. `/metrics`, `/health`, WebSocket, webhooks e demais recursos usam o mesmo upstream.

No CloudPanel crie **um único Reverse Proxy** apontando para:

```text
http://127.0.0.1:38080
```

O snippet `nginx/api-location.conf.example` já contém headers de WebSocket e limite de upload compatível com a API.

## Serviços padrão

`docker compose up -d` inicia:

- API;
- PostgreSQL;
- Redis;
- RabbitMQ;
- MinIO.

Todos os serviços de infraestrutura usam somente `expose`, nunca `ports`.

Perfis adicionais:

```bash
COMPOSE_PROFILES=nats docker compose up -d
COMPOSE_PROFILES=kafka docker compose up -d
COMPOSE_PROFILES=extended docker compose up -d
COMPOSE_PROFILES=mysql docker compose up -d
```

## Persistência

Os dados ficam fisicamente ao lado da stack em `./volumes/...`, incluindo PostgreSQL, Redis, RabbitMQ, MinIO, MySQL, NATS, Kafka e Zookeeper.

## GHCR / erro `denied`

Se o host receber erro de acesso ao `ghcr.io/wkarts/*`, autentique o Docker sem gravar o PAT no `.env` da aplicação:

```bash
export GHCR_USERNAME=wkarts
export GHCR_TOKEN='PAT_COM_READ_PACKAGES'
./registry-login.sh
```

Depois execute:

```bash
cp .env.example .env
chmod 600 .env
# edite os CHANGE_ME_*
./deploy.sh
```

`deploy.sh` valida secrets, cria as pastas de persistência, testa acesso às imagens GHCR, faz pull e inicia a stack.

## Porta interna x porta do host

`SERVER_PORT=8080` é a porta interna da aplicação e é forçada pelo Compose. Para mudar somente a porta usada pelo CloudPanel, altere:

```env
ARGWS_CONNECT_API_HOST_PORT=38080
```

Não altere `SERVER_PORT` no deployment Docker.
