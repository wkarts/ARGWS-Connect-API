# ARGWS Connect API — Notas de Migração

## Nomenclatura canônica

- produto: `ARGWS Connect API`
- nome curto: `ARGWS Connect`
- package: `argws-connect-api`
- bot: `ConnectBot` / `connectBot`
- IA: `ConnectAI` / `connectAI`
- providers WhatsApp nativos: `WHATSAPP-BAILEYS`, `WHATSAPP-ZAPO`, `WHATSAPP-BUSINESS`
- `CONNECT` deixa de ser provider e é migrado para `WHATSAPP-ZAPO`

## Banco de dados

As migrations específicas de MySQL e PostgreSQL preservam a cadeia histórica. A migração Zapo converte instâncias antigas com `integration=CONNECT` para `WHATSAPP-ZAPO`, fecha a conexão para novo pareamento e remove `Setting.wavoipToken`.

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

## Dependências e runtime do Zapo

Esta revisão adiciona `@innovatorssoft/zapo-js`, `@innovatorssoft/voip`, `@innovatorssoft/store-postgres`, `@roamhq/wrtc` e `libmlow-wasm`, alinha `ws` para `^8.20.1` e remove `socket.io-client`, que era usado apenas pelo bridge WavoIP removido.

O provider `WHATSAPP-ZAPO` persiste o estado criptográfico/protocolo no PostgreSQL da própria Connect|API. Nesta primeira entrega, instâncias Zapo exigem `DATABASE_PROVIDER=postgresql`. O restante da Connect|API continua preservando os providers de banco já existentes.

A imagem da API passa a usar Node 22 sobre Debian Bookworm Slim para suportar o binário Linux glibc do WebRTC utilizado em chamadas reais. Manager e demais imagens podem continuar utilizando suas bases atuais.
