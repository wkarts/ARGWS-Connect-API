# Interaction Engine e Template Studio

A Fase 3 conecta templates, respostas interativas, Actions e Recipes sem tornar a UI do Manager parte do contrato de negócio.

## Template Studio no Manager legado

O Manager empacotado atual permanece como console operacional legado. O editor é uma extensão isolada e removível em `/manager/template-editor.html`, sem alteração do bundle minificado principal.

O editor permite:

- listar e pesquisar templates da instância;
- criar, editar e duplicar templates;
- montar `HEADER`, `BODY`, `FOOTER` e botões;
- usar `QUICK_REPLY`, `URL`, `PHONE_NUMBER` e `COPY_CODE`;
- vincular Quick Replies a Actions ou Recipes;
- editar `actions` e `policy` em modo visual ou JSON;
- visualizar preview do WhatsApp;
- enviar um template de teste pela API nativa.

O backend continua sendo a fonte de verdade. Uma futura UI pode substituir o Manager sem migrar os templates.

## Bindings de interação

`Template.actions` pode conter `bindings`:

```json
{
  "bindings": [
    {
      "id": "confirm",
      "matchTitle": "Confirmar",
      "type": "RECIPE",
      "key": "scheduler.appointment.confirm",
      "confirmOnInteraction": true,
      "input": {
        "appointmentId": "{{session.variables.appointmentId}}"
      },
      "response": {
        "type": "TEXT",
        "text": "✅ Agendamento confirmado."
      },
      "onError": {
        "type": "TEXT",
        "text": "Não foi possível confirmar agora."
      },
      "keepSessionOpen": false
    }
  ]
}
```

O `id` é o identificador estável do botão. `matchTitle` é fallback de compatibilidade quando um provider devolve somente o título.

## Sessão interativa

Quando um template com bindings é enviado, o Connect|API registra uma sessão por mensagem de saída. A sessão guarda apenas metadados necessários à correlação: instância, mensagem, destinatário, nome/idioma do template, variáveis e bindings.

`policy.interactionTtlSeconds` controla a validade. O padrão é 86400 segundos; a implementação limita o valor entre 60 segundos e 30 dias.

Quando chega uma resposta:

1. Baileys ou Meta Business normaliza a interação em `{ type, id, title, contextMessageId }`;
2. o Interaction Engine localiza a sessão pela mensagem respondida ou, como fallback, pela conversa;
3. o binding resolve o input com `session`, `interaction` e `message`;
4. a Action ou Recipe é executada pelo motor seguro da Fase 2;
5. o resultado pode gerar texto ou outro template;
6. a sessão termina, continua aberta ou falha de acordo com o binding.

## Confirmação

- `NONE`: executa normalmente;
- `CONFIRM`: o clique explícito do usuário pode valer como confirmação quando `confirmOnInteraction` não é `false`;
- `STRONG`: nunca é executada automaticamente pelo clique do WhatsApp. A sessão passa para `WAITING_STRONG_CONFIRMATION` até existir fluxo administrativo forte/RBAC/2FA.

Isso permite ações simples como confirmar agenda e preserva proteção para ações críticas como emissão/cancelamento fiscal, bloqueio de veículo ou operações financeiras.

## Segurança

Templates e Recipes não armazenam credenciais. Integrações usam `credentialRef` nas Actions. O Interaction Engine reaproveita os controles de rede, timeout, validação, auditoria e SSRF do Action Engine.

## Providers

A interação é canônica e não pertence ao Meta Compatible:

- Baileys normaliza respostas nativas e native-flow;
- WhatsApp Business normaliza `interactive` e `button` do webhook Meta;
- API nativa e `/graph` continuam compartilhando o mesmo Template Engine.
