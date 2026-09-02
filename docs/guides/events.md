# Eventos

O Connect|API possui um catálogo central de eventos e múltiplos transportes externos.

## Transportes

Conforme configuração e disponibilidade:

```text
Webhook
WebSocket
RabbitMQ
NATS
SQS
Pusher
Kafka
```

## Catálogo

O arquivo AsyncAPI é gerado diretamente do enum `Events` em `src/api/types/wa.types.ts`.

Exemplos de eventos:

```text
instance.create
instance.delete
qrcode.updated
connection.update
messages.set
messages.upsert
messages.update
messages.delete
contacts.upsert
presence.update
chats.upsert
groups.update
group-participants.update
call
labels.edit
messaging-history.set
remove.instance
logout.instance
```

## Regra de manutenção

Adicionar ou remover um valor do enum `Events` sem regenerar a documentação causa falha em `npm run docs:check` e no workflow `Docs Integrity`.

## Meta Compatible webhook

A entrega Meta Compatible é adicional ao webhook nativo. Um único evento interno pode ser serializado em dois formatos externos sem criar uma segunda mensagem interna.

Se o mesmo consumidor assinar os dois formatos, deve correlacionar pelo ID real da mensagem/evento quando aplicável.
