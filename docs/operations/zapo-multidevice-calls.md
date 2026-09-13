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

Antes do atendimento, o encerramento é enviado ao endereço original e aos dispositivos da oferta/relay, excluindo a própria conta. Depois do atendimento, é enviado ao vencedor. Erros de envio são propagados, preservando o estado para nova tentativa. Sucesso nessa operação comprova envio pelo transporte Zapo; não substitui a confirmação remota nem um teste com aparelhos reais.

## Atendimento pela Connect API ou HUB

O aceite local responde ao `peerJid` completo do remetente da oferta, preservando o segmento `:device` tanto no destino quanto na sessão Signal usada para cifrar a resposta. `call-creator` permanece inalterado como correlação da chamada; não é usado como substituto do endereço do device originador.

A chamada só passa de `incoming_ringing` para `connecting` depois de preparar e enviar a stanza `accept`. Chave de chamada ausente/inválida, falha ao obter sessão, cifrar ou enviar o aceite produzem erro; não publicam atendimento local. O estado é revalidado após operações assíncronas para preservar término remoto ou atendimento concorrente no smartphone. Requisições locais simultâneas compartilham o mesmo envio.

A validação automatizada desse fluxo começa pela oferta criada por uma instância A, entrega-a a B e executa `acceptCall` de B; o `accept` gerado pelo próprio pacote é então entregue à instância A. A rede/Signal são simulados nesses testes. Validação com contas WhatsApp reais permanece necessária.

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
