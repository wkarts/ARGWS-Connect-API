# Conversational Platform — Fase 4

A Fase 4 adiciona três capacidades incrementais ao Connect|API sem alterar o comportamento da API nativa existente.

## Meta Policy Engine

O Meta Compatible continua sempre disponível. A política é aplicada apenas às chamadas de envio via `/graph`, enquanto mensagens recebidas alimentam a janela de atendimento independentemente do provider.

- `PERMISSIVE` (padrão): não bloqueia integrações existentes; registra violações fora da janela.
- `OBSERVE`: calcula exatamente o que seria bloqueado em modo estrito e registra `WOULD_BLOCK_OUTSIDE_WINDOW`, sem impedir o envio.
- `STRICT`: para providers simulados, exige template para reengajamento fora da janela configurada.
- `WHATSAPP-BUSINESS`: a Meta oficial continua soberana; a decisão local é `DELEGATED_TO_META`.

A duração padrão é 86400 segundos (24h). A configuração fica em `MetaCompatibility`, não desabilita a fachada e pode ser inspecionada por destinatário.

## Strong Confirmation

Actions e Recipes `STRONG` nunca são executadas por um simples clique no WhatsApp. O Interaction Engine cria uma pendência e preserva o input resolvido. A aprovação/rejeição administrativa exige a API key global e é atômica para impedir execução dupla.

Rotas:

- `GET /interaction/strong/pending/{instanceName}`
- `POST /interaction/strong/approve/{instanceName}`
- `POST /interaction/strong/reject/{instanceName}`

A aprovação executa a Action/Recipe com `confirmed=true`; falhas terminam em `FAILED` para evitar repetição ambígua de efeitos críticos.

## Pacotes oficiais de Recipes

`GET /recipe/library/{instanceName}` lista pacotes disponíveis. `POST /recipe/install/{instanceName}` instala Actions, Recipes e templates em uma instância usando uma Base URL e `credentialRef`, sem persistir segredos no catálogo.

O primeiro pacote é `scheduler-pro` e inclui consulta, confirmação, cancelamento e reagendamento de agendamentos, além do template `scheduler_appointment_confirmation`.

## Template Studio v2

A aba Integrações expõe controles para a política Meta, instalação de pacotes oficiais e fila de Strong Confirmation. A interface é cliente do contrato HTTP; toda regra permanece no backend e pode ser reutilizada por um frontend futuro.


## Compatibilidade de interação por provider

O Connect|API mantém o contrato lógico de Template/Interaction independente do provider, mas escolhe o transporte visual conforme a capacidade real do canal.

- `WHATSAPP-BUSINESS`: templates e botões continuam provider-native, sob as regras oficiais da Meta.
- `WHATSAPP-BAILEYS`: quick replies são emitidos como poll de escolha única (`POLL_COMPAT`) no Baileys oficial, evitando `nativeFlowMessage` que pode receber ACK e ainda ser descartado pelos clientes WhatsApp.
- Botões URL, telefone e copiar no Baileys usam `TEXT_COMPAT`, preservando texto, URL, número ou código como conteúdo utilizável.
- O `Interaction Engine` converte a seleção do poll para `poll_reply` e associa o texto exibido ao mesmo binding lógico do botão original.

Assim, a Recipe/Action ligada a `confirm`, `cancel` etc. continua independente de Meta ou Baileys, sem enviar mensagens interativas incompatíveis ao cliente.
