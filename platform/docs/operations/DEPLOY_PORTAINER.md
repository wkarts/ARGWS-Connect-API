# Deploy no Portainer

## Objetivo

Implantar e atualizar a plataforma como uma Stack Portainer, utilizando imagens versionadas publicadas no GHCR ou, alternativamente, uma stack de build associada a um repositório Git.

## Arquivos entregues

```text
deployments/portainer/
├── .env.example
├── stack.yaml
├── stack-build.yaml
├── deploy.sh
├── update.sh
├── webhook.sh
└── README.md
```

## Modos suportados

### Stack por imagens

`stack.yaml` não possui `build:`. Ele consome:

```text
BACKEND_IMAGE
FRONTEND_IMAGE
GATEWAY_IMAGE
```

Esse é o modo recomendado para produção no Portainer.

### Stack por repositório Git

`stack-build.yaml` referencia os Dockerfiles do repositório e pode ser usado quando o endpoint Portainer possui acesso ao código e permite build local. O modo por imagens é mais previsível e facilita rollback por tag.

## Preparação do ambiente

```bash
cp deployments/portainer/.env.example deployments/portainer/.env
python3 scripts/generate_secrets.py --env deployments/portainer/.env
```

Ajuste no mínimo:

```env
PLATFORM_DOMAIN=connect.exemplo.com.br
CONTROL_PLANE_HOST=control.connect.exemplo.com.br
API_HOST=api.connect.exemplo.com.br
TENANT_DOMAIN_ROOT=connect.exemplo.com.br
BACKEND_IMAGE=ghcr.io/YOUR_ORG/connect-api-platform-api:1.0.0-rc.2
FRONTEND_IMAGE=ghcr.io/YOUR_ORG/connect-api-platform-web:1.0.0-rc.2
GATEWAY_IMAGE=ghcr.io/YOUR_ORG/connect-api-platform-gateway:1.0.0-rc.2
```

## Deploy automatizado pela API

Crie uma API key no Portainer e execute:

```bash
./deployments/portainer/deploy.sh \
  --domain connect.exemplo.com.br \
  --admin-email admin@exemplo.com.br \
  --url https://portainer.exemplo.com.br \
  --api-key ptr_xxxxxxxxx \
  --endpoint-id 1 \
  --stack-name connect-api-platform
```

Opções:

```text
--env-file ARQUIVO
--local
--insecure
```

`--local` usa o Docker Compose do host com o mesmo `stack.yaml`, útil para validar a stack fora da interface.

## Deploy pela interface

1. abra **Stacks**;
2. escolha **Add stack**;
3. selecione **Web editor**, **Upload** ou **Repository**;
4. carregue `stack.yaml` ou `stack-build.yaml` conforme o modo;
5. importe as variáveis do `.env` sem versionar os segredos;
6. faça o deploy;
7. confirme a conclusão dos containers de migration/bootstrap;
8. valide `/health/ready`.

## Atualização

Para execução local:

```bash
cd deployments/portainer
./update.sh .env
```

Para uma stack controlada pela API, execute novamente `deploy.sh` com a mesma identificação e novas tags de imagem. O helper Python cria ou atualiza a stack de forma idempotente.

## Webhook de atualização

O arquivo `webhook.sh` permite acionar um webhook de stack criado no Portainer:

```bash
PORTAINER_WEBHOOK_URL='https://portainer.exemplo.com.br/api/stacks/webhooks/UUID' \
  ./deployments/portainer/webhook.sh
```

Não armazene a URL do webhook em repositório público.

## Rollback

1. altere `APP_VERSION` e as três imagens para a tag anterior;
2. execute novamente o deploy/update;
3. quando houver mudança não retrocompatível de schema, restaure o backup correspondente;
4. valide readiness antes de reabrir o tráfego.

## Volumes

A stack por imagens usa volumes nomeados. Planeje backup no mesmo endpoint Docker e não remova volumes pela interface sem exportação validada.

## Preparar e validar sem chamar a API

```bash
./deployments/portainer/deploy.sh \
  --domain connect.exemplo.com.br \
  --admin-email admin@exemplo.com.br \
  --env-file /opt/connect-api-platform/stack.env \
  --prepare-only
```

Esse modo gera segredos, aplica os hosts e imagens versionadas, valida o projeto e encerra antes de acessar Docker ou Portainer. O arquivo `stack.env` deve permanecer com permissão `0600` e não deve ser versionado.
