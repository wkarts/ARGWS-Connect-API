# Connect Video Adapter

## Escopo e preservação de voz

O adapter adiciona chamadas de vídeo à Connect|API. Chamadas `isVideo=false` (ou sem o campo) continuam no plugin `@innovatorssoft/voip` 1.0.0 já homologado, com a correção de atendimento ao dispositivo originador da versão 1.1.3. O pipeline PCM, `/voice/media`, os contratos de voz e o patch existente são preservados.

O novo engine atende **somente chamadas de vídeo**, incluindo a trilha de áudio dessas chamadas. Seu código está em `src/api/integrations/channel/whatsapp/voip/engine`, sob controle da Connect. Não há novo patch da biblioteca para vídeo, importação de classes privadas de `node_modules` ou troca automática de engine após uma falha.

A orientação posterior do usuário de manter o áudio homologado prevalece sobre a migração completa do core descrita no material de planejamento. A remoção do patch de voz e a migração do áudio não fazem parte desta entrega.

## Fronteira pública

O plugin `connectCallAdapterPlugin` compõe o plugin de voz existente e o engine de vídeo por meio do contexto público de plugins Zapo. Registros de handlers são filtrados por chamada: uma sessão de voz existente tem prioridade; uma oferta de vídeo ou sessão de vídeo conhecida é direcionada ao engine Connect. ACKs sem `call-id` são correlacionados pelos IDs das stanzas de vídeo, em mapas limitados. Cada pacote é tratado por apenas um engine.

`client.voip` mantém os métodos `startCall`, `acceptCall`, `rejectCall`, `endCall`, `getCall`, `getCalls`, `setMute` e mídia de áudio. A chamada continua vinculada ao engine que a criou. São acrescentados `feedLiveVideo(callId, annexB, timestampUs)` e `requestVideoKeyFrame(callId)`.

