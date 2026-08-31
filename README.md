<p align="center">
  <img src="./branding/ARGWS-Connect-API-Branding/github/readme-header.png" alt="Connect|API" />
</p>

# Connect|API

**Communication & Integration Platform**

Connect|API é a API de comunicação e integração multicanal da linha de produtos ARGWS. A identidade pública passa a usar **Connect|API** / **🅲🅾🅽🅽🅴🅲🆃​|🅰🅿🅸**, preservando os identificadores técnicos existentes do projeto para compatibilidade operacional.

## Princípios desta linha

- preservar módulos funcionais e integrações existentes;
- evitar refatorações amplas ou desnecessárias;
- usar `Connect|API` como nome público do produto;
- preservar nomes técnicos já estabelecidos, como pacote, repositório, banco, imagens e namespaces `argws-connect-*`;
- manter ConnectBot e ConnectAI como integrações próprias;
- manter a telemetria ARGWS LICENSYS best-effort;
- manter métricas Prometheus locais disponíveis;
- preservar dependências e histórico de migrations enquanto cada mudança não exigir revisão específica.

## Principais integrações

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
- PostgreSQL e MySQL.

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

As imagens oficiais da aplicação são publicadas no GitHub Container Registry do projeto.

## Manager

O Manager faz parte do produto e sua distribuição compilada está em:

```text
manager/dist/
```

O pacote de branding permanece no caminho técnico existente:

```text
branding/ARGWS-Connect-API-Branding/
```

## Identidade pública e nomes técnicos

| Finalidade | Nome |
|---|---|
| produto/API — nome público | `Connect|API` / `🅲🅾🅽🅽🅴🅲🆃​|🅰🅿🅸` |
| bot integration | `ConnectBot` / `connectBot` |
| AI integration | `ConnectAI` / `connectAI` |
| channel integration | `Connect` / `CONNECT` |
| package técnico | `argws-connect-api` |
| Docker/network namespace | `argws-connect-*` |
| repositório | `wkarts/ARGWS-Connect-API` |

A alteração da identidade pública **não renomeia banco de dados, services Docker, containers, redes, volumes, imagens GHCR ou demais identificadores técnicos existentes**.

## ARGWS telemetry

A telemetria é best-effort e nunca bloqueia a execução da API.

Modos suportados:

- `agent`: envia eventos ao ARGWS LICENSYS Agent local;
- `direct`: envia eventos diretamente ao endpoint de telemetria ARGWS LICENSYS usando activation token.

Exemplo:

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

## Metrics

Prometheus metrics permanecem locais/pull-based e são controladas independentemente:

```env
PROMETHEUS_METRICS=false
METRICS_AUTH_REQUIRED=true
METRICS_USER=prometheus
METRICS_PASSWORD=
METRICS_ALLOWED_IPS=127.0.0.1
```

## Database migration compatibility

O histórico de migrations permanece preservado para compatibilidade do banco atual do projeto.

## Dependency policy

Nenhuma dependência da aplicação deve ser removida sem revisão específica. Consulte `DEPENDENCY-AUDIT.md` para a matriz maintain/migrate/review.

## Branding

A identidade visual pública passa a ser **Connect|API**, mantendo os paths técnicos atuais até que os assets visuais sejam atualizados de forma controlada.

Repository target: `https://github.com/wkarts/ARGWS-Connect-API`

## Deploy oficial: GHCR, CloudPanel e Dockge

Connect|API utiliza o **GitHub Container Registry (GHCR)** como registry oficial. Produção/homologação não precisam compilar o projeto no servidor.

Imagens principais:

- `ghcr.io/wkarts/argws-connect-api`
- `ghcr.io/wkarts/argws-connect-manager`

As imagens de infraestrutura permanecem sob o namespace técnico `ghcr.io/wkarts/argws-connect-*`.

Deployments prontos permanecem nos diretórios técnicos existentes em `deploy/`.

Consulte `deploy/README.md` para os detalhes.

## Versionamento e releases automáticos

A linha canônica do produto iniciou em `1.0.0` e continua usando SemVer.

Cada merge bem-sucedido em `main` executa validação, calcula a próxima versão SemVer, publica as imagens API/Manager no GHCR e somente depois cria a tag e a GitHub Release. O incremento padrão é `patch`; labels `version:minor` e `version:major` permitem promover a próxima versão sem edição manual de arquivos.

Consulte [`RELEASE-AUTOMATION.md`](RELEASE-AUTOMATION.md) para o fluxo completo.
