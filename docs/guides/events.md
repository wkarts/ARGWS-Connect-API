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

## Recibos de mensagem

Os providers são normalizados para o vocabulário de status já utilizado pelo Connect|API. Para Zapo, o status nativo `receipt` representa confirmação de entrega e é publicado como `DELIVERY_ACK`. O status `READ` só é publicado quando o provider efetivamente informa leitura; a API não fabrica uma confirmação intermediária quando recebe apenas leitura.

A progressão esperada para mensagens enviadas é:

```text
SERVER_ACK -> DELIVERY_ACK -> READ -> PLAYED
```

Nem todos os providers ou tipos de mensagem emitem todas as etapas. Estados ausentes não são sintetizados.

## Evento `call`

O payload legado do evento `call` permanece compatível: `action`, `provider`, `call.state`, `call.stateData`, identidade e demais campos existentes não são removidos nem renomeados.

Além dos campos brutos do provider, `call.status` expõe o estado canônico que consumidores como o HUB devem utilizar:

```text
ringing
answered
rejected
missed
unanswered
ended
failed
answered_elsewhere
unknown
```

Campos complementares:

- `call.providerState`: estado bruto informado pelo provider;
- `call.providerReason`: motivo bruto de encerramento, quando disponível;
- `call.terminal`: `true` quando o estado canônico encerra o ciclo da chamada.

Regras relevantes:

- `CALLING`, `OFFER_RECEIVED` e `PRE_ACCEPT_RECEIVED` são normalizados para `ringing`;
- `ACCEPT_RECEIVED` e `CONNECTED` são normalizados para `answered`;
- `TIMEOUT` gera `missed` para chamada recebida e `unanswered` para chamada efetuada;
- rejeição explícita gera `rejected`;
- falhas de rede, mídia ou sinalização geram `failed`;
- `answered_elsewhere` só é emitido quando o provider informar explicitamente que a chamada foi atendida em outro dispositivo;
- o `callId` continua sendo a chave de correlação do ciclo da chamada.

Consumidores devem usar `call.status` para a lógica de negócio e manter `providerState`/`providerReason` apenas para diagnóstico e compatibilidade.

## Regra de manutenção

Adicionar ou remover um valor do enum `Events` sem regenerar a documentação causa falha em `npm run docs:check` e no workflow `Docs Integrity`.

## Meta Compatible webhook

A entrega Meta Compatible é adicional ao webhook nativo. Um único evento interno pode ser serializado em dois formatos externos sem criar uma segunda mensagem interna.

Se o mesmo consumidor assinar os dois formatos, deve correlacionar pelo ID real da mensagem/evento quando aplicável.
