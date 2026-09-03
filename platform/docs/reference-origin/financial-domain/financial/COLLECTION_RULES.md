# Régua Automática de Cobrança

A régua é executada pelo Celery Beat a cada 15 minutos, respeitando o timezone de cada tenant. O mesmo processamento pode ser disparado manualmente no Tenant Plane em **Comunicações → Executar régua agora**.

## Semântica do offset

O campo `offset_days` representa `data atual - data de vencimento`:

```text
-7  sete dias antes do vencimento
-1  um dia antes do vencimento
 0  no dia do vencimento
 1  um dia após o vencimento
 5  cinco dias após o vencimento
```

A régua padrão provisionada contém eventos D-7, D-1, D0, D+1 e D+5 para e-mail e WhatsApp.

## Resolução da régua

```text
Contrato possui notification_rule_id
  -> usa a régua do contrato
Contrato sem régua específica
  -> usa a régua ativa marcada como padrão
```

Um tenant sempre deve manter uma régua padrão ativa. O sistema impede desativá-la ou retirar essa condição antes que outra régua seja promovida.

## Destinatários

Para cada recebível, o sistema consolida e deduplica:

- e-mail e WhatsApp do cliente;
- contatos do cliente com `receive_billing=true`;
- telefone como fallback do WhatsApp;
- números nacionais com DDD, convertidos para o prefixo `55`.

## Templates

Cada combinação `código + canal` é única. Uma régua só pode ser salva quando todos os templates referenciados existem e estão ativos. Templates utilizados por régua ativa não podem ter código, canal ou status alterados até a régua ser ajustada.

Variáveis disponíveis:

```text
{{ empresa.nome }}
{{ empresa.razao_social }}
{{ empresa.cnpj }}
{{ cliente.nome }}
{{ cliente.razao_social }}
{{ cliente.documento }}
{{ cobranca.documento }}
{{ cobranca.descricao }}
{{ cobranca.competencia }}
{{ cobranca.valor }}
{{ cobranca.saldo }}
{{ cobranca.vencimento }}
{{ cobranca.instrucoes }}
```

A renderização utiliza Jinja em ambiente sandbox com `StrictUndefined`: variáveis inexistentes causam erro explícito em vez de gerar mensagens incompletas.

## Idempotência e concorrência

A chave considera régua, recebível, offset, canal e destino. Chaves longas são compactadas com SHA-256 e a tabela possui `UNIQUE(idempotency_key)`. A inserção utiliza `ON CONFLICT DO NOTHING`, impedindo duplicidade mesmo com workers concorrentes.

## Estados do recebível

Antes de concluir a execução, recebíveis abertos, registrados ou parcialmente pagos com vencimento anterior à data atual e saldo positivo são marcados como `OVERDUE`.

## Filas

```text
Celery Beat
  -> app.tasks.schedule_collection_notifications
  -> financial.notifications
  -> Notification PENDING
  -> app.tasks.dispatch_notifications
  -> SMTP / Evolution API
```
