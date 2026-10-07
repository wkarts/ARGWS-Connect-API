# Correção de ditado e transcrição — 07/10/2026

## Origem e objetivo

Implementação baseada no PDF **Connect-API-Auditoria-Ditado-Transcricao-2026-10-07**, com 19 páginas, enviado pelo responsável pelo projeto. A referência de código é `develop` em `c6fdfe387df01c548db9052eee87cf49d353e6c3` (PR #220). Após a orientação explícita do responsável, o patch concentra-se em ditado/transcrição e preserva os contratos ZAPO, Baileys e Meta Compatible, além de PTT e eventos gerais. A alteração preserva endpoints e histórico, corrige o ciclo de execução e oferece um canário explícito para whisper.cpp base multilíngue q5_1.

O resultado é código e configuração em validação. Não representa aplicação em VPS, aprovação de qualidade pt-BR nem liberação de release. A auditoria separou pressão de recursos de falhas criptográficas do WhatsApp; esta correção mantém essa separação e preserva sessões.

## Correspondência dos 22 achados

| Achado do PDF | Correção implementada | Evidência e limite de validação |
| --- | --- | --- |
| F01 — ciclo frio a cada áudio | Processo de inferência residente, compartilhado pelo pool; descarregamento por ociosidade | Dois reconhecimentos reais no mesmo PID; medir carga fria e idle TTL na VPS |
| F02 — threads implícitas | ONNX intra/inter threads explícitas, FFmpeg limitado, whisper.cpp CPU e pool HTTP de duas threads | Código primário das opções conferido; imagens e reconhecimento real AMD64/ARM64 aprovados na CI |
| F03 — VAD fragmentado | Atividade agrupada em janelas de até 30 s com sobreposição/checkpoint | Testes de áudio e chamadas por janela; qualidade das emendas exige corpus |
| F04 — PCM integral em tmpfs | Decodificação por janela, cache de fonte comprimida limitado e remoção do diretório após matar o grupo | Testes de limites e limpeza; tmpfs integra o orçamento do container |
| F05 — orçamento individual confundido com VPS | Um pool por stack, memory=memswap, canário 1280 MiB/1 CPU; cgroup pai comum opcional | Contratos dos dez manifests; associação e pico agregado do host ainda exigem aplicação e medição |
| F06 — uploads na memória da API | Reserva SQL antes de receber bytes, arquivo temporário, limites de tamanho/tempo e fontes fora do broker | Rotas nativas usam admissão anterior ao corpo; fachada Graph preservada. Novos uploads/ditados têm bucket privado próprio |
| F07 — polling caro da reserva | Conexão AMQP reutilizada e token de residência mantido pelo pool | Testes de admissão; não coordena brokers distintos |
| F08 — prioridade apenas nominal | Um escalonador com peso 3:1 e cessão entre chunks | Testes de ordem; não preempta uma inferência nativa em andamento |
| F09 — ausência de cota por instância | Cotas SQL de jobs, uploads, bytes e duração; round-robin na janela recebida | Testes de concorrência e escopo; matriz SQL real preparada em CI |
| F10 — gravação/publicação não atômicas | Job e outbox na mesma transação serializable com trava por pool | Regressões e integração SQL/RabbitMQ para falha entre etapas |
| F11 — confirm incompleto | Publish com mandatory/basic.return; ACK de resultado após persistência SQL | Testes de retorno sem rota, repetição e resposta perdida |
| F12 — tentativa sem identidade de execução | Claim antes de inferir; executionId, generation e lease cercam mutações | Testes de mensagens antigas, cancelamento e conclusão repetida |
| F13 — heartbeat tratado como progresso | Controle e progresso separados; deadlines absolutos por job e operação | Manager não inventa percentual; progresso indeterminado até conhecer duração |
| F14 — cancelamento/fila sem circuito fechado | Cancelamento durável, kill de grupo, confirmação de término, retries e filas/DLQ limitados | Testes de processo bloqueado e cancelamento nativo; fault injection completo em homologação |
| F15 — consumidor igual a prontidão | Saúde por camada/modo e reconhecimento inicial; identidade verificada | Testes de prontidão fria, heartbeat e modo; primeiro job pode carregar pool frio |
| F16 — modelo configurado diferente do executado | Catálogo fixado, engines explícitos, requested/effective/revision; sem alias openai→local | Testes de incompatibilidade e resultado real identificam base q5_1 |
| F17 — corrupção sem reparo confiável | Verificação em subprocesso, fingerprint de invalidação, force repair, deadlines e journal de recuperação | Corrupção do mesmo tamanho detectada; reparo e recuperação de troca interrompida testados |
| F18 — templates divergentes | Dez manifests, Fersoft gerado, deployers Node/Rust e flags consistentes | Compose/deployer aprovados localmente; Cargo e aplicação no host ficam para CI/homologação |
| F19 — build não reprodutível/sem inferência real | Lockfile/npm ci, bloqueio de CUDA indesejada, whisper.cpp pinado, smoke antes de promover tags | Build e reconhecimento reais AMD64/ARM64 em Docker aprovados; promoção continua condicionada à homologação |
| F20 — limpeza lê histórico inteiro | Lotes SQL limitados, índices, fonte/lease cercadas e resultados preservados | Testes de cleanup e corrida com retry; retenção operacional exige acompanhamento |
| F21 — conversão de PTT | Fora deste patch por orientação explícita do responsável | Conversão e contratos de envio de áudio existentes preservados |
| F22 — logs/eventos gerais | Fora deste patch por orientação explícita do responsável | Sistema de eventos e logs das integrações existentes preservado |

## Evidência nativa observada

Executor Linux x64, Node 24.19.0. O binário foi compilado do commit upstream `4979e04f5dcaccb36057e059bbaed8a2f5288315`. O novo provisionador baixou o GGML base q5_1 de 59.707.625 bytes e conferiu o SHA-256 fixado. O áudio de controle é `samples/jfk.wav` do mesmo upstream, em inglês, com 11 segundos.

| Ensaio | Resultado observado |
| --- | --- |
| Servidor nativo, primeira inferência | 7,751 s; RTF 0,705; dois segmentos |
| Servidor nativo, segunda inferência | 7,343 s; RTF 0,668; mesmo processo e texto |
| Pico de RSS do servidor nativo | 158180 KiB, aproximadamente 154,5 MiB |
| Threads observadas | Pico de quatro threads nativas, com uma thread de inferência configurada |
| Carga até `/health` nativo | 289 ms; este sinal isolado não é readiness validada |
| `InferenceClient` com guardião, carga + smoke | 7,596 s |
| `InferenceClient` com guardião, transcrição real | 7,946 s; RTF 0,722; dois segmentos |
| `InferenceClient` com guardião, ditado real | 7,913 s, mesmo grupo residente e sem timestamps |
| Cancelamento durante a terceira inferência | Grupo encerrado e verificado em 512 ms |

A variante inicial sem SIMD funcionou, mas levou cerca de 70–79 segundos para a mesma amostra, além do custo de warmup. Ela foi reprovada para o canário. A variante final usa dispatch de CPU do GGML, incluindo baseline e implementações selecionadas conforme o hardware.

Esses tempos são amostras de smoke, não percentis de produção. RSS do servidor nativo não é RSS total do pool: faltam coordenador, supervisor, processo de adaptação, FFmpeg, page cache e tmpfs. O cgroup de 8 GiB do executor é compartilhado por todo o trabalho e não serve como medição de pico do pool. A CI executa o smoke Docker com teto de 1280 MiB/1 CPU; a VPS precisa do ensaio operacional completo.

### Reconhecimento real nas imagens da CI

No primeiro head publicado da [PR #221](https://github.com/wkarts/ARGWS-Connect-API/pull/221), `5c13ade99ff77af0b1c678c0e2b1c498666d4505`, os dois jobs nativos do [run 37676500195](https://github.com/wkarts/ARGWS-Connect-API/actions/runs/37676500195) concluíram com sucesso. O modelo e a amostra são os mesmos descritos acima; cada contêiner executou duas inferências no mesmo processo, com limite confirmado de 1280 MiB, uma CPU e swap adicional desabilitado.

| Medida do smoke Docker | AMD64 | ARM64 |
| --- | --- | --- |
| Primeira / segunda inferência | 2,918 s / 2,950 s | 11,217 s / 11,164 s |
| RTF | 0,265 / 0,268 | 1,020 / 1,015 |
| Pico de RSS nativo | 165328 KiB | 159224 KiB |
| Pico do cgroup do smoke | 212738048 bytes (202,88 MiB) | 216420352 bytes (206,39 MiB) |
| Pico de threads nativas | 4 | 4 |

Essa medição cobre o script de smoke e o servidor nativo. Não mede o conjunto coordenador/guardião/fila sob carga, nem a API e os provedores na VPS. Os [resultados AMD64](https://github.com/wkarts/ARGWS-Connect-API/actions/runs/37676500195/artifacts/11507575241) e [ARM64](https://github.com/wkarts/ARGWS-Connect-API/actions/runs/37676500195/artifacts/11506639023) foram preservados como artifacts. Os tempos entre arquiteturas refletem runners diferentes e não constituem comparação controlada de hardware.

## Testes e gates

Os testes adicionados/modificados incluem:

- execução persistente, processos bloqueados, interrupção, limpeza de descendentes e isolamento de credenciais;
- checkpoint, redelivery, resultado antigo, cancelamento durável, cotas e reconciliação;
- overflow, fontes limitadas, bucket permitido e ausência de áudio no envelope AMQP;
- corrupção/reparo e recuperação de instalação interrompida;
- prontidão, progresso indeterminado, polling, Retry-After e prazo do Manager;
- contratos dos dez deployments, Fersoft, canário e orçamento agregado;
- integração opcional SQL/RabbitMQ e reconhecimento nativo, executados quando há infraestrutura real.

Comandos de verificação usados nesta entrega e na CI:

```bash
npm run db:generate
npm run lint:check
NODE_OPTIONS=--max-old-space-size=4096 npm run build
node --import tsx --test test/transcription-service.test.ts test/speech-model-download.test.ts test/audio-message.test.ts
npm test --prefix transcription-worker
node --test manager/scripts/speech-status.test.mjs
npm run build --prefix manager
python3 test/compose-env-only-deployments.test.py
node --test tools/connect-deployer/test/index.test.cjs
npm run docs:generate
npm run docs:check
```

A compilação completa passou com heap de 4 GiB somente no comando de build. A primeira tentativa atingiu o heap de 2 GiB do compilador; isso não alterou limites ou configuração do runtime de produção. A verificação de escopo confirmou 253 caminhos nativos fora de fala com definições idênticas à base; OpenAPI Meta Compatible e AsyncAPI de eventos permaneceram byte a byte iguais. Também passaram os testes existentes de payload, roteamento Graph, templates e os 48 cenários de webhook Meta. A PR registra o resultado final de cada gate. Testes opt-in ignorados por falta de infraestrutura não contam como aprovados. Este executor não possui Docker, Cargo nem serviços PostgreSQL/MySQL/RabbitMQ. As integrações com esses serviços foram preparadas para runners próprios da CI; geração/validação de schema local não comprova comportamento transacional real.

O primeiro ciclo de CI levou a quatro ajustes restritos à integração de fala: os geradores passaram a preservar o opt-in fora do develop principal; os testes isolados do Manager passaram a carregar o helper real de Retry-After; o teste de rollback SQL passou a provocar uma violação real de unicidade na outbox; e as rotas passaram a receber do middleware o caminho temporário criado pelo servidor, sem obter esse caminho de `req.file`. A última correção é coberta por uploads com nomes/campos de caminho adulterados, mantendo os contratos HTTP. A instalação do Manager segue o comando já utilizado nos seus workflows, pois ele não versiona lockfile. O gate de upgrade reproduz as migrations históricas da base e exige que a migração de fala não introduza nenhum drift, conforme o [diagnóstico operacional](../guides/speech-worker-diagnostics.md).

## Homologação e promoção

A release permanece condicionada a corpus autorizado de pelo menos 50 áudios pt-BR, comparação com o modelo de referência, ensaio de 24 horas e pelo menos 100 jobs na VPS, falhas induzidas e observação de API/WhatsApp sob carga. A auditoria propõe medir WER/CER, RTF, p50/p95 de fila/resultado, cgroup/RSS/PSS, CPU, IO, reinícios e impacto na API. Defina os limiares antes de promover o canário.

Não houve merge, release ou alteração de infraestrutura por esta implementação. O procedimento de implantação, recuperação do backlog e rollback está no [diagnóstico operacional](../guides/speech-worker-diagnostics.md). O protocolo v2 não tem downgrade automático de jobs para o v1; preserve dados e mantenha fala desativada ao reverter o código antigo até reconciliar o histórico.
