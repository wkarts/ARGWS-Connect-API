# Correção de chamadas entre dispositivos — Zapo VoIP 1.0.0

## Problema e evidência

O pacote npm `@innovatorssoft/voip@1.0.0` consumido pela Connect API apresenta falhas reproduzidas com suas classes reais em testes, usando rede e hardware de áudio simulados:

- compara literalmente os JIDs ao enviar `accepted_elsewhere`; PN/LID e `:0` podem identificar o mesmo aparelho;
- continua o processamento de `accept` após uma transição inválida, sem distinguir chamada recebida e realizada;
- permite que accepts concorrentes substituam o primeiro aparelho que atendeu;
- pode descartar `terminate` ao normalizar o remetente ou falhar no ACK;
- ignora `reject` e não guarda os destinatários da oferta para encerramento anterior ao ACK;
- publica estados que o adaptador não reconhecia, como `incoming_ringing`, `connecting` e `active`.

A oferta existente já consulta os dispositivos e distribui a chave cifrada para cada destino. Essa implementação foi preservada. O patch não troca biblioteca, não cria fork e não altera banco, instâncias, pareamento, HUB ou endpoints.

## Implementação

`patches/zapo-voip-1.0.0.json` contém substituições exatas para os módulos CJS e ESM da dependência instalada. `scripts/apply-zapo-voip-patch.cjs` verifica versão e SHA-256 de cada arquivo antes de qualquer escrita. Uma compilação desconhecida provoca erro explícito; o script não tenta adaptar automaticamente outra versão.

O `postinstall` aplica o patch. `npm run runtime:deps:check` exige que os oito arquivos tenham o hash corrigido. O Docker copia manifesto e script antes de `npm ci` e conserva ambos na imagem final. Instalações com `--ignore-scripts` precisam executar `npm run patch:zapo-voip` antes do build.

A resolução PN/LID usa `signalDeviceSync.resolveUserJidPair`, método existente no Zapo 1.6.3, com cache por sessão e timeout de 5 segundos. Credenciais PN e LID reconhecem a própria conta. O número do device só é comparado depois de comprovada a identidade da conta; ausência de `:device` equivale ao device zero. Relação PN/LID desconhecida não autoriza desligar um possível vencedor.

Os aliases servem para comparar identidades. O JID original do `accept` permanece no signaling, SSRC e derivação SRTP, preservando o contrato de mídia. Os demais destinos permanecem os JIDs reais da oferta/relay.

O primeiro atendimento permanece vencedor. Quando o celular da própria conta atende uma chamada recebida, a sessão companion é encerrada localmente com `accepted_elsewhere`, sem enviar hangup ao interlocutor. Um ACK atrasado não substitui a mídia do vencedor. Uma recusa de device ocupado não encerra os demais enquanto ainda puderem atender.

Antes do atendimento, o encerramento é enviado ao endereço original e aos dispositivos da oferta/relay, excluindo a própria conta. Depois do atendimento, é enviado ao vencedor. Erros de envio são propagados, preservando o estado para nova tentativa. Sucesso nessa operação comprova apenas o retorno local do método de envio do Zapo; não substitui a confirmação remota nem um teste com aparelhos reais.

## Atendimento pela Connect API ou HUB

O aceite local envia o envelope `call/accept` para o `peerJid` recebido da oferta, preservando o dispositivo originador, o ID de stanza, `call-id` e `call-creator`. O endereço de resposta não passa por `toUserJid`: uma oferta recebida de `conta:18@lid` deve responder a esse dispositivo, e não reduzir o destino a `conta@lid`. O mesmo vale para PN. Endereços de dispositivo primário (`:0` ou bare) continuam suportados. `call-creator` permanece como metadado original e não substitui o endereço do remetente. Há um único destino e um único envio de aceite, sem nova resolução PN/LID ou distribuição para outros dispositivos.

O corpo de áudio permanece `audio(enc=opus, rate=16000)`, `net(medium=2)` e `encopt(keygen=2)`, nessa ordem. A assinatura pública do builder e a declaração de vídeo existente foram conservadas.

A chave de mídia já foi entregue na oferta cifrada para cada dispositivo e decifrada antes de disponibilizar o atendimento. O `accept` agora confirma o uso dessa chave, sem reenviá-la em outro `enc`, sem `device-identity` e sem iniciar outra sincronização/cifra Signal. A oferta continua cifrada, a chave válida de 32 bytes continua obrigatória e a derivação/proteção SRTP permanece inalterada. O recebimento de um `accept` cifrado de outro cliente continua suportado pelo parser existente.

A chamada só passa de `incoming_ringing` para `connecting` depois de preparar e enviar a stanza `accept`. Chave ausente/inválida ou falha no envio do aceite produzem erro; não publicam atendimento local. O estado é revalidado após operações assíncronas para preservar término remoto ou atendimento concorrente no smartphone. Requisições locais simultâneas compartilham o mesmo envio. `connecting` e a disponibilidade local do relay não comprovam que o servidor ou o interlocutor reconheceu o aceite.

