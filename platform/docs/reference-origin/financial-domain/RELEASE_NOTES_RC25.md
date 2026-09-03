# Release Notes — v1.0.0-rc.25

A rc.25 corrige um falso negativo de sessão no WhatsApp gerenciado dos tenants.

## Incidente confirmado em produção

O diagnóstico de produção mostrou simultaneamente:

- `GET /instance/connectionState/argws-fin-demo-62b772ba33` retornando HTTP 200;
- `GET /instance/fetchInstances?instanceName=argws-fin-demo-62b772ba33` retornando HTTP 200;
- Control Plane enviando `POST /message/sendText/argws-fin-demo-62b772ba33` com HTTP 201;
- o fluxo do tenant marcando `EVOLUTION_MANAGED` como `WHATSAPP_NOT_CONNECTED` antes de chamar `sendText`.

## Causa

Algumas respostas da Evolution confirmam `OPEN/CONNECTED` em `connectionState`, mas não retornam `ownerJid`, `number`, `wid` ou `jid` no inventário filtrado. A plataforma usava esses campos como única prova de `session_exists`, fazendo o tenant rejeitar uma conexão que estava efetivamente aberta.

## Correção

`EvolutionWhatsAppProvider.connection_snapshot()` agora considera um estado remoto `OPEN`, `CONNECTED` ou `ONLINE` como evidência suficiente de sessão ativa.

A mudança mantém a detecção de identidade para cenários de reconexão/restart, mas impede que a ausência de metadados do inventário contradiga um estado remoto explicitamente conectado.

## Regressão automatizada

Foi incluído teste específico simulando:

- `connectionState = open`;
- `fetchInstances` sem `ownerJid/number`;
- resultado esperado: `state=CONNECTED`, `session_exists=true`, `instance_exists=true`.

## Versão

`1.0.0-rc.25`
