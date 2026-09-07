# Connect|API Voice — Softphone PWA e PBX

## Objetivo

O Softphone é uma interface do Connect|API. O provider de WhatsApp (Zapo hoje) fornece sinalização e mídia; o usuário não precisa conhecer a implementação interna.

> Estado atual: a sinalização de chamadas está integrada. O áudio do navegador ainda depende do Voice Media Gateway descrito abaixo e não deve ser apresentado como concluído antes dessa camada.

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

## PBX

O PBX será construído sobre o Voice Core, não diretamente sobre o Zapo. Assim o mesmo Softphone poderá trabalhar com WhatsApp, SIP/WebRTC e trunks sem uma segunda interface.

## Vídeo

O contrato pode reservar `isVideo`, mas vídeo só deve ser exposto como disponível quando o provider e o plano de mídia tiverem encoder/decoder e transporte validados. A integração Zapo atual é áudio; a UI não deve prometer vídeo antes disso.
