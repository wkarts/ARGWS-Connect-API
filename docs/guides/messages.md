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

### READ x PLAYED

`POST /chat/markMessageAsRead/:instanceName` continua representando leitura normal da mensagem e mantém o contrato existente.

Áudios/voice notes possuem uma confirmação distinta no protocolo WhatsApp. A reprodução efetiva pode ser informada explicitamente por:

```http
POST /chat/markMessageAsPlayed/:instanceName
```

Exemplo individual:

```json
{
  "playedMessages": [
    {
      "id": "3EB0123456789ABCDEF",
      "fromMe": false,
      "remoteJid": "5575988881111@s.whatsapp.net"
    }
  ]
}
```

Em grupos, `remoteJid` permanece o JID `@g.us` e `participant` pode ser enviado para preservar o autor:

```json
{
  "playedMessages": [
    {
      "id": "3EB0123456789ABCDEF",
      "fromMe": false,
      "remoteJid": "120363XXXXXXXX@g.us",
      "participant": "5575988881111@s.whatsapp.net"
    }
  ]
}
```

A API envia o receipt nativo `played` no Baileys e no ZAPO. `fromMe=true` é rejeitado: este endpoint representa a reprodução, pela instância, de uma mensagem recebida.

Download de mídia, abertura de conversa, `findMessages`, sincronização de histórico e recuperação de mídia **não** geram `PLAYED`. O consumidor deve chamar o endpoint somente no evento real de reprodução do player.

A repetição do mesmo receipt é segura. Quando a mensagem existe no banco local, o estado `PLAYED` e o `MessageUpdate` correspondente são persistidos de forma idempotente; reenvios não criam updates locais duplicados.

## Templates por instância e templates Business

`sendTemplate` distingue a integração: Business continua no método oficial;
ZAPO/Baileys usam o catálogo persistido por instância `LocalTemplate`. Esses registros
são expostos como `APPROVED`; `enabled`/`available` controlam a disponibilidade.
A categoria é `OPENING` (Abertura de conversa no HUB). A listagem e o envio Graph
expõem o mesmo contrato. Veja [Templates por instância](local-templates.md).
