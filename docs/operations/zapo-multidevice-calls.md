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

O aceite local mantém o envelope `call/accept` com `toUserJid(peerJid)` e um ID de stanza, preservando `call-id` e `call-creator`. O corpo de áudio passa a ser `audio(enc=opus, rate=16000)`, `net(medium=2)` e `encopt(keygen=2)`, nessa ordem. A assinatura pública do builder e a declaração de vídeo existente foram conservadas. Não há nova resolução PN/LID nem alteração do endereço externo neste ajuste.

A chave de mídia já foi entregue na oferta cifrada para cada dispositivo e decifrada antes de disponibilizar o atendimento. O `accept` agora confirma o uso dessa chave, sem reenviá-la em outro `enc`, sem `device-identity` e sem iniciar outra sincronização/cifra Signal. A oferta continua cifrada, a chave válida de 32 bytes continua obrigatória e a derivação/proteção SRTP permanece inalterada. O recebimento de um `accept` cifrado de outro cliente continua suportado pelo parser existente.

A chamada só passa de `incoming_ringing` para `connecting` depois de preparar e enviar a stanza `accept`. Chave ausente/inválida ou falha no envio do aceite produzem erro; não publicam atendimento local. O estado é revalidado após operações assíncronas para preservar término remoto ou atendimento concorrente no smartphone. Requisições locais simultâneas compartilham o mesmo envio. `connecting` e a disponibilidade local do relay não comprovam que o servidor ou o interlocutor reconheceu o aceite.

### Evidência e limite da correção

Os diagnósticos de 13/09/2026 às 09:41 (Bahia) registraram o envio de um `accept` sem ACK correspondente nem entrada no originador, apesar da chegada de `mute_v2` e `transport`. O patch anterior restaurou o endereço externo de conta usado pelo [builder original do Zapo](https://github.com/innovatorssoft/zapo/blob/194fa04b1d49484546941c5589f9c60a13941dd7/packages/voip/src/signaling/signaling.ts). A nova tentativa das 10:18–10:19 continuou apresentando a mesma falha com esse endereço: o receptor enviou `accept` com `enc`, mas esse aceite não aparece no originador.

Nesses novos diagnósticos há controles bem-sucedidos na mesma instalação: o `accept` do outro dispositivo chega às APIs sem `enc`, e o originador avança para atendimento. Isso sustenta comparar o corpo da resposta, mas não prova isoladamente por que o servidor deixou de entregar os accepts da API. Os registros não trazem todos os atributos internos dos nós de mídia/rede.

A alteração do corpo também se apoia em uma implementação independente e verificável: [whatsapp-rust, `build_accept` e teste `accept_and_preaccept_shape`](https://github.com/oxidezap/whatsapp-rust/blob/6502b871e35664ffb80044ba7c6317a6427754e2/wacore/src/stanza/call.rs) e [fluxo `build_answer_signaling`, com chave obtida da oferta](https://github.com/oxidezap/whatsapp-rust/blob/6502b871e35664ffb80044ba7c6317a6427754e2/src/voip/facade.rs). Nesse commit, a resposta usa `net medium=2`/`encopt keygen=2` sem devolver a chave cifrada. Trata-se de implementação de engenharia reversa, não de especificação oficial da Meta. O roteamento de conta mantido aqui e o tratamento de vídeo existente não são apresentados como homologados por essa referência.

Os testes executam os builders CJS e ESM, serializam e decodificam o formato binário, verificam a preservação dos IDs e da chave e proíbem nova cifra no aceite. O teste entre duas instâncias começa pela oferta real do pacote, entrega a chave cifrada de A para B e executa `acceptCall` em B; A conserva a mesma chave para processar a resposta. Rede, Signal e hardware são simulados. Também são exercitados o aceite cifrado legado recebido, chave inválida, falha/repetição de envio e concorrência com término ou atendimento no smartphone. Antes da alteração, os oito testes do novo corpo falham no pacote anterior. A entrega/ACK pelo servidor WhatsApp e o áudio entre aparelhos reais permanecem pendentes de homologação.

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