### Evidência e limite da correção

Os diagnósticos anteriores de 13/09/2026 às 09:41 e 10:18–10:19 (Bahia) registraram o envio de `accept` com `enc` sem entrada correspondente no originador. Na mesma instalação, accepts de outro dispositivo sem `enc` chegaram às APIs e o originador avançou para atendimento. A alteração do corpo na versão 1.1.2 se apoiou nesses controles e na implementação independente [whatsapp-rust, `build_accept` e teste `accept_and_preaccept_shape`](https://github.com/oxidezap/whatsapp-rust/blob/6502b871e35664ffb80044ba7c6317a6427754e2/wacore/src/stanza/call.rs), preservando a chave recebida na oferta. O endereço externo de conta ainda era mantido conforme o [builder original do Zapo](https://github.com/innovatorssoft/zapo/blob/194fa04b1d49484546941c5589f9c60a13941dd7/packages/voip/src/signaling/signaling.ts).

A nova tentativa das 11:45–11:46 (Bahia), exportada por duas APIs 1.1.2, mostra uma diferença concreta: o aceite corrigido sem `enc`, com `net medium=2`, recebe ACK e depois receipt com remetente de conta. Entretanto, não aparece como `call/accept` na API originadora, cujo dispositivo é `:18`. A oferta identifica esse dispositivo em `from` e `call-creator`; `preaccept`, `mute_v2` e `transport` do receptor usam o destino `:18` e chegam ao originador. O `accept` era enviado somente ao endereço bare da conta. Os exports dessa tentativa não contêm o encerramento por timeout: o do originador termina enquanto a chamada ainda está em andamento.

ACK/receipt do endereço de conta não comprovam entrega do aceite à sessão companion que iniciou a chamada. Também não há log do smartphone originador que permita afirmar que ele recebeu esse pacote. O cenário de direcionamento ao dispositivo primário é um modelo de endereçamento exercitado nos testes, não uma observação do aparelho real. A correção preserva o remetente integral da oferta como destino do aceite, assim como faz o fluxo não coletivo de [whatsapp-rust, `build_answer_signaling`](https://github.com/oxidezap/whatsapp-rust/blob/6502b871e35664ffb80044ba7c6317a6427754e2/src/voip/facade.rs): `incoming.from` é usado para `preaccept` e `accept`. Trata-se de implementação de engenharia reversa, não de especificação oficial da Meta. Não há alteração de estado, interface, hangup ou mídia neste ajuste de endereço.

Os testes executam os builders CJS e ESM, serializam e decodificam o formato binário e verificam PN/LID com endereço bare, `:0` e `:18`, preservação dos IDs e da chave e ausência de nova cifra no aceite. A rede simulada agora escolhe o destinatário exclusivamente pelo endereço de transporte, sem procurar a sessão por `call-id`/`isInitiator`. Ela inclui um primário A0 sem chamada e um originador A18: o pacote bare pode ser ACKado por A0 sem avançar A18, enquanto o aceite dirigido ao remetente A18 chega à sessão correta. Também são preservados os cenários de atendimento originado no primário, `call-creator` independente do endereço, oferta cifrada, aceite cifrado legado recebido, chave inválida, falha/repetição de envio e concorrência com término ou atendimento no smartphone.

Com o destino bare anterior, 27 dos 52 testes de atendimento falham; com a preservação do dispositivo, os 52 passam. Rede, Signal e hardware permanecem simulados. Essa validação demonstra a correção do endereço e a regressão do modelo anterior de testes; a entrega pelo WhatsApp, o reconhecimento remoto e o áudio entre aparelhos reais continuam pendentes de homologação.

Os novos exports preservam também `audio.enc`, `audio.rate`, `net.medium` e `encopt.keygen`, com valores restritos ao protocolo. Isso permite conferir o corpo corrigido e correlacionar o ID da stanza entre envio, ACK e recebimento. Conteúdo das conversas, bytes de áudio e chaves continuam excluídos; os limites de coleta permanecem iguais.

## Respostas repetidas entre duas APIs

Os diagnósticos de 13/09/2026 registraram centenas de eventos `relaylatency` e respectivos ACKs em aproximadamente 2,5 segundos, antes do atendimento. O handler do pacote encaminhava cada relatório recebido de volta ao remetente com um novo ID de stanza. Duas instâncias executando esse mesmo handler mantinham um ciclo sem fim. O handler de `mute_v2`, usado durante o aceite, também respondia incondicionalmente com outro `mute_v2`.

As respostas desses dois handlers são deduplicadas por sessão e janela de 60 segundos: uma impressão SHA-256 considera o peer, o conteúdo recebido e os destinatários/conteúdo da resposta, excluindo o ID exterior que muda em cada retransmissão. O primeiro envio e informações novas continuam passando, respeitando o limite da janela. O ACK de cada stanza recebida permanece no roteador. Envios pendentes ficam separados do histórico e continuam reservados na troca de janela. Uma duplicata concorrente aguarda o mesmo envio e recebe a mesma falha, caso ocorra; após a falha, uma nova tentativa é permitida. Uma sessão encerrada não produz novas respostas.

Cada tag (`relaylatency` e `mute_v2`) admite até 256 respostas automáticas por chamada em cada janela de 60 segundos. Ao atingir o limite, novas respostas automáticas dessa tag são omitidas até a próxima janela e um aviso técnico é registrado. O histórico é renovado a cada janela, preservando as reservas de envios ainda pendentes; o limite não é vitalício. Os comandos de atendimento/término, os ACKs e os relatórios locais de relay não usam essa guarda. Nenhum payload é acrescentado aos diagnósticos por essa deduplicação.

Os testes reproduzem os ciclos com sessões, roteadores e builders reais do pacote e entrega de rede simulada. Os logs originais atingiram o antigo limite de coleta antes do aceite, portanto não comprovam se o `accept` chegou, foi rejeitado ou foi processado pelo outro lado. A correção remove o ciclo reproduzido; a confirmação do atendimento e áudio entre contas reais continua sendo um critério de homologação, não uma conclusão extraída de HTTP 200 ou dos testes simulados.

## Estados publicados

| Estado ou motivo do pacote | Status canônico |
| --- | --- |
| `initiating`, `ringing`, `incoming_ringing` | `ringing` |
| `connecting`, `active`, `on_hold` | `answered` |
| `ended` + `accepted_elsewhere` | `answered_elsewhere`, terminal |
| `ended` + `declined`, `busy`, `do_not_disturb` | `rejected`, terminal |
| `ended` + `failed` | `failed`, terminal |
| `ended` + `timeout` | `missed` na entrada; `unanswered` na saída |
| Demais encerramentos | `ended`, terminal |

`answered` inclui a fase de conexão; não é garantia de áudio estabelecido. O estado nativo continua em `stateData`/`providerState`. O Manager respeita `terminal` e encerra somente a mídia local da sessão correspondente. Os aliases antigos continuam aceitos.

## Instalação e validação

Use o código desta correção nas instâncias participantes e gere uma nova imagem pelo fluxo habitual do projeto. Apenas reiniciar a imagem antiga não aplica o patch.

```bash
npm ci
npm run test:voip
npm run runtime:deps:check
DATABASE_PROVIDER=postgresql npm run db:generate
npm run build
npm --prefix manager install --no-audit --no-fund
npm --prefix manager run build
npm run docs:check
```

`db:generate` apenas gera o cliente Prisma. Esta correção não requer migration nem comandos de limpeza de banco/volumes. Reinicie o processo da API de forma controlada, sem chamadas legítimas em andamento; sessões VoIP são objetos de memória. Preserve sessões WhatsApp e todos os volumes existentes.

## Homologação com aparelhos — pendente

Os testes automatizados não se conectam ao WhatsApp e não validam áudio/SRTP/WebRTC reais. Execute esta matriz em duas contas de teste após instalar a imagem corrigida:

1. API A liga para B (celular B e API B vinculados); atender no celular B. A mantém o atendimento, API B limpa apenas a sessão companion e o áudio funciona nos dois sentidos.
2. Repetir atendendo na API B/Manager/HUB. A reconhece o atendimento e o celular deixa de tocar sem encerrar o device vencedor.
3. A encerra enquanto B toca, inclusive imediatamente após iniciar. Nenhuma sessão permanece ativa em B.
4. A encerra depois do atendimento. Ambos os lados encerram.
5. Repetir pelo menos três vezes e verificar `GET /call/list/{instanceName}` em A e B: nenhuma chamada antiga acumulada.
6. Preservar regressões Mobile/Desktop → API e API → Mobile/Desktop.
7. Recusar no destinatário; testar também apenas um device ocupado enquanto outro recebe.

Registre `callId`, direção, estado e motivo nos dois lados, sem tokens. Se persistir falha, correlacione signaling e mídia dessa mesma chamada; não atribua sucesso em produção apenas a testes locais.

## Reversibilidade

Se a homologação falhar, reimplante a imagem anterior mantendo os volumes. Não use reset de branch, restauração do banco, exclusão de instâncias, `down -v` ou despareamento como parte desta correção. Para remover o patch no código, reverta somente seus arquivos e reinstale a dependência pelo lockfile.

## Origem

Pacote inspecionado: `@innovatorssoft/voip@1.0.0`, npm shasum `a4d1c64560bc0a0cc394b8cc93765719244da486`. Dependência base: `@innovatorssoft/zapo-js@1.6.3`. O patch conserva as licenças e o código não relacionado. A referência de fonte é o repositório do fornecedor em `innovatorssoft/zapo`, commit `194fa04b1d49484546941c5589f9c60a13941dd7`.
