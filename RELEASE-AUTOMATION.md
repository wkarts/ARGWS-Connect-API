# ARGWS Connect API — Versionamento e Release

## Linha canônica

ARGWS Connect API segue Semantic Versioning a partir de `1.0.0`.

## Branches permanentes

### `develop`

É a linha contínua de desenvolvimento e homologação.

Cada push ou merge em `develop`:

1. executa os gates de qualidade, segurança e banco;
2. constrói a imagem multi-arquitetura da API;
3. sobrescreve exclusivamente:

```text
ghcr.io/wkarts/argws-connect-api:develop
```

A branch `develop` **não** cria:

- tag SemVer;
- tag `latest`;
- tag SHA da aplicação;
- Git tag;
- GitHub Release;
- commit automático de versão.

A homologação consome sempre `:develop`.

### `main`

É a linha estável e versionada.

Quando uma versão em `develop` estiver confiável, abre-se PR:

```text
develop → main
```

Após o merge, `.github/workflows/auto-version-release.yml` executa a release automática.

## Fluxo oficial

```text
feature/*
   ↓ PR
 develop
   ↓ build aprovado
 :develop
   ↓
 homologação
   ↓ validação funcional
 PR develop → main
   ↓ merge
 main
   ↓
 SemVer + Git tag + GitHub Release + imagens versionadas
   ↓
 produção
```

## Release automática da `main`

O workflow executa, em ordem:

1. `npm ci`;
2. lint;
3. Prisma client;
4. build;
5. cálculo da próxima versão;
6. atualização de `VERSION`, `package.json`, `package-lock.json` e `RELEASE-MANIFEST.json`;
7. build Docker multi-arquitetura (`linux/amd64`, `linux/arm64`);
8. publicação no GHCR;
9. Git tag imutável;
10. GitHub Release com release notes e digests.

A release não é criada se validação ou build falhar.

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
fix: ...       → patch
feat: ...      → minor
feat!: ...     → major
BREAKING CHANGE → major
```

## Tags estáveis da `main`

Para uma release `1.4.3`, a linha estável pode publicar:

```text
ghcr.io/wkarts/argws-connect-api:1.4.3
ghcr.io/wkarts/argws-connect-api:1.4
ghcr.io/wkarts/argws-connect-api:1
ghcr.io/wkarts/argws-connect-api:latest
```

`latest` significa **última release estável**, nunca desenvolvimento.

## Imagem de desenvolvimento

Existe somente uma tag mutável para a branch de desenvolvimento:

```text
ghcr.io/wkarts/argws-connect-api:develop
```

Ela é exclusiva de homologação e jamais deve ser usada em produção.

## Produção

Produção permanece fixada em tag SemVer explícita e só muda por promoção controlada:

```bash
cd deploy/production
./promote.sh X.Y.Z
```

## Permissões

GitHub Actions requer:

- `contents: write` para commit/tag/release na `main`;
- `packages: write` para GHCR;
- `pull-requests: read` para metadados da PR.

`develop` não precisa de permissão para alterar conteúdo do repositório; apenas `contents: read` e `packages: write`.
