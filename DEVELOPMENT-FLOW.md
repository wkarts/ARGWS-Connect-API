# ARGWS Connect API — Fluxo oficial de desenvolvimento

## Objetivo

Separar completamente desenvolvimento/homologação da linha estável de produção.

## Branches permanentes

### `develop`

Branch de integração contínua.

- nasce como clone da `main`;
- recebe PRs de `feature/*`, `fix/*`, `chore/*` e demais branches de trabalho;
- cada push/merge publica sempre a mesma imagem:

```text
ghcr.io/wkarts/argws-connect-api:develop
```

- não altera `VERSION`;
- não cria Git tag;
- não cria GitHub Release;
- não publica `:latest`;
- não publica tag SemVer;
- não publica tag SHA da aplicação.

A stack de homologação consome exclusivamente `:develop`.

### `main`

Branch estável e versionada.

Nenhum desenvolvimento cotidiano deve ser feito diretamente na `main`.

Quando o estado de `develop` estiver aprovado em homologação:

1. abrir PR `develop → main`;
2. aguardar todos os gates obrigatórios;
3. fazer merge;
4. o workflow de release calcula a próxima versão SemVer;
5. publica as imagens versionadas;
6. cria Git tag e GitHub Release;
7. a produção pode promover explicitamente a nova versão.

## Diagrama

```text
feature/* / fix/*
       │
       │ PR
       ▼
    develop
       │
       │ CI + build
       ▼
argws-connect-api:develop
       │
       ▼
  HOMOLOGAÇÃO
       │
       │ aprovado
       ▼
 PR develop → main
       │
       ▼
      main
       │
       ├── SemVer
       ├── Git tag
       ├── GitHub Release
       ├── :X.Y.Z
       ├── :X.Y
       ├── :X
       └── :latest (última release estável)
              │
              ▼
          PRODUÇÃO
```

## Regra da tag `latest`

`latest` representa somente a última release estável produzida pela `main`.

Desenvolvimento nunca escreve em `latest`.

## Homologação

Imagem:

```text
ghcr.io/wkarts/argws-connect-api:develop
```

Deployment:

```bash
cd deploy/homologation
./update.sh
```

## Produção

Produção deve utilizar tag SemVer explícita:

```text
ghcr.io/wkarts/argws-connect-api:X.Y.Z
```

Promoção:

```bash
cd deploy/production
./promote.sh X.Y.Z
```

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
