# Connect|API — Deployment Profiles

Todos os perfis pertencem ao **mesmo produto, repositório, VERSION e release flow do Connect|API**.
O Manager legado não participa de nenhum perfil.

## Preparar ambiente

```bash
./deploy/platform/prepare-env.sh
# editar deploy/platform/.env e remover todos os CHANGE_ME
```

## Perfil `api`

Engine Node/TypeScript + PostgreSQL/Redis/RabbitMQ/MinIO. Sem frontend, Control Plane ou DOCs.

```bash
./deploy/platform/deploy.sh api
```

## Perfil `docs`

API-only + documentação oficial da mesma versão.

```bash
./deploy/platform/deploy.sh docs
```

## Perfil `platform`

Produto completo: Engine, DOCs, Platform Control API, Vue frontend, worker, scheduler, banco de governança e gateway.

```bash
./deploy/platform/deploy.sh platform
```

## Develop completo independente

Para o ambiente operacional `develop`, use a stack própria:

```text
deploy/platform-develop/
project = argws-connect-platform-develop
network = argws-connect-platform-develop-net
```

Ela não usa `deploy/develop` como base e sobe Engine + DOCs + Platform completa por padrão, sempre com imagens `:develop` da aplicação. Consulte `deploy/platform-develop/README.md`.

## Atualizar / status

```bash
./deploy/platform/update.sh platform
./deploy/platform/status.sh platform
```

## Build local

```bash
docker compose --env-file deploy/platform/.env \
  -f deploy/platform/compose.yaml \
  -f deploy/platform/compose.local-build.yaml \
  --profile platform up -d --build
```

## Lifecycle

- `develop` publica `:develop` para Engine e imagens Platform;
- `main` usa o `auto-version-release.yml` canônico;
- `VERSION` e `package.json` da raiz são a única fonte de versão;
- Platform API/Web/Gateway recebem exatamente a mesma SemVer do Connect|API;
- o RC34 não mantém versionamento nem workflow próprio.
