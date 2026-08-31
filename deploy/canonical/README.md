# ARGWS Connect API — Canonical Production

O deployment **Canonical** não é um terceiro ambiente. Ele é a mesma stack de produção, usando a mesma porta, domínio, rede, volumes, banco, Redis, RabbitMQ e MinIO, mas com a imagem da API fixada em uma release SemVer estável.

## Diferença para Production

```text
Production  -> ghcr.io/wkarts/argws-connect-api:latest
Canonical   -> ghcr.io/wkarts/argws-connect-api:X.Y.Z
Homologação -> ghcr.io/wkarts/argws-connect-api:develop
```

Production e Canonical usam ambos:

```text
COMPOSE_PROJECT_NAME=argws-connect-production
ARGWS_CONNECT_NETWORK_NAME=argws-connect-production-net
ARGWS_CONNECT_API_HOST_PORT=38080
SERVER_URL=https://api.connect.argws.com.br
```

Portanto **não existe porta canonical separada**. Rodar o canonical atualiza a mesma stack de produção para a versão estável escolhida.

## Versão estável

Por padrão, `deploy.sh` lê `../../VERSION`. Na linha estável atual isso resolve para `1.0.6`.

Para forçar outra release aprovada, edite somente:

```env
ARGWS_CONNECT_CANONICAL_VERSION=1.0.6
```

em `env.example`.

## Uso

Primeiro prepare a configuração real de produção normalmente em `../production/.env`. Depois:

```bash
bash deploy.sh
```

O script combina:

```text
../production/compose.yaml
+
./compose.yaml
```

O overlay canonical altera exclusivamente `services.api.image`. Nenhuma porta, rede, volume ou service é redefinido.
