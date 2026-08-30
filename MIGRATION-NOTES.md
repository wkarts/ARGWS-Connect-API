# ARGWS Connect API — Notas de Migração

## Nomenclatura canônica

- produto: `ARGWS Connect API`
- nome curto: `ARGWS Connect`
- package: `argws-connect-api`
- bot: `ConnectBot` / `connectBot`
- IA: `ConnectAI` / `connectAI`
- canal interno: `Connect`
- enum de integração: `CONNECT`

## Banco de dados

Foram adicionadas migrations específicas para MySQL e PostgreSQL que preservam a cadeia histórica e renomeiam as estruturas persistidas para a nomenclatura ARGWS Connect.

Não altere migrations históricas já aplicadas.

Antes de atualizar produção:

1. faça backup completo;
2. teste a migration em clone do banco;
3. execute `npm run db:generate`;
4. execute `npm run db:deploy` usando o provider correto;
5. valide `ConnectBot`, `ConnectAI`, criação de instância, QR Code, envio/recebimento e webhooks.

## Rotas renomeadas

Os contratos públicos referentes aos módulos renomeados passam a usar os nomes ARGWS Connect, incluindo `connectBot` e `connectAI`.

Integrações clientes que consumiam diretamente as rotas antigas precisam ser atualizadas em conjunto.

## Telemetria ARGWS

Variáveis principais:

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

Em modo `direct`, configure a URL completa do endpoint `/api/v1/telemetry/batch` e o activation token correspondente.

## Dependências

Nenhuma dependência foi removida ou atualizada nesta revisão. Consulte `DEPENDENCY-AUDIT.md` antes de qualquer limpeza futura.
