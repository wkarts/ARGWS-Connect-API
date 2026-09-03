# Integração SMTP e Evolution API

## Hierarquia de configuração

```text
Empresa > Tenant > Plataforma
```

Uma empresa pode usar remetente e instância próprios. Quando não houver configuração específica, o sistema usa o tenant e depois o fallback da plataforma.

Segredos são criptografados antes de persistir.

## SMTP da plataforma

```text
SMTP_ENABLED=true
SMTP_HOST=smtp.exemplo.com.br
SMTP_PORT=587
SMTP_USERNAME=financeiro@exemplo.com.br
SMTP_PASSWORD=...
SMTP_SECURITY=starttls
SMTP_FROM_EMAIL=financeiro@exemplo.com.br
SMTP_FROM_NAME=Financeiro
```

Modos aceitos:

```text
starttls
ssl
none
```

## SMTP por tenant/empresa

No Tenant Plane:

```text
Integrações -> SMTP -> Configurar
```

Informe host, porta, usuário, senha, segurança e remetente. Use o botão de teste antes de ativar a régua de cobrança.

## Evolution API

Configuração padrão:

```text
EVOLUTION_ENABLED=true
EVOLUTION_BASE_URL=https://evolution.exemplo.com.br
EVOLUTION_API_KEY=...
EVOLUTION_INSTANCE=connect-api-platform
EVOLUTION_SEND_TEXT_PATH=/message/sendText/{instance}
EVOLUTION_SEND_MEDIA_PATH=/message/sendMedia/{instance}
EVOLUTION_WEBHOOK_SECRET=...
```

A plataforma suporta configuração independente por empresa, permitindo que cada CNPJ utilize uma instância Evolution própria.

## Webhook Evolution

Endpoint no domínio do tenant:

```text
POST https://<slug>.connect.exemplo.com.br/api/v1/webhooks/evolution
POST https://financeiro.cliente.com.br/api/v1/webhooks/evolution
```

O host central da API não deve ser usado nesse callback, pois o hostname determina o banco isolado do tenant.

O provedor deve enviar o segredo esperado. Eventos repetidos são deduplicados por identificador externo/hash.

Status armazenados:

```text
QUEUED
SENT
DELIVERED
READ
FAILED
```


## Régua de cobrança

O Celery Beat avalia as réguas a cada 15 minutos no timezone do tenant. A interface permite editar eventos e templates, executar a régua manualmente e acompanhar tentativas, erros, entrega e leitura. Consulte `docs/financial/COLLECTION_RULES.md`.

## Fluxo de envio

```text
Evento financeiro
 -> Outbox
 -> RabbitMQ
 -> worker de notificações
 -> template
 -> SMTP/Evolution
 -> external_message_id
 -> webhook de entrega/leitura
 -> auditoria
```

## Conteúdos

- texto;
- link;
- linha digitável;
- PIX copia e cola;
- boleto PDF;
- recibo PDF;
- documento fiscal PDF/XML.

## Operação segura

- não registrar API key em log;
- configurar timeout;
- usar retry com backoff;
- não reenviar evento já entregue;
- validar telefone em E.164;
- respeitar consentimento e regras aplicáveis a mensagens comerciais;
- manter templates transacionais claros.
