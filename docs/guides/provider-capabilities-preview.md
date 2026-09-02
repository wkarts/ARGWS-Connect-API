# Provider Capabilities e Preview de Transporte — Fase 5

O Template do Connect|API permanece canônico e independente do provider. A Fase 5 torna explícita a diferença entre **contrato lógico** e **transporte visual**.

## Capabilities

`GET /template/capabilities/{instanceName}` informa como o provider da instância executa cada interação.

- `WHATSAPP-BUSINESS`: templates e botões são provider-native e delegados ao provider oficial Meta.
- `WHATSAPP-BAILEYS`: QUICK_REPLY usa `POLL_COMPAT`; URL, telefone, copiar código e combinações não representáveis usam `TEXT_COMPAT`.
- `CONNECT`: templates permanecem locais; botões usam o adaptador `buttonMessage` já existente e listas são declaradas como `UNSUPPORTED`, pois `listMessage` não está disponível no provider atual.
- provider sem capability declarada: nenhuma interação é anunciada como nativa; o planejamento usa `TEXT_COMPAT` conservador para preservar o conteúdo funcional.

O catálogo de Templates, Actions e Recipes não muda quando o provider muda.

## Planner canônico

`src/api/services/template-transport-planner.ts` é a fonte canônica da decisão inicial de transporte. O mesmo planner é consumido por:

- Preview da Fase 5;
- Template Engine no envio real.

Isso evita que o Studio anuncie um transporte diferente daquele planejado pelo runtime.

Falhas operacionais ainda podem exigir fallback durante o envio. Exemplo: um poll Baileys planejado como `POLL_COMPAT` pode cair para `TEXT_COMPAT` se `pollMessage` não estiver disponível ou falhar no provider. Esse fallback é diagnóstico de execução, não uma segunda regra de capability.

## Preview side-effect-free

`POST /template/preview/{instanceName}` recebe um template persistido ou um draft com `components` e `variables`. O endpoint **não envia mensagem, não cria sessão e não executa Action/Recipe**.

A resposta contém:

- provider;
- capabilities;
- conteúdo canônico renderizado;
- transporte planejado (`PROVIDER_NATIVE`, `TEXT`, `INTERACTIVE`, `POLL_COMPAT` ou `TEXT_COMPAT`);
- decisão por botão;
- warnings de degradação.

O Template Studio usa esse contrato para mostrar a aparência funcional esperada antes do envio. Assim um QUICK_REPLY pode continuar sendo um botão lógico `confirm`, ainda que em Baileys seja apresentado ao usuário como opção de um poll.

## Matriz resumida

| Provider | Template provider-native | QUICK_REPLY | URL/PHONE/COPY | Lista |
| --- | --- | --- | --- | --- |
| `WHATSAPP-BUSINESS` | Sim | `NATIVE` | `NATIVE` | `NATIVE` |
| `WHATSAPP-BAILEYS` | Não | `POLL_COMPAT` | `TEXT_COMPAT` | `TEXT_COMPAT` |
| `CONNECT` | Não | `NATIVE` via adapter existente | `NATIVE` via adapter existente | `UNSUPPORTED` |
| não reconhecido | Não | `UNSUPPORTED` | `UNSUPPORTED` | `UNSUPPORTED` |

`UNSUPPORTED` na capability significa que o Connect|API não declara uma representação interativa nativa para aquele provider. Quando possível, o Template Engine ainda preserva o conteúdo por texto em vez de inventar uma capability inexistente.
