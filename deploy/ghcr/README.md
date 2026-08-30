# GHCR — ARGWS Connect API

O GHCR é o registry oficial do produto. Produção e homologação não fazem pull direto de Docker Hub, Quay ou outro registry.

## Imagens da stack

Core:

```text
ghcr.io/wkarts/argws-connect-api
ghcr.io/wkarts/argws-connect-postgres
ghcr.io/wkarts/argws-connect-redis
ghcr.io/wkarts/argws-connect-rabbitmq
ghcr.io/wkarts/argws-connect-minio
```

Opcionais:

```text
ghcr.io/wkarts/argws-connect-mysql
ghcr.io/wkarts/argws-connect-nats
ghcr.io/wkarts/argws-connect-kafka
ghcr.io/wkarts/argws-connect-zookeeper
```

## Sincronização

`GHCR - Sync Infrastructure Images` roda:

- manualmente;
- semanalmente;
- automaticamente após mudanças de deployment na `main`.

Ele copia as imagens upstream para o namespace GHCR do produto. Os servidores de produção continuam consumindo exclusivamente o GHCR.

## Packages privados

Um repositório público não garante que todos os packages do GHCR estejam públicos. Se o Docker retornar `denied`, autentique o host:

```bash
export GHCR_USERNAME=wkarts
export GHCR_TOKEN='PAT_COM_READ_PACKAGES'
./registry-login.sh
```

O token de registry não deve ser armazenado no `.env` entregue à API.

## Aplicação

A imagem da API já contém o Manager em `manager/dist`; o deployment normal não precisa puxar `argws-connect-manager` para servir `/manager`. A imagem separada do Manager pode continuar sendo publicada para usos futuros, mas não faz parte da stack canônica atual.
