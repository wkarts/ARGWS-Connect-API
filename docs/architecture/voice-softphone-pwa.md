# Connect|API Voice — Softphone PWA e PBX

## Objetivo

O Softphone é uma interface do Connect|API. O provider de WhatsApp (Zapo hoje) fornece sinalização e mídia; o usuário não precisa conhecer a implementação interna.

> Estado atual: sinalização e Voice Media Gateway estão integrados para o provider ZAPO. O navegador solicita uma autorização temporária, curta e de uso único antes de abrir o canal de mídia; tokens persistentes não são enviados no handshake WebSocket.

## Camadas

1. **WhatsApp Voice Provider** — Zapo: sinalização, estados da chamada e PCM de áudio.
2. **Voice Core** — contrato neutro: Call, CallLeg, MediaSession, Participant e State.
3. **Voice Media Gateway** — canal dedicado de mídia, fora do EventManager, para áudio em tempo real.
4. **Connect|API Softphone PWA** — Web Audio/AudioWorklet, microfone, alto-falante, mute, hold e controles de chamada.
5. **PBX Core** — ramais, agentes, filas, URA, grupos, transferência, conferência, gravação e CDR.
6. **FreeSWITCH** — serviço separado de execução SIP/RTP/SRTP/WebRTC quando o PBX for habilitado.

## Softphone PWA — primeira entrega de mídia

- O navegador solicita um ticket curto de mídia por HTTPS.
- O Softphone abre um WebSocket dedicado de mídia usando esse ticket.
- Entrada: PCM mono 16 kHz vindo do Zapo é entregue ao AudioWorklet e reproduzido pelo navegador.
- Saída: microfone do navegador é reamostrado para PCM mono 16 kHz e alimenta `feedLiveAudio`.
- `setExternalAudioMode` é habilitado somente enquanto o Softphone possui a sessão de mídia.
- Áudio/PCM nunca passa por RabbitMQ, Webhook, NATS, SQS ou EventManager.
- Eventos de estado da chamada continuam usando o plano normal de eventos.

## Segurança do Voice Media Ticket

`POST /call/mediaTicket/{instanceName}` usa a autenticação normal da API e recebe o `callId` da chamada ativa.

O ticket:

- é gerado com 32 bytes aleatórios criptograficamente seguros;
- expira em 30 segundos;
- é associado à instância e à chamada ativa;
- é consumido no primeiro handshake do WebSocket e não pode ser reutilizado;
- não é colocado em query string;
- é retornado com `Cache-Control: no-store`;
- só é emitido quando o provider suporta mídia de voz e a chamada ainda está ativa;
- é novamente validado contra a chamada ativa no momento do handshake.

O WebSocket `/voice/media` aceita preferencialmente:

```json
{
  "ticket": "AUTORIZACAO_TEMPORARIA"
}
```

Para reduzir superfície de abuso, o gateway limita o tamanho do payload inicial de autenticação, limita quadros PCM enviados pelo cliente e mantém quantidade máxima de tickets pendentes em memória.

A autenticação legada por token no WebSocket permanece aceita temporariamente para compatibilidade retroativa com clientes anteriores, mas o Softphone atual não envia mais token persistente no handshake de mídia.

### Escala horizontal

Nesta etapa, os tickets são mantidos em memória no processo da API. Em implantação com múltiplas réplicas, mantenha afinidade entre a emissão do ticket e o upgrade WebSocket. A evolução natural é mover somente o armazenamento efêmero dos tickets para Redis antes de retirar essa afinidade; isso não exige mudar o contrato público.

## PBX

O PBX será construído sobre o Voice Core, não diretamente sobre o Zapo. Assim o mesmo Softphone poderá trabalhar com WhatsApp, SIP/WebRTC e trunks sem uma segunda interface.

## Vídeo

O contrato pode reservar `isVideo`, mas vídeo só deve ser exposto como disponível quando o provider e o plano de mídia tiverem encoder/decoder e transporte validados. A integração Zapo atual é áudio; a UI não deve prometer vídeo antes disso.
