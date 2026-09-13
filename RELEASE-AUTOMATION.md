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

A branch `develop` não cria tag SemVer, `latest` ou GitHub Release. Depois de uma release estável, ela recebe automaticamente a mesma versão publicada na `main`, sem produzir uma segunda release.

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
8. atualização de `VERSION`, `package.json`, `package-lock.json`, `RELEASE-MANIFEST.json` e dos campos de versão dos contratos OpenAPI/AsyncAPI;
9. publicação dos manifests multi-arquitetura no GHCR;
10. Git tag imutável;
11. GitHub Release com release notes e digests;
12. sincronização da versão de `develop` e disparo das imagens API, Manager e DOCs `:develop`.

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

## Previsão na PR e alinhamento de `develop`

A PR `develop → main` mostra a próxima SemVer no resumo do check **Release Contract Integrity**. O cálculo usa o mesmo `compute-next-version.mjs` da publicação; alterações de título ou labels recalculam a previsão. A versão efetiva é recalculada no merge, pois outra release pode ter sido publicada durante a revisão. A previsão não altera o código nem cria uma release antecipada.

Depois da publicação estável:

- se `develop` for ancestral do commit publicado, a sincronização usa fast-forward;
- se houver commits novos ou históricos divergentes, um commit sobre o HEAD atual de `develop` atualiza somente os metadados de versão;
- código, dependências, lock das dependências, contratos específicos de `develop`, migrations, configuração e histórico são preservados;
- o script reaplica a versão em `package.json`, `package-lock.json` (raiz e pacote raiz), `VERSION`, `RELEASE-MANIFEST.json`, dois OpenAPI, AsyncAPI e inventário de cobertura;
- quando o inventário de cobertura é igual ao da release, seu `generatedAt` também é alinhado para evitar conflito artificial na próxima promoção; contratos novos em `develop` mantêm sua data original;
- uma release ultrapassada ou uma versão já maior em `develop` não causa downgrade;
- push concorrente provoca nova tentativa a partir do HEAD remoto; não há force-push.

O push feito pelo `GITHUB_TOKEN` não inicia workflows de `push`. Por isso o job dispara explicitamente `ghcr-publish-application.yml` e `ghcr-publish-docs.yml` com `--ref develop`. Só as tags `:develop` são renovadas. Cada execução fixa o checkout no SHA do evento em todas as arquiteturas; avanços posteriores da branch não misturam commits dentro da mesma imagem. Esses workflows não voltam a executar a release de `main`, evitando ciclos.

Se a etapa de sincronização falhar por indisponibilidade ou proteção de branch, a release publicada continua válida. Reexecute apenas o job que falhou depois de resolver a causa. A sincronização é idempotente e preserva a data da release original. Uma falha de permissão permanece visível; o workflow não contorna proteções do repositório.

A igualdade da SemVer identifica a baseline publicada, não garante igualdade de código entre canais: commits novos podem existir em `develop`. Para comparar builds, use também o SHA/digest da imagem.

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
- Canonical = fallback independente e reproduzível, congelado em `1.0.21`; releases novas não alteram esse deployment histórico.

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

Os workflows de imagens de `develop` usam `contents: read` e `packages: write`. O job isolado de sincronização pós-release usa `contents: write` para o commit de metadados e `actions: write` para disparar os builds de desenvolvimento com o `GITHUB_TOKEN` existente. Não requer PAT, secret ou variável de ambiente nova.


## Connect|API DOCs

A release de `main` publica `ghcr.io/wkarts/argws-connect-docs` com a mesma SemVer da API, incluindo `X.Y.Z`, `X.Y`, `X` e `latest`. O `deploy/canonical` mantém API e DOCs pinados na mesma versão.
