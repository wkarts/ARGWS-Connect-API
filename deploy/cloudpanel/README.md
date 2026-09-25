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

## Manager em iframe / Hub

O Manager é embutível por padrão quando `MANAGER_IFRAME_ENABLED=true`. Com
`MANAGER_FRAME_ANCESTORS=*`, qualquer origem pode abrir `/manager/` em iframe,
inclusive `https://hub-dev.argws.com.br`.

O CloudPanel pode adicionar `X-Frame-Options: SAMEORIGIN` no reverse proxy mesmo
quando a aplicação já permite o iframe. Por isso o snippet oficial possui um bloco
`location ^~ /manager/` que remove o header upstream, substitui a política por
`Content-Security-Policy: frame-ancestors *` e evita herdar a política de frame do
vhost. Use esse bloco no vhost/reverse proxy que publica a API.

Validação esperada:

```bash
curl -I https://d.api.connect.argws.com.br/manager/login
```

Deve existir:

```text
Content-Security-Policy: frame-ancestors *
X-Connect-Manager-Embedding: enabled
```

e não deve existir `X-Frame-Options: SAMEORIGIN` nem `DENY`. Se esse header ainda
aparecer, ele está sendo injetado por uma camada externa ao container (CloudPanel,
Nginx adicional, CDN ou WAF) e precisa ser removido nessa camada.

Para restringir depois apenas aos hubs ARGWS, use, por exemplo:

```env
MANAGER_IFRAME_ENABLED=true
MANAGER_FRAME_ANCESTORS='self' https://hub-dev.argws.com.br https://hub.argws.com.br
```


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
```

`deploy.sh` valida secrets, cria as pastas de persistência, testa acesso às imagens GHCR, faz pull e inicia a stack.

## Porta interna x porta do host

`SERVER_PORT=8080` é a porta interna da aplicação e é forçada pelo Compose. Para mudar somente a porta usada pelo CloudPanel, altere:

```env
ARGWS_CONNECT_API_HOST_PORT=38080
ARGWS_CONNECT_DOCS_HOST_PORT=38180
```

Não altere `SERVER_PORT` no deployment Docker.
