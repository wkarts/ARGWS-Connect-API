# ARGWS Connect API — Versionamento e Release

## Linha canônica

ARGWS Connect API segue Semantic Versioning a partir de `1.0.0`.

## Branches permanentes

### `develop`

É a linha contínua de desenvolvimento e homologação.

Cada push ou merge em `develop`:

1. executa os gates de qualidade, segurança, banco e deployment;
2. constrói a imagem multi-arquitetura da API;
3. sobrescreve exclusivamente:

```text
ghcr.io/wkarts/argws-connect-api:develop
```

A branch `develop` **não** cria tag SemVer, `latest`, Git tag, GitHub Release ou commit automático de versão.

O deployment `deploy/develop` consome sempre `:develop`.

### `main`

É a linha estável e versionada.

No fluxo normal, uma versão aprovada em `develop` é promovida por PR `develop → main`. Em correções emergenciais feitas diretamente na linha estável, a correção nasce em `main` e, depois de validada/releaseada, a `develop` é realinhada por PR `main → develop`.

## Fluxo normal

```text
feature/* / fix/*
        ↓ PR
      develop
        ↓
      :develop
        ↓ homologação aprovada
PR develop → main
        ↓
       main
        ↓
SemVer + Git tag + GitHub Release
        ↓
:X.Y.Z + :X.Y + :X + :latest
```

## Release automática da `main`

O workflow executa, em ordem:

1. `npm ci`;
2. lint;
3. geração do Prisma Client;
4. build da aplicação;
5. cálculo da próxima versão;
6. materialização da versão planejada no contexto de build;
7. build Docker nativo `linux/amd64` e `linux/arm64`;
8. atualização de `VERSION`, `package.json`, `package-lock.json`, `RELEASE-MANIFEST.json` e do pin do deployment Canonical;
9. publicação dos manifests multi-arquitetura no GHCR;
10. Git tag imutável;
11. GitHub Release com release notes e digests.

A imagem precisa reportar em runtime a mesma versão SemVer publicada no GHCR. A release não é criada se validação ou build falhar.

Antes de uma promoção estável, a baseline da `main` deve estar verde nos gates de **Image Promotion**, **Deployment Integrity**, **Database Integrity**, **Code Quality** e **Security/CodeQL**. Commits de preparação usam `[skip release]`; somente o commit explícito de promoção dispara a próxima SemVer.

## Cálculo da versão

O incremento padrão é `patch`.

Labels opcionais na PR para `main`:

```text
version:patch
version:minor
version:major
```

Sem label, títulos Conventional Commits também são considerados:

```text
fix: ...        → patch
feat: ...       → minor
feat!: ...      → major
BREAKING CHANGE → major
```

## Canais de imagem

Para uma release `1.4.3`, a `main` publica:

```text
ghcr.io/wkarts/argws-connect-api:1.4.3
ghcr.io/wkarts/argws-connect-api:1.4
ghcr.io/wkarts/argws-connect-api:1
ghcr.io/wkarts/argws-connect-api:latest
```

As políticas oficiais são:

```text
deploy/production  → :latest
deploy/develop     → :develop
deploy/canonical   → :X.Y.Z
```

- `latest` = última release estável da `main`;
- `develop` = última build validada da branch `develop`;
- Canonical = stack independente e reproduzível, pinada automaticamente na última SemVer estável.

## Deployments oficiais

### Production

```text
COMPOSE_PROJECT_NAME=argws-connect-production
SERVER_URL=https://api.connect.argws.com.br
ARGWS_CONNECT_API_HOST_PORT=38080
ARGWS_CONNECT_API_IMAGE=ghcr.io/wkarts/argws-connect-api:latest
```

### Develop

```text
COMPOSE_PROJECT_NAME=argws-connect-develop
SERVER_URL=https://d.api.connect.argws.com.br
ARGWS_CONNECT_API_HOST_PORT=38082
ARGWS_CONNECT_API_IMAGE=ghcr.io/wkarts/argws-connect-api:develop
```

### Canonical

```text
COMPOSE_PROJECT_NAME=argws-connect-canonical
SERVER_URL=https://c.api.connect.argws.com.br
ARGWS_CONNECT_API_HOST_PORT=38083
ARGWS_CONNECT_API_IMAGE=ghcr.io/wkarts/argws-connect-api:X.Y.Z
```

Canonical é uma stack de produção independente, com rede, volumes, dados e porta próprios.

## Convenção dos services

Todo service recebe a identidade completa da stack:

```text
api-argws-connect-production
postgres-argws-connect-production
redis-argws-connect-production
rabbitmq-argws-connect-production
minio-argws-connect-production
```

A mesma regra vale para `develop`, `canonical` e futuras instalações como `production-parceiro` ou `production-2`.

Os nomes das **imagens GHCR de infraestrutura permanecem globais**; apenas service/container/hostname recebem o sufixo da stack.

## Permissões

GitHub Actions requer:

- `contents: write` para commit/tag/release na `main`;
- `packages: write` para GHCR;
- `pull-requests: read` para metadados da PR.

`develop` usa `contents: read` e `packages: write`.


## Connect|API DOCs

A release de `main` publica `ghcr.io/wkarts/argws-connect-docs` com a mesma SemVer da API, incluindo `X.Y.Z`, `X.Y`, `X` e `latest`. O `deploy/canonical` mantém API e DOCs pinados na mesma versão.
