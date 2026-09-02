# Mensagens e mídia

## Envio nativo

A família `/message` cobre os formatos expostos pelo código atual:

```text
sendText
sendMedia
sendPtv
sendWhatsAppAudio
sendStatus
sendSticker
sendLocation
sendContact
sendReaction
sendPoll
sendList
sendButtons
sendTemplate
```

Todos os endpoints são escopados por `instanceName`.

## Compatibilidade de payload

O middleware de compatibilidade normaliza payloads antes da validação atual. Para novas integrações, prefira os campos documentados no Scalar e mantenha compatibilidade com os contratos existentes.

## Mídia

`sendMedia`, `sendPtv`, `sendWhatsAppAudio`, `sendStatus` e `sendSticker` aceitam upload `multipart/form-data` quando o endpoint utiliza `multer`.

A política do projeto não deve criar um segundo armazenamento binário permanente apenas para compatibilidade. S3/MinIO continuam sendo a infraestrutura de mídia do núcleo.

## IDs

Nunca invente IDs externos para mensagens. Na camada Meta Compatible o ID retornado precisa continuar sendo o ID real do provider.

## Leitura e status

Operações de chat permitem marcar mensagens como lidas e consultar updates persistidos. Os estados internos relevantes incluem:

```text
ERROR
PENDING
SERVER_ACK
DELIVERY_ACK
READ
DELETED
PLAYED
```
