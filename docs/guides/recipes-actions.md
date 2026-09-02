# Recipes e Actions

O Connect|API trata `Template`, `Recipe` e `Action` como recursos diferentes e complementares da instância.

```text
Template -> apresentação/interação
Recipe   -> orquestração de uma ou mais etapas
Action   -> operação registrada contra uma integração
```

## Action Registry

Uma Action é cadastrada por `actionKey` e pertence à instância. Ela define método HTTP, `baseUrl`, caminho relativo, timeout, política de confirmação e um `credentialRef` opcional.

Credenciais não ficam no template, na receita ou no registro da Action. O `credentialRef` aponta para uma variável de ambiente no processo da API:

```text
ARGWS_ACTION_CREDENTIAL_<REF>
```

O valor é JSON e pode fornecer `bearer`, `basic` ou `headers`.

Exemplo de definição sem segredo:

```json
{
  "actionKey": "scheduler.appointment.confirm",
  "name": "Confirmar agendamento",
  "method": "POST",
  "baseUrl": "https://scheduler.example.com/api/",
  "path": "appointments/{{input.appointmentId}}/confirm",
  "credentialRef": "SCHEDULER_PRO",
  "confirmation": "CONFIRM",
  "timeoutMs": 10000
}
```

Por padrão o engine bloqueia loopback e redes privadas. Integrações locais exigem `allowPrivateNetwork: true` de forma explícita. Redirecionamentos HTTP são desabilitados.

## Recipe

Uma Recipe orquestra Actions sequencialmente e pode usar dados de entrada ou resultados de etapas anteriores.

```json
{
  "recipeKey": "scheduler.confirm",
  "name": "Confirmar agenda",
  "steps": [
    {
      "id": "confirm",
      "action": "scheduler.appointment.confirm",
      "input": {
        "appointmentId": "{{input.appointmentId}}"
      }
    }
  ],
  "outputTemplate": {
    "appointmentId": "{{steps.confirm.result.data.id}}",
    "status": "{{steps.confirm.result.data.status}}"
  }
}
```

Uma expressão que ocupa o valor inteiro, como `{{steps.lookup.result.data.total}}`, preserva o tipo original. Expressões dentro de texto são convertidas para string.

## Endpoints nativos

```text
POST   /action/create/{instanceName}
GET    /action/find/{instanceName}
POST   /action/execute/{instanceName}
DELETE /action/delete/{instanceName}

POST   /recipe/create/{instanceName}
GET    /recipe/find/{instanceName}
POST   /recipe/execute/{instanceName}
DELETE /recipe/delete/{instanceName}
```

`dryRun: true` resolve o plano de execução sem efetuar a chamada HTTP. `confirmation` pode ser `NONE`, `CONFIRM` ou `STRONG`; nesta fase `CONFIRM` e `STRONG` exigem `confirmed: true`, e a diferenciação de autenticação forte será expandida na fase de RBAC/2FA.

## Auditoria

Cada Action executada grava apenas metadados operacionais: chave da ação, URL efetiva, método, status HTTP, duração e erro técnico. Credenciais e headers resolvidos não são persistidos no log de execução.

## Próximas integrações

Essa fundação permite receitas para Scheduler Pro, ERP/fiscal, financeiro, tracking/frota, CRM, help desk, Typebot e n8n. O domínio de negócio permanece no sistema responsável; o Connect|API orquestra e apresenta a interação.
