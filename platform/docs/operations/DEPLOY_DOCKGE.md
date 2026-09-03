# Deploy no Dockge

## Objetivo

Executar a Connect|API Platform no Dockge usando **somente imagens publicadas no GHCR**, sem compilar backend/frontend no servidor e sem exigir o código-fonte dentro da pasta da stack.

## Pacote recomendado da Release

Para instalação manual no Dockge, use o asset dedicado:

```text
Connect-API-Platform-v<VERSAO>-Dockge.zip
```

Ele é diferente do pacote completo de código-fonte. O bundle Dockge contém `compose.yaml` image-only na raiz da pasta `connect-api-platform/`, `.env.example`, README, manifesto e os diretórios `data-*`.

**Não use o `compose.yaml` da raiz do pacote completo de código-fonte como stack Dockge.** Esse Compose é destinado a desenvolvimento/build e pode tentar localizar `backend/` e `frontend/`. Se o terminal mostrar `[+] Building`, a stack não está usando o Compose Dockge correto.

## Arquivos de origem do bundle

```text
deployments/dockge/
├── .env.example
├── compose.yaml
├── install.sh
├── update.sh
├── rollback.sh
├── healthcheck.sh
└── README.md
```

O `deployments/dockge/compose.yaml` é uma stack **image-only** independente do Compose de desenvolvimento/build da raiz.

## Pré-requisitos

- Linux 64-bit;
- Docker Engine;
- Docker Compose v2;
- Dockge instalado;
- acesso ao diretório de stacks do Dockge;
- acesso ao `ghcr.io`;
- proxy reverso externo para `127.0.0.1:GATEWAY_PORT`.

## Imagens

O canal operacional utiliza sempre `latest`:

```text
ghcr.io/YOUR_ORG/connect-api-platform-api:latest
ghcr.io/YOUR_ORG/connect-api-platform-web:latest
ghcr.io/YOUR_ORG/connect-api-platform-gateway:latest
```

As tags versionadas continuam publicadas para auditoria e rollback, mas não são fixadas no `.env` de operação normal.

## Estrutura da stack e persistência

Com `CONNECT_API_DATA_ROOT=.`, todos os dados persistentes ficam visíveis dentro da própria pasta da stack:

```text
connect-api-platform/
├── compose.yaml
├── .env
├── data-postgres/
├── data-redis/
├── data-rabbitmq/
├── data-minio/
├── data-backups/
├── data-runtime/
└── data-celery/
```

Os bind mounts são:

```text
./data-postgres   -> /var/lib/postgresql/data
./data-redis      -> /data
./data-rabbitmq   -> /var/lib/rabbitmq
./data-minio      -> /data
./data-backups    -> /data/backups
./data-runtime    -> /data/runtime
./data-celery     -> /var/lib/celery
```

A stack Dockge **não usa volumes Docker nomeados para esses dados**. Isso facilita backup físico, auditoria, cópia e migração da stack sem depender de `/var/lib/docker/volumes`.

## Importação manual no Dockge

Preferencialmente extraia o bundle `-Dockge.zip` no diretório de stacks. Se estiver usando o repositório completo, copie explicitamente `deployments/dockge/compose.yaml` para `compose.yaml` na pasta da stack e `deployments/dockge/.env.example` para `.env`.

Garanta:

```env
APP_PULL_POLICY=always
CONNECT_API_DATA_ROOT=.
BACKEND_IMAGE=ghcr.io/YOUR_ORG/connect-api-platform-api:latest
FRONTEND_IMAGE=ghcr.io/YOUR_ORG/connect-api-platform-web:latest
GATEWAY_IMAGE=ghcr.io/YOUR_ORG/connect-api-platform-gateway:latest
```

Depois:

```bash
docker compose config
docker compose pull
docker compose up -d
```

Não execute `docker compose build` para a stack Dockge.

## Instalação automatizada

A partir da raiz do pacote completo:

```bash
sudo ./deployments/dockge/install.sh \
  --domain connect.exemplo.com.br \
  --admin-email admin@exemplo.com.br \
  --stacks-dir /opt/stacks \
  --stack-name connect-api-platform
```

O instalador prepara o `.env`, gera os segredos, força `APP_PULL_POLICY=always`, define `CONNECT_API_DATA_ROOT=.`, aponta API/Web/Gateway para `ghcr.io/wkarts/...:latest`, cria os diretórios `data-*`, executa `docker compose pull`, sobe a stack sem build e aguarda `/health/ready`.

## Reverse proxy

O gateway publica somente em loopback. Exemplo:

```env
GATEWAY_BIND_IP=127.0.0.1
GATEWAY_PORT=18800
```

No CloudPanel, o reverse proxy deve apontar para:

```text
http://127.0.0.1:18800
```

O vhost deve preservar o cabeçalho `Host` e aceitar o domínio principal, Control Plane, API e wildcard de tenants.

## Atualização

```bash
./deployments/dockge/update.sh
```

A atualização realiza backup, preserva os diretórios `data-*`, volta as imagens ao canal `latest`, executa `docker compose pull`, recria os containers e valida readiness.

## Rollback

```bash
./deployments/dockge/rollback.sh 1.0.0-rc.5
```

O rollback troca temporariamente API, Web e Gateway para os aliases imutáveis da versão informada, mantendo os mesmos diretórios `data-*`. Para retornar ao canal operacional `latest`, execute `update.sh`.

## Health check

```bash
./deployments/dockge/healthcheck.sh
```

Ou diretamente:

```bash
docker compose ps
curl -fsS http://127.0.0.1:${GATEWAY_PORT}/health/live
curl -fsS http://127.0.0.1:${GATEWAY_PORT}/health/ready
```

## Segurança operacional

Não apague `data-postgres`, `data-redis`, `data-rabbitmq`, `data-minio`, `data-backups`, `data-runtime` ou `data-celery` durante update/redeploy. Antes de mover ou excluir a pasta da stack, valide backup e restauração.
