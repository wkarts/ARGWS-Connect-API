# Interaction Engine e Template Studio

A Fase 3 conecta templates, respostas interativas, Actions e Recipes sem tornar a UI do Manager parte do contrato de negócio. O **Template Studio v2** permanece uma extensão isolada do Manager operacional/legado e consome somente as APIs canônicas do Connect|API.

## Template Studio

O editor é servido em `/manager/template-editor.html` e permite:

- listar, pesquisar, criar, editar e duplicar templates por instância;
- montar `HEADER`, `BODY`, `FOOTER` e botões;
- usar `QUICK_REPLY`, `URL`, `PHONE_NUMBER` e `COPY_CODE`;
- visualizar variáveis detectadas e aplicar valores de exemplo;
- vincular Quick Replies a Actions ou Recipes;
- criar e administrar **Actions REST** pelo Integration Registry;
- criar e administrar **Recipes** com múltiplos steps;
- executar `dryRun` de Action/Recipe antes de disparar operações reais;
- visualizar preview do WhatsApp;
- enviar um template de teste pela API nativa;
- consultar diagnóstico persistente do envio, incluindo `templateExecution` e fallback;
- editar `actions` e `policy` em JSON quando necessário.

A interface é responsiva: desktop mantém catálogo, editor e preview simultâneos; telas intermediárias movem o preview para uma área inferior; mobile usa uma única coluna. O backend continua sendo a fonte de verdade, portanto uma futura UI pode substituir o Manager sem migrar templates, Actions ou Recipes.

## Envio local e fallback

Templates locais são executados pelo `ConnectTemplateEngine`. Templates sem botões seguem por texto normal. Templates com botões tentam o modo interativo do provider.

O BODY não é mais reutilizado artificialmente como título do botão: quando não existe HEADER, o nome do template funciona apenas como título técnico e o BODY permanece como descrição da mensagem.

Se o provider rejeitar o payload interativo, o Connect|API usa **fallback textual** em vez de perder a mensagem. O retorno da API inclui metadados de diagnóstico:

```json
{
  "templateExecution": {
    "engine": "CONNECT_TEMPLATE_ENGINE",
    "mode": "TEXT_FALLBACK",
    "fallback": true,
    "fallbackReason": "..."
  }
}
```

No fallback, Quick Replies são apresentadas como opções textuais. Respostas como `Confirmar` ou `Cancelar` também são normalizadas pelo Interaction Engine e podem ser resolvidas pelo `matchTitle` do binding.

## Templates padrão

O Studio fornece valores de amostra para os quatro templates de sistema:

- `hello_world`: `{"1":"Wallace"}`;
- `sample_utility`: `{"1":"Wallace","2":"Solicitação #123"}`;
- `sample_marketing`: `{"1":"Wallace","2":"uma condição especial para você"}`;
- `sample_authentication`: `{"1":"123456"}`.

A suíte de compatibilidade valida que todos os quatro renderizam texto e resolvem seus parâmetros posicionais; `sample_utility` também valida seus dois Quick Replies.

## Integration Registry

A aba **Integrações** expõe as APIs nativas já existentes da Fase 2. Uma Action representa uma operação HTTP segura e reutilizável, por exemplo:

```json
{
  "actionKey": "scheduler.appointment.confirm",
  "name": "Confirmar agendamento",
  "method": "POST",
  "baseUrl": "https://scheduler.example.com/api/v1",
  "path": "/check-in/{{input.appointmentId}}/confirm",
  "credentialRef": "SCHEDULER_PRO",
  "confirmation": "CONFIRM",
  "timeoutMs": 10000
}
```

O Studio não aceita segredo embutido no template. Tokens e chaves continuam referenciados por `credentialRef` e submetidos aos controles do Action Engine: validação, timeout, rede privada explícita, proteção SSRF, auditoria e `dryRun`.

Recipes combinam Actions:

```json
{
  "recipeKey": "scheduler.appointment.confirm",
  "name": "Confirmar agendamento",
  "steps": [
    {
      "id": "confirm",
      "action": "scheduler.appointment.confirm",
      "input": {
        "appointmentId": "{{input.appointmentId}}"
      }
    }
  ]
}
```

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

O `id` é o identificador estável do botão. `matchTitle` é fallback de compatibilidade quando o provider devolve somente o título ou quando o template precisou ser enviado como texto.

## Sessão interativa

Quando um template com bindings é enviado, o Connect|API registra uma sessão por mensagem de saída. A sessão guarda instância, mensagem, destinatário, nome/idioma do template, variáveis e bindings congelados no momento do envio.

`policy.interactionTtlSeconds` controla a validade. O padrão é 86400 segundos; a implementação limita o valor entre 60 segundos e 30 dias.

Quando chega uma resposta:

1. Baileys ou Meta Business normaliza botão, lista, native-flow ou resposta textual compatível;
2. o Interaction Engine localiza a sessão pela mensagem respondida ou pela conversa;
3. o binding resolve o input com `session`, `interaction` e `message`;
4. a Action ou Recipe é executada pelo motor seguro da Fase 2;
5. o resultado pode gerar texto ou outro template;
6. a sessão termina, continua aberta ou falha de acordo com o binding.

## Confirmação

- `NONE`: executa normalmente;
- `CONFIRM`: o clique explícito do usuário pode valer como confirmação quando `confirmOnInteraction` não é `false`;
- `STRONG`: nunca é executada automaticamente pelo clique do WhatsApp. A sessão passa para `WAITING_STRONG_CONFIRMATION` até existir fluxo administrativo forte/RBAC/2FA.

Isso permite ações simples como confirmar agenda e preserva proteção para ações críticas como emissão/cancelamento fiscal, bloqueio de veículo ou operações financeiras.

## Providers

A interação é canônica e não pertence ao Meta Compatible:

- Baileys executa templates locais e normaliza respostas nativas/native-flow/textuais;
- WhatsApp Business mantém templates oficiais Meta com overlay local de Actions/Policy/editor;
- API nativa e `/graph` continuam compartilhando o mesmo Template Engine.
