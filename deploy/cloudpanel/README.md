# Deploy — CloudPanel

Deployment oficial do ARGWS Connect API para CloudPanel, sem build no servidor e consumindo somente imagens do GHCR.

## Portas locais

API e Connect|API DOCs publicam portas locais dedicadas no host:

```text
127.0.0.1:${ARGWS_CONNECT_API_HOST_PORT:-38080} -> API container:8080
127.0.0.1:${ARGWS_CONNECT_DOCS_HOST_PORT:-38180} -> DOCs container:8080
```

O Manager é servido pela própria API em `/manager`. `/metrics`, `/health`, WebSocket, webhooks e demais recursos usam o mesmo upstream.

No CloudPanel mantenha o Reverse Proxy da API apontando para:

```text
http://127.0.0.1:38080
```

Para expor o Connect|API DOCs, crie um segundo Reverse Proxy/hostname apontando para `http://127.0.0.1:38180`.

O snippet `nginx/api-location.conf.example` já contém headers de WebSocket e limite de upload compatível com a API.

## Serviços padrão

`docker compose up -d` inicia:

- API;
- Connect|API DOCs;
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
**Retaguarda emergencial:** comandos de scripts não compõem o deploy normal. Use somente o Compose e o `.env` no gerenciador da stack, conforme `OPERATIONS-CONTRACT.md`.env
ARGWS_CONNECT_API_HOST_PORT=38080
ARGWS_CONNECT_DOCS_HOST_PORT=38180
```

Não altere `SERVER_PORT` no deployment Docker.

## Contrato operacional vigente

No gerenciador de stacks, forneça o Compose deste deployment e o `.env`, preservando os volumes existentes. Credenciais de registry pertencem à configuração do gerenciador. O pooler gera seus próprios arquivos dentro do container; migrations, bootstrap e backup continuam sob responsabilidade dos serviços. Atualize as imagens homologadas pela ação de atualização da stack, sem aplicadores externos ou overlays obrigatórios. Consulte `OPERATIONS-CONTRACT.md` e `docs/guides/database-pooling.md`.
