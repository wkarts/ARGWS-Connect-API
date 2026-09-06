# GHCR — ARGWS Connect API

O GHCR é o registry oficial do produto. Produção e homologação não fazem pull direto de Docker Hub, Quay ou outro registry.

## Aplicação

### Desenvolvimento / homologação

A branch `develop` publica somente uma tag mutável:

```text
ghcr.io/wkarts/argws-connect-api:develop
ghcr.io/wkarts/argws-connect-docs:develop
```

Ela é sobrescrita a cada push/merge em `develop` e não representa release.

### Estável / produção

A branch `main` é versionada. Releases aprovadas publicam tags SemVer e `latest` como alias da última release estável:

```text
ghcr.io/wkarts/argws-connect-api:X.Y.Z
ghcr.io/wkarts/argws-connect-api:X.Y
ghcr.io/wkarts/argws-connect-api:X
ghcr.io/wkarts/argws-connect-api:latest
ghcr.io/wkarts/argws-connect-docs:X.Y.Z
ghcr.io/wkarts/argws-connect-docs:X.Y
ghcr.io/wkarts/argws-connect-docs:X
ghcr.io/wkarts/argws-connect-docs:latest
```

Produção deve permanecer fixada em `X.Y.Z`; `latest` não deve ser usado para deployment de produção.

## Imagens da infraestrutura

Core:

```text
ghcr.io/wkarts/argws-connect-postgres
ghcr.io/wkarts/argws-connect-redis
ghcr.io/wkarts/argws-connect-rabbitmq
ghcr.io/wkarts/argws-connect-minio
```

Opcionais:

```text
ghcr.io/wkarts/argws-connect-nats
ghcr.io/wkarts/argws-connect-kafka
ghcr.io/wkarts/argws-connect-zookeeper
```

## Sincronização

`GHCR - Sync Infrastructure Images` roda:

- manualmente;
- semanalmente;
- automaticamente após mudanças de deployment na `main`.

Ele copia as imagens de infraestrutura para o namespace GHCR do produto. Os servidores de produção/homologação continuam consumindo exclusivamente o GHCR.

## Packages privados

Um repositório público não garante que todos os packages do GHCR estejam públicos. Se o Docker retornar `denied`, autentique o host:

```bash
export GHCR_USERNAME=wkarts
export GHCR_TOKEN='PAT_COM_READ_PACKAGES'
./registry-login.sh
```

O token de registry não deve ser armazenado no `.env` entregue à API.

## Manager

A imagem da API contém o Manager em `manager/dist`; o deployment normal não precisa publicar uma segunda porta ou subir um container Manager separado para servir `/manager`.