Os fontes derivados preservam licença MIT e proveniência em `third-party/connect-voip`, copiados para `dist/third-party/connect-voip` no build. A referência de vídeo é o [PR Zapo #274, commit 062098645ad99e9caeb04e751f58d5ac50639e63](https://github.com/vinikjkkj/zapo/pull/274). O código de voz validado na Connect tem precedência sobre mudanças de signaling antigas daquela referência.

## API

Todas as rotas abaixo usam os guards existentes de instância e o header `apikey` autorizado.

| Método e rota | Uso |
|---|---|
| `GET /call/capabilities/:instanceName` | Capacidade efetiva `audio`, `video`, `engine`, codec e limites disponíveis |
| `POST /call/offer/:instanceName` | Contrato existente; `{ "number": "5575999999999", "isVideo": true }` solicita vídeo |
| `POST /call/accept/:instanceName` | Contrato existente `{ "callId": "..." }`, também usado para vídeo |
| `POST /call/videoMediaTicket/:instanceName` | `{ "callId": "..." }`; ticket de uso único de 30 segundos |
| WebSocket `/video/media` | H.264 binário autenticado por ticket |

O ticket é exclusivo da mídia de vídeo e vinculado à instância, chamada e objeto de runtime. Exige chamada de vídeo existente e não terminada. Ele não funciona como chave permanente da API. A resposta inclui `ticket`, `expiresAt`, `expiresInSeconds`, `mediaPath`, `codec`, `format`, `maxFrameBytes`, `maxFps`, `width`, `height` e `bitrate`, com `Cache-Control: no-store`.

Uma chamada iniciada retorna o ID depois de enviar a oferta; isso não é confirmação de atendimento remoto nem de áudio/vídeo fluindo.

O engine identifica o tipo da chamada por `mediaType`. O provider converte esse campo em `isVideo` nas respostas de listagem, atendimento e eventos `CALL`, preservando o booleano explícito de providers anteriores. Desligar a câmera não muda o tipo da chamada. Essa normalização também permite que o gateway reconheça a chamada de vídeo ao autorizar o ticket.

## Protocolo da mídia

1. Abrir WebSocket TLS no mesmo host da API, caminho `/video/media`, sem credenciais na query.
2. Enviar JSON `{ "ticket": "<ticket descartável>" }` em até 5 segundos.
3. Aguardar o controle `ready`, com os parâmetros negociados pelo gateway.
4. Enviar/receber H.264 Annex-B em mensagens binárias CV. Cada mensagem contém um access unit completo.
5. Controle JSON `{ "type": "request_keyframe" }` solicita um quadro-chave: cliente → servidor pede PLI remoto; servidor → cliente pede IDR ao encoder local. As solicitações são limitadas em frequência.

A recuperação envia PLI inicial, outro PLI após pelo menos 500 ms e FIR após mais 750 ms se ainda faltar IDR. Cada tentativa produz somente um pacote de feedback; novos pedidos respeitam esses intervalos, sem timer de repetição. Um IDR autenticado reinicia a sequência de recuperação, mantendo o limite de frequência. O gateway e o feedback para o encoder local usam intervalo mínimo de 500 ms. O controle de FPS tolera 2 ms de arredondamento do navegador, permitindo intervalos de 33 ms em 30 fps e rejeitando rajadas de 60 fps.

| Offset | Tamanho | Conteúdo |
|---|---|---|
| 0 | 2 bytes | ASCII `CV` |
| 2 | 1 byte | Versão `1` |
| 3 | 1 byte | Bit 0: quadro-chave; outros bits reservados |
| 4 | 8 bytes | `timestampUs`, uint64 big-endian, limitado ao inteiro seguro JavaScript |
| 12 | 4 bytes | Tamanho do H.264, uint32 big-endian |
| 16 | Variável | Access unit H.264 Annex-B |

`timestampUs` é microssegundos da linha temporal da mídia, não epoch nem timestamp RTP bruto. O engine converte o relógio RTP de 90 kHz no recebimento e o reconstrói no envio. Não há Base64 de frames.

## Manager e navegadores

A tela de chamadas consulta as capabilities da instância. Para vídeo, verifica encoder e decoder H.264 WebCodecs e pede acesso à câmera antes de iniciar/atender. Exibe preview local, vídeo remoto e controle de câmera. A voz permanece no serviço de áudio existente.

É necessário HTTPS (ou localhost), permissão de câmera/microfone e um navegador com H.264 WebCodecs efetivamente suportado. O código consulta `isConfigSupported`; a presença de `VideoEncoder` sozinha não é suficiente. Quando indisponível, a interface informa a limitação e mantém as chamadas de voz acessíveis.

O encoder local usa `avc1.42E01F`, saída Annex-B, 640×480, 800 kbit/s, até 30 fps. O decoder identifica o perfil remoto pelo SPS e verifica suporte antes de configurá-lo, inclusive para perfis Main/High. Falha ou reconexão de vídeo preserva a sessão de áudio. Não foi implementado transcoder para navegadores sem H.264. O HUB pode integrar o novo contrato de mídia; seu frontend não é alterado neste repositório.

## Limites e privacidade

- Frames limitados a 8 MiB, com validação de cabeçalho, tamanho, flags, timestamps e Annex-B.
- WebSocket sem compressão, autenticação serializada, tickets de uso único e uma sessão de câmera por chamada.
- Filas de encoder/decoder e buffers WebSocket limitados; perdas exigem recuperação por quadro-chave.
- H.264 rejeita unidades excedidas/incompletas em vez de emitir fragmentos corrompidos.
- SRTP/SRTCP valida autenticação e replay; contextos de SSRC têm limite e não descartam estado de replay de uma sessão ativa para abrir espaço.
- Eventos de vídeo permanecem nos emitters internos da mídia. Não são enviados a EventManager, webhooks, RabbitMQ, storage ou diagnósticos.
- Diagnóstico registra somente estados/códigos permitidos, com IDs pseudonimizados. Sem frames, áudio, chaves, tickets ou conteúdo de conversas.

Para diagnosticar autorização de mídia, as rotas estáticas `capabilities` e `videoMediaTicket` permanecem identificáveis no log HTTP; o nome da instância e os dados do ticket continuam ocultos. Se a chamada aparecer como voz e o ticket de vídeo retornar `404`, conferir se a API está executando a correção de normalização `mediaType` → `isVideo`. Um aceite no signaling não comprova que o gateway de vídeo foi autenticado.

## Ativação na develop

O recurso fica ativo na `develop`, com `enabled: true` e engine `connect`, sem configuração por variáveis de ambiente. A promoção para `main` e uma eventual configuração por ENV serão decididas separadamente; esta implementação não promove o recurso para `main`.

Os limites de mídia são fixos no código:

| Parâmetro | Valor |
|---|---|
| Tamanho máximo de access unit | 8 MiB |
| Quadros por segundo | Até 30 |
| Resolução de envio | 640 × 480 |
| Bitrate de envio | 800000 bit/s |

As variáveis `CONNECT_VOIP_ENGINE` e `CONNECT_VIDEO_*` apresentadas anteriormente não são consultadas pelo adapter. `ZAPO_VOIP_ENABLED` e os limites de concorrência de voz existentes continuam válidos. A capability de vídeo ainda depende de uma instância conectada com o adapter disponível; a configuração fixa não simula suporte em outros providers.

## Build, testes e implantação

O build da API inclui o engine Connect no bundle. Não é necessário novo container de mídia ou migration. O proxy deve encaminhar o upgrade WebSocket de `/video/media` para a mesma API que emitiu o ticket; em múltiplas réplicas, manter afinidade de instância e mídia, como no áudio.

A suíte de voz permanece executando o plugin homologado. Testes separados exercitam engine de vídeo, packetização, replay, gateway, isolamento de chamadas e lifecycle do Manager. Rede WhatsApp, câmera remota e interoperabilidade real precisam de homologação; aprovação de CI não a substitui.

Após publicar a imagem em homologação:

1. Confirmar chamada de voz API A → API B e o atendimento que já funcionava.
2. Confirmar atendimento de voz em smartphone e WhatsApp Desktop.
3. Iniciar vídeo A → B, atender na API B e validar áudio e vídeo nos dois sentidos.
4. Repetir vídeo API → smartphone/Desktop e smartphone/Desktop → API.
5. Testar câmera desativada/reativada, rejeição, término remoto, perda/reconexão de mídia e três chamadas sequenciais.
6. Conferir que tickets reutilizados, outra instância e navegador sem codec não obtêm acesso a frames.

O adapter de vídeo continua separado do plugin de voz homologado. O ciclo de homologação ocorre na `develop`, sem alteração de configuração de produção na `main`.
