# ARGWS Connect API — Fluxo oficial de desenvolvimento

## Objetivo

Separar completamente desenvolvimento/homologação da linha estável de produção, sem permitir que os workflows de uma branch publiquem tags pertencentes à outra.

## Branches permanentes

### `develop`

Branch de integração contínua.

- nasce e permanece sincronizável com a `main`;
- recebe PRs de `feature/*`, `fix/*`, `chore/*` e demais branches de trabalho;
- cada push/merge em `develop` publica os dois artefatos de desenvolvimento:

```text
ghcr.io/wkarts/argws-connect-api:develop
ghcr.io/wkarts/argws-connect-manager:develop
ghcr.io/wkarts/argws-connect-docs:develop
```

- usa builds nativos `linux/amd64` e `linux/arm64`;
- não altera `VERSION` para criar release;
- não cria Git tag;
- não cria GitHub Release;
- não publica `:latest`;
- não publica tag SemVer;
- não publica tags estáveis da aplicação.

A stack `deploy/develop` consome `argws-connect-api:develop` e `argws-connect-docs:develop`. O Manager operacional continua servido pela própria API em `/manager`; a imagem `argws-connect-manager:develop` é publicada como artefato independente para validar o mesmo componente que será publicado pela `main`, sem exigir um segundo container no Compose atual.

### `main`

Branch estável e versionada.

Nenhum desenvolvimento cotidiano deve ser feito diretamente na `main`.

Quando o estado de `develop` estiver aprovado em homologação:

1. abrir PR `develop → main`;
2. aguardar todos os gates obrigatórios;
3. fazer merge;
4. somente o push resultante em `main` dispara o workflow de release;
5. o workflow calcula a próxima versão SemVer;
6. constrói API, Manager e DOCs em `amd64` e `arm64`;
7. publica imagens versionadas e `:latest`;
8. cria Git tag e GitHub Release.

## Isolamento dos gatilhos

```text
push/merge em develop
        │
        └── GHCR Development
             ├── argws-connect-api:develop
             └── argws-connect-manager:develop

PR develop → main
        │
        ├── executa gates de validação
        └── NÃO publica release antes do merge

merge/push em main
        │
        └── Release Stable
             ├── API :X.Y.Z / :X.Y / :X / :latest
             ├── Manager :X.Y.Z / :X.Y / :X / :latest
             ├── Git tag
             └── GitHub Release

sincronização main → develop
        │
        └── é um push em develop
             ├── atualiza somente API :develop
             ├── atualiza somente Manager :develop
             └── nunca dispara SemVer/:latest/Release
```

Assim, os dois sentidos são seguros:

- `develop → main`: somente depois do merge a `main` publica uma nova release;
- `main → develop`: apenas renova as imagens `:develop`, sem tocar em `:latest` ou SemVer.

## Diagrama operacional

```text
feature/* / fix/*
       │
       │ PR
       ▼
    develop
       │
       │ CI + builds nativos
       ▼
┌──────────────────────────────────────┐
│ argws-connect-api:develop            │
│ argws-connect-manager:develop        │
└──────────────────────────────────────┘
       │
       ▼
  HOMOLOGAÇÃO
       │
       │ aprovado
       ▼
 PR develop → main
       │
       │ gates somente
       ▼
   MERGE EM main
       │
       ├── SemVer
       ├── Git tag
       ├── GitHub Release
       ├── API :X.Y.Z / :X.Y / :X / :latest
       └── Manager :X.Y.Z / :X.Y / :X / :latest
              │
              ▼
          PRODUÇÃO
```

## Regra da tag `latest`

`latest` representa somente a última release estável produzida pela `main`.

A branch `develop` nunca escreve em `latest`.

## Homologação / develop

Imagem operacional:

```text
ghcr.io/wkarts/argws-connect-api:develop
```

Deployment:

```bash
cd deploy/develop
./update.sh
```

O Compose usa projeto, containers, rede, volumes e porta próprios do ambiente `develop` e não compartilha identidade de stack com produção/canonical.

## Produção

O workflow da `main` publica SemVer e também atualiza `:latest`. A promoção operacional deve continuar controlada pelo deployment de produção, sem reutilizar `:develop`.

## Fase 2 / Control Plane

Todo desenvolvimento da Fase 2 e trabalhos posteriores devem partir de `develop` ou de uma branch criada a partir de `develop`.

PRs funcionais seguem:

```text
feature/... → develop
```

Somente uma release aprovada segue:

```text
develop → main
```
