# Connect|API Platform — Develop

Deployment **completo, independente e autocontido** da Connect|API Platform no canal `develop`.

Este diretório **não é overlay** de `deploy/develop/` e não reutiliza project, network, banco ou volumes daquela stack.

## Identidade da stack

```text
project:  argws-connect-platform-develop
network:  argws-connect-platform-develop-net
```

Todo service/container segue `<recurso>-argws-connect-platform-develop`.

## Componentes

A stack sobe integralmente por padrão:

- Connect|API Engine;
- Connect|API DOCs;
- PostgreSQL do Engine;
- Redis;
- RabbitMQ;
- MinIO;
- PostgreSQL exclusivo da Platform/Control Plane;
- migrations da Platform e dos tenants;
- bootstrap;
- Control API;
- worker Celery principal;
- worker dedicado de backups;
- scheduler Celery Beat;
- Docker Socket Proxy somente leitura e Log Agent;
- Prometheus e Grafana;
- ACME + CloudPanel Agent opcionais pelo profile `cloudpanel`;
- frontend Vue/PWA;
- gateway da Platform.

Não é necessário `--profile platform`.

## Domínios develop

| Superfície | Host |
| --- | --- |
| Platform | `d.connect.argws.com.br` |
| Control Plane | `d.control.connect.argws.com.br` |
| Admin | `d.admin.connect.argws.com.br` |
| Partner Plane | `d.partner.connect.argws.com.br` |
| API | `d.api.connect.argws.com.br` |
| DOCs | `d.docs.connect.argws.com.br` |
| Demo | `d.demo.connect.argws.com.br` |
| Tenants | `<tenant>.d.connect.argws.com.br` |

Portas locais padrão:

```text
API Engine : 127.0.0.1:38082
DOCs       : 127.0.0.1:38182
Gateway    : 127.0.0.1:38802
```

`d.api.connect.argws.com.br` e `d.docs.connect.argws.com.br` mantêm as portas já usadas pelo develop clássico para facilitar a troca de stack sem alterar esses dois reverse proxies. Por isso, a stack `argws-connect-develop` e esta stack **não devem subir simultaneamente com as portas padrão**. Para execução lado a lado, altere `ARGWS_CONNECT_API_HOST_PORT` e `ARGWS_CONNECT_DOCS_HOST_PORT` na `.env` desta stack antes do deploy.

Os hosts da Platform (`d.connect`, `d.control`, `d.admin`, `d.partner`, `d.demo` e wildcard de tenants) devem apontar para `127.0.0.1:38802` no reverse proxy.

## CloudPanel / ACME opcional

O deployment padrão continua sem privilégios de host. Quando o ambiente usa CloudPanel e deseja gestão automática do wildcard/certificado, ative o profile:

```bash
docker compose --env-file .env --profile cloudpanel up -d
```

Para Nginx/Certbot de host sem CloudPanel, use `deploy/platform/domain-agent/`.

## Primeiro deploy

```bash
cd deploy/platform-develop
bash prepare-env.sh
bash preflight.sh
bash deploy.sh
```

`prepare-env.sh`:

- cria `.env` a partir de `env.example`;
- sincroniza `CONNECT_API_VERSION` com `VERSION` da raiz;
- gera segredos fortes para todos os placeholders `CHANGE_ME_*`;
- aplica permissão `600` ao arquivo.

Se o GHCR exigir autenticação:

```bash
export GHCR_USERNAME=seu_usuario
export GHCR_TOKEN=seu_token
bash registry-login.sh
```

Atualização:

```bash
bash update.sh
```

Status:

```bash
bash status.sh
```

## Persistência

Todos os dados ficam isolados em `deploy/platform-develop/volumes/`:

```text
volumes/
├── instances/
├── postgres/
├── redis/
├── rabbitmq/
├── minio/
├── platform-postgres/
├── platform-backups/
├── platform-prometheus/
├── platform-grafana/
├── platform-acme/
├── platform-certs/
└── platform-cloudpanel-agent/
```

Nenhum volume do `deploy/develop` é reutilizado automaticamente.

## Migração do develop clássico

Esta stack é nova. Se houver sessões WhatsApp existentes em `deploy/develop/volumes/instances`, a migração deve ser feita de forma controlada com a stack antiga parada. Não use bind mount cruzado entre as duas stacks durante operação concorrente.

## Canal de imagens

Todas as imagens da aplicação usam o canal `develop`:

```text
ghcr.io/wkarts/argws-connect-api:develop
ghcr.io/wkarts/argws-connect-docs:develop
ghcr.io/wkarts/argws-connect-platform-api:develop
ghcr.io/wkarts/argws-connect-platform-web:develop
ghcr.io/wkarts/argws-connect-platform-gateway:develop
```

Infraestrutura mantém as tags oficiais definidas pelo projeto.
