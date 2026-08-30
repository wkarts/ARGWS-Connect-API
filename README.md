<p align="center">
  <img src="./branding/ARGWS-Connect-API-Branding/github/readme-header.png" alt="ARGWS Connect API" />
</p>

# ARGWS Connect API

**Communication & Integration Platform**

ARGWS Connect API is a multi-channel communication and integration API based on the existing functional codebase, preserving the established runtime architecture while adopting the ARGWS identity, ConnectBot, ConnectAI and ARGWS telemetry.

## Principles of this revision

- preserve existing functional modules and integrations;
- avoid broad or unnecessary refactoring;
- replace product naming and first-party identifiers with ARGWS Connect API naming;
- replace the previous outbound telemetry transport with ARGWS LICENSYS telemetry;
- keep local Prometheus metrics available;
- keep dependencies in place until the dependency audit is reviewed;
- preserve immutable database migration history and legal notices required for upgrade compatibility and attribution.

## Main integrations

- WhatsApp Web / Baileys;
- WhatsApp Business / Cloud API;
- Connect channel;
- ConnectBot;
- ConnectAI;
- Chatwoot;
- Typebot;
- OpenAI;
- Dify;
- Flowise;
- N8N;
- RabbitMQ;
- NATS;
- Kafka;
- Amazon SQS;
- WebSocket / Socket.IO;
- S3 / MinIO;
- Redis;
- PostgreSQL and MySQL.

## Quick start

```bash
cp .env.example .env
npm ci
npm run db:generate
npm run db:deploy
npm run build
npm run start:prod
```

Development:

```bash
npm run dev:server
```

## Docker

Local build:

```bash
docker compose build
docker compose up -d
```

The default images are intentionally local/self-owned. CI publishes the API image to the current repository's GitHub Container Registry.

## Manager

The bundled Manager remains part of the project. Its built distribution is under:

```text
manager/dist/
```

The canonical ARGWS branding package is included under:

```text
branding/ARGWS-Connect-API-Branding/
```

## Canonical naming

| Previous runtime name | ARGWS Connect name |
|---|---|
| product/API name | `ARGWS Connect API` |
| bot integration | `ConnectBot` / `connectBot` |
| AI integration | `ConnectAI` / `connectAI` |
| channel integration | `Connect` / `CONNECT` |
| package | `argws-connect-api` |
| Docker/network namespace | `argws-connect-*` |

## ARGWS telemetry

The prior telemetry transport is not used. Telemetry is best-effort and never blocks API execution.

Supported modes:

- `agent`: sends events to the local ARGWS LICENSYS Agent;
- `direct`: sends events directly to the ARGWS LICENSYS telemetry batch endpoint using an activation token.

Example:

```env
ARGWS_CONNECT_TELEMETRY_ENABLED=false
ARGWS_CONNECT_TELEMETRY_MODE=agent
ARGWS_CONNECT_TELEMETRY_URL=http://127.0.0.1:47831/v1/telemetry
ARGWS_CONNECT_TELEMETRY_AGENT_TOKEN=
ARGWS_CONNECT_TELEMETRY_ACTIVATION_TOKEN=
ARGWS_CONNECT_TELEMETRY_SCHEMA=argws.connect.api.route
ARGWS_CONNECT_TELEMETRY_SCHEMA_VERSION=1
ARGWS_CONNECT_TELEMETRY_TIMEOUT_MS=3000
```

No ARGWS LICENSYS license enforcement was added to the API by this change. The integration in this revision is limited to telemetry transport.

## Metrics

Prometheus metrics remain local/pull-based and are controlled independently:

```env
PROMETHEUS_METRICS=false
METRICS_AUTH_REQUIRED=true
METRICS_USER=prometheus
METRICS_PASSWORD=
METRICS_ALLOWED_IPS=127.0.0.1
```

## Database migration compatibility

Existing migration history is preserved. New migration `20260830010000_argws_connect_rename` renames current database objects and integration values to the ARGWS Connect naming without rewriting already-applied historical migration files.

## Dependency policy

No application dependency is removed in this revision. See `DEPENDENCY-AUDIT.md` for the maintain/migrate/review matrix.

## Branding

The complete canonical package is included and copied into runtime assets where needed. PNG/SVG/favicon/PWA assets are sourced from the same approved package rather than recreated independently.

Repository target: `https://github.com/wkarts/argws-connect-api`


## Deploy oficial: GHCR, CloudPanel e Dockge

O ARGWS Connect API utiliza o **GitHub Container Registry (GHCR)** como registry oficial. Produção/homologação não precisam compilar o projeto no servidor.

Imagens principais:

- `ghcr.io/wkarts/argws-connect-api`
- `ghcr.io/wkarts/argws-connect-manager`

As imagens de PostgreSQL, Redis, RabbitMQ, MinIO, MySQL/Percona, Kafka, Zookeeper, pgAdmin e as bases Node/Nginx também são disponibilizadas sob o prefixo `ghcr.io/wkarts/argws-connect-*`.

Deployments prontos:

- `deploy/cloudpanel/docker-compose.yml`
- `deploy/cloudpanel/.env.example`
- `deploy/dockge/compose.yaml`
- `deploy/dockge/.env.example`
- `.github/workflows/ghcr-sync-infrastructure.yml`
- `.github/workflows/ghcr-publish-application.yml`

Consulte `deploy/README.md` para os detalhes.
