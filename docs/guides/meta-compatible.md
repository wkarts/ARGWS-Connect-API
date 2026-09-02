# Meta Compatible `/graph`

A camada Meta Compatible expõe um contrato HTTP/Webhook semelhante ao WhatsApp Cloud API sem criar um provider paralelo.

## Princípio

```text
API nativa ───────┐
                  ├── mesmo núcleo Connect|API ── mesmo provider ── mesma mensagem
/graph ───────────┘
```

Usar `/graph` e a API nativa em paralelo não duplica uma mensagem por si só. Duas requisições de envio distintas continuam sendo dois envios reais.

## Disponibilidade por instância

A compatibilidade `/graph` é uma capacidade nativa do Connect|API e não precisa ser habilitada por ENV, banco ou toggle no Manager.

Uma instância `WHATSAPP-BUSINESS`, `WHATSAPP-BAILEYS` ou `CONNECT` com identidade telefônica estável fica Graph-addressable automaticamente.

Consulte a identidade e configuração:

```bash
curl 'http://127.0.0.1:38080/compat/meta/minha-instancia' \
  -H 'apikey: <GLOBAL_API_KEY_OU_INSTANCE_TOKEN>'
```

O endpoint administrativo continua existindo para compatibilidade e para configurar apenas o webhook Meta opcional:

```bash
curl -X PUT 'http://127.0.0.1:38080/compat/meta/minha-instancia' \
  -H 'apikey: <GLOBAL_API_KEY_OU_INSTANCE_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "webhookUrl": "https://example.com/webhooks/meta"
  }'
```

O campo `enabled` pode continuar aparecendo em respostas legadas, mas é sempre `true` e não controla mais o acesso ao `/graph`.

## Autenticação Graph

```http
Authorization: Bearer <INSTANCE_TOKEN>
```

A autenticação `/graph` é independente da autenticação nativa `apikey`.

## Enviar texto

```bash
curl -X POST 'http://127.0.0.1:38080/graph/v20.0/<phoneNumberId>/messages' \
  -H 'Authorization: Bearer <INSTANCE_TOKEN>' \
  -H 'Content-Type: application/json' \
  -d '{
    "messaging_product": "whatsapp",
    "recipient_type": "individual",
    "to": "5575999999999",
    "type": "text",
    "text": {"body": "Olá pelo /graph"}
  }'
```

O `messages[0].id` retornado é o ID real do provider. Não existe prefixo `wamid` artificial.

## Formatos suportados

A fachada atual cobre:

```text
text
image
video
document
audio
location
contacts
reaction
interactive button
interactive list
mark-read
```

## Mídia

Upload:

```text
POST /graph/{version}/{phoneNumberId}/media
```

O upload reutiliza S3/MinIO existente e referência temporária. Não cria armazenamento binário permanente independente.

Mídia recebida:

```text
GET /graph/{version}/{mediaId}
```

O `mediaId` corresponde ao ID real da mensagem/provider usado na correlação. A resolução usa metadata existente e devolve URL segura/presigned quando disponível.

## Templates

```text
GET /graph/{version}/{businessAccountId}/message_templates
```

- `WHATSAPP-BUSINESS`: delega ao serviço real de templates;
- `WHATSAPP-BAILEYS`: lista vazia (`data: []`);
- `CONNECT`: depende da capacidade real disponível.

## Webhooks

O webhook Meta Compatible é adicional ao webhook nativo. O mesmo evento interno pode ser entregue em ambos os formatos sem criar uma segunda mensagem interna.

Se um consumidor assinar os dois contratos ao mesmo tempo, deve correlacionar/deduplicar pelo ID real da mensagem quando aplicável.

## Status

Mapeamento atual:

```text
SERVER_ACK    → sent
DELIVERY_ACK  → delivered
READ          → read
PLAYED        → read
ERROR         → failed
DELETED       → deleted
PENDING       → não antecipar status sent
```
