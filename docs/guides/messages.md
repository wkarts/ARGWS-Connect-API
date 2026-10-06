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

### Áudio comum e nota de voz

`POST /message/sendWhatsAppAudio/{instanceName}` aceita `intent`, `ptt`, `recordedByMicrophone`, `mimetype` e `encoding` em JSON ou multipart (`file`). ZAPO e Baileys compartilham a mesma preparação; outros providers mantêm seus contratos próprios. Enviar um áudio não cria um job de transcrição.

| Parâmetros | Classificação | Resultado ZAPO/Baileys |
| --- | --- | --- |
| `intent=voice_note`, `dictation` ou `transcription` | Nota de voz | OGG/Opus mono 48 kHz, `ptt=true`, duração e waveform. |
| `intent=attachment`, `music` ou `generic_audio` | Áudio comum | Bytes originais, MIME de áudio, `ptt=false`. |
| `intent=auto` com `ptt=true` ou `recordedByMicrophone=true` | Nota de voz | Normalização PTT. |
| `intent=auto` sem sinal explícito, ou com `ptt=false` | Áudio comum | Sem conversão para PTT. |
| `intent` ausente | Nota de voz | Preserva o significado legado de `sendWhatsAppAudio`. |

`ptt` contraditório com `intent` explícito retorna 400. MIME, codec, extensão, nome e duração **não** são sinais confiáveis para inferir fala: um arquivo OGG pode ser música. `recordedByMicrophone` é um parâmetro informado pelo cliente, não uma análise semântica do conteúdo. Para áudio comum também existe `sendMedia` com `mediatype=audio`; documentos continuam em `sendMedia` com `mediatype=document`.

Exemplo de nota de voz:

```json
{"number":"5575988881111","audio":"https://exemplo.com.br/gravacao.wav","intent":"voice_note"}
```

Exemplo de áudio comum no mesmo endpoint:

```json
{"number":"5575988881111","audio":"https://exemplo.com.br/musica.mp3","intent":"music","mimetype":"audio/mpeg"}
```

Os arquivos de entrada têm limite de 25 MiB nesse endpoint. PTT fica limitado a dez minutos; arquivos extensos devem seguir como áudio comum. `encoding=false` evita recodificar PTT pré-preparado somente se os bytes tiverem a assinatura OGG/Opus. A API produz duração e waveform em uma amostra reduzida, com limite de memória; o original não é alterado e segue a política atual de armazenamento do canal.

No recebimento, o Manager identifica nota de voz pelo `audioMessage.ptt` da mensagem WhatsApp; áudio sem esse sinal permanece áudio comum. Ele não inicia transcrição só porque o arquivo é OGG/Opus. No develop principal, a transcrição de uma mensagem persistida pode ser solicitada explicitamente em `/v1/speech/transcriptions` (ou pelo Manager); o worker cria PCM mono 16 kHz temporário e limitado. Quando `SPEECH_ENABLED=false`, o backend não aceita novos jobs, os workers não iniciam e os controles do Manager ficam ocultos. Enviar ou receber áudios normais continua independente dessa flag.

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
