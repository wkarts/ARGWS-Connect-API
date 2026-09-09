# Commit sugerido

## Título

feat(whatsapp): adiciona provider Zapo nativo com VoIP direto

## Descrição

Integra o Zapo como provider nativo de WhatsApp na Connect|API e remove o provider legado CONNECT e o bridge WavoIP.

- adiciona `WHATSAPP-ZAPO` ao ciclo de vida de instâncias e ao Manager;
- implementa QR Code e código de pareamento diretamente com `@innovatorssoft/zapo-js`;
- persiste estado de autenticação/Signal do Zapo no PostgreSQL;
- implementa texto, mídia, áudio/PTT, PTV, sticker, reação e enquete no provider Zapo;
- integra chamadas de voz diretamente com `@innovatorssoft/voip`, sem `devices.wavoip.com`;
- adiciona rotas de chamada `offer`, `accept`, `reject`, `end`, `mute` e `list`;
- expõe PCM 16 kHz internamente para a futura ponte com o PBX;
- remove `ConnectStartupService`, provider `CONNECT`, `wavoipToken`, bridge `voiceCalls` e `socket.io-client`;
- migra instâncias legadas `CONNECT` para `WHATSAPP-ZAPO` em estado fechado para novo pareamento;
- usa Node 22 + Debian Bookworm Slim na imagem da API para compatibilidade com WebRTC nativo;
- normaliza scripts shell do pacote para LF, garantindo execução correta em Linux;
- inclui o gerador de `runtime-config.js` no entrypoint da imagem Nginx do Manager;

A entrega mantém Baileys e Meta como providers nativos independentes e prepara a base de voz para o PBX sem introduzir FreeSWITCH nesta etapa.
