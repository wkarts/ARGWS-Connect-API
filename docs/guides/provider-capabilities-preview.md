# Provider Capabilities e Preview de Transporte — Fase 5

O Template do Connect|API permanece canônico e independente do provider. A Fase 5 torna explícita a diferença entre **contrato lógico** e **transporte visual**.

## Capabilities

`GET /template/capabilities/{instanceName}` informa como o provider da instância executa cada interação.

- `WHATSAPP-BUSINESS`: templates e botões provider-native.
- `WHATSAPP-BAILEYS`: QUICK_REPLY usa `POLL_COMPAT`; URL, telefone e copiar código usam `TEXT_COMPAT` quando não houver representação confiável no cliente.
- O catálogo de Templates, Actions e Recipes não muda quando o provider muda.

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
