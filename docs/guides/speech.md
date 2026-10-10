> Atualização: o único runtime suportado para novas implantações é o serviço nativo opcional.
> Para ativação e migração, use [o guia atual](optional-transcription-service.md).
> Instruções antigas de workers/Transformers abaixo são histórico de compatibilidade, não implantação atual.

# Voz, ditado e transcrição

O subsistema de fala usa um **pool local persistente**, compartilhado por ditado e transcrição. A API recebe e controla os trabalhos; um coordenador consome as filas; o reconhecimento roda em outro processo, que mantém o modelo entre trabalhos e pode ser encerrado integralmente em caso de falha. Novos uploads e ditados usam armazenamento privado; a fila transporta somente metadados. Mídias de mensagens mantêm seu bucket de origem.

**Release em validação.** Os exemplos de produção, Fersoft, CloudPanel, Dockge, homologação e da raiz deixam a fala desativada por padrão. O develop principal e o exemplo de canário permitem o ensaio. O `.env` instalado sempre prevalece: atualizar o repositório não altera uma configuração já habilitada. O bloqueio de release existente deve permanecer até a homologação sustentada. Consulte a [matriz da correção](../reviews/speech-correction-2026-10-07.md) e o [procedimento operacional](speech-worker-diagnostics.md).

## Arquitetura e execução durável

A admissão verifica autenticação, disponibilidade e cotas antes de receber um upload. O multipart é gravado em arquivo temporário, com prazo e limite de bytes; não usa `multer.memoryStorage`. Novos ditados e uploads são enviados para um bucket MinIO/S3 dedicado e privado (`SPEECH_S3_BUCKET_NAME`; por padrão, bucket de mídia seguido de `-speech`). Uma política pública preexistente nesse destino impede a gravação, sem ser sobrescrita automaticamente. Áudios de mensagens reutilizam a fonte já persistida no bucket de origem; sua política de acesso permanece a da instalação.

O banco é a autoridade da execução. A criação do job e de sua **outbox** acontece na mesma transação. Um publicador entrega a referência às filas quorum `speech.transcription.v2` e `speech.dictation.v2`, com confirmação e `mandatory`; uma mensagem sem rota não é considerada publicada. A outbox permite retomar após queda da API sem depender de uma chamada HTTP aberta.

Antes de carregar o motor, o worker pede uma execução ao controle da API. Essa execução recebe `generation`, `executionId`, lease e prazo absoluto. Checkpoints, conclusão e falha só são aceitos se pertencerem à execução atual. O resultado é confirmado no SQL antes do ACK da entrega AMQP. Mensagens repetidas de uma geração antiga ou de um job terminal não iniciam reconhecimento.

O pool usa uma conexão AMQP reutilizada e uma reserva exclusiva de residência por slot. Com `SPEECH_GLOBAL_CONCURRENCY=1`, apenas o dono desse slot mantém um motor residente no mesmo broker/vhost/pool. O modelo permanece carregado durante a atividade e é descarregado depois de `SPEECH_MODEL_IDLE_TTL_SECONDS` sem uso. No modo `pool`, o coordenador continua dono do slot ocioso; workers excedentes ficam em espera. A reconexão ou parada libera a reserva.

Instalações com serviços separados `transcription` e `dictation` mantêm seus modos. Esses coordenadores ficam conectados e anunciam disponibilidade com o modelo verificado, mas só disputam residência quando recebem trabalho, com prefetch de uma entrega por consumidor. O dono da residência recebe um aviso interno de demanda e pode ceder depois da janela ativa ou quando ocioso. Essa cessão exige encerramento confirmado do motor, mantém a conexão AMQP e permite que a outra modalidade assuma antes de uma nova tentativa local. Os avisos têm tamanho e validade limitados; a fila exclusiva v2 continua sendo a autoridade da residência. Estar apto a receber trabalho com modelo frio não torna `engineReady` verdadeiro.

A decodificação FFmpeg e a inferência trabalham em janelas de até 30 segundos. O VAD agrupa a atividade dentro de cada janela; não cria uma chamada do modelo para cada pausa curta. A sobreposição é conciliada com o checkpoint. Um áudio longo devolve a vez entre janelas. O escalonador pondera ditado e transcrição em 3:1 e alterna as instâncias entre os trabalhos recebidos na janela limitada de prefetch. Não há preempção no meio de uma inferência nativa.

O heartbeat de controle renova a lease, mas **não equivale a progresso do reconhecimento**. `engineProgressAt` e `processedDurationMs` avançam com trabalho real. O prazo absoluto do job não é prorrogado por heartbeats. Sem duração total conhecida, o progresso é indeterminado; a conclusão vale 100%.

O cancelamento fica registrado no banco. O worker interrompe o grupo de processos do motor, confirma sua morte e só então libera a execução. Perda de lease ou de conexão de controle também encerra o motor. Um processo cuja morte não foi confirmada impede nova inferência naquele coordenador. Cancelar pode deixar a lease visível por alguns segundos; excluir a fonte nesse intervalo retorna `409` para permitir a parada segura.

## Motores e identidade do modelo

O catálogo permitido está em [`scripts/speech-models.json`](../../scripts/speech-models.json). A seleção deve ser igual na API e no worker. O perfil atual permanece explícito; não há troca automática por um modelo menor.

| Motor | `SPEECH_MODEL` | Formato e revisão | Perfil de memória inicial |
| --- | --- | --- | --- |
| `transformers` | `Xenova/whisper-small` | ONNX q8, `2d67713f236afa48a18992566e7647f6ca848e13` | Compatibilidade: teto de 4 GiB por pool |
| `whisper.cpp` | `whisper-base-q5_1` | GGML q5_1, `5359861c739e955e79d9a303bcbc70fb988958b1` | Canário: teto de 1280 MiB por pool |
| `whisper.cpp` | `whisper-small-q5_1` | GGML q5_1, mesma revisão fixada | Catálogo: referência inicial de 2048 MiB; requer ensaio próprio |

Esses valores são **orçamentos de configuração**, não medições universais de consumo. O teto do container inclui coordenador, motor, FFmpeg, cache e tmpfs. Não aplique o teto do modelo base ao perfil Transformers sem medir o conjunto.

O arquivo base q5_1 tem 59.707.625 bytes; o small q5_1 tem 190.085.487 bytes. Seus hashes SHA-256 estão fixados no catálogo. O binário whisper.cpp usa o commit `4979e04f5dcaccb36057e059bbaed8a2f5288315` (v1.8.2), build CPU sem CUDA. Em amd64, inclui variantes de CPU escolhidas pelo GGML conforme as instruções disponíveis; em arm64, usa ARMv8-a/NEON. O build e os detalhes de cgroups estão em [deploy/speech](../../deploy/speech/README.md).

`provider=local`, `requestedModel`, `effectiveModel`, `engine` e `modelRevision` distinguem solicitação e execução. `SPEECH_PROVIDER=openai` não é um apelido de local: configurações incompatíveis falham claramente. Um modelo/revisão diferente do motor residente não é atendido por fallback silencioso.

### Canário whisper.cpp no develop

Incorpore [`canary-whisper-cpp.env.example`](../../deploy/speech/canary-whisper-cpp.env.example) ao `.env` existente, preservando segredos, paths e outros perfis. Os campos essenciais são:

```dotenv
SPEECH_ENABLED=true
TRANSCRIPTION_ENABLED=true
DICTATION_ENABLED=true
MANAGER_FEATURE_TRANSCRIPTION=true
SPEECH_PROVIDER=local
SPEECH_ENGINE=whisper.cpp
SPEECH_WORKER_MODE=pool
SPEECH_MODEL=whisper-base-q5_1
SPEECH_MODEL_PATH=/models/whisper.cpp/base-q5_1
SPEECH_WHISPER_MODEL_FILE=/models/whisper.cpp/base-q5_1/ggml-base-q5_1.bin
SPEECH_WHISPER_MODEL_SHA256=422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898
SPEECH_GLOBAL_CONCURRENCY=1
SPEECH_INFERENCE_THREADS=1
SPEECH_INFERENCE_INTER_THREADS=1
SPEECH_SERVICE_MEMORY=1280m
SPEECH_SERVICE_CPUS=1.00
SPEECH_SERVICE_TMPFS_SIZE=128m
```

Inclua `transcription` em `COMPOSE_PROFILES` sem retirar os perfis das demais integrações. Há um único serviço de worker para os dois modos; os manifests fixam uma réplica para reconciliar instalações com o valor antigo `SPEECH_TRANSCRIPTION_REPLICAS=2`. O serviço separado de ditado não deve continuar ativo. API e worker precisam usar imagens da mesma revisão da correção.

### Orçamento agregado da VPS

O limite AMQP só abrange participantes do mesmo broker/vhost/pool. Duas stacks com brokers independentes ainda podem consumir seus tetos individuais ao mesmo tempo. Para limitar a soma, configure um cgroup pai comum em **todas** as stacks de fala do host, usando `SPEECH_CGROUP_PARENT` e o exemplo [connect-speech.slice](../../deploy/speech/connect-speech.slice.example). A documentação de [orçamento por host](../../deploy/speech/README.md#teto-agregado-para-stacks-no-mesmo-host) explica os requisitos do driver e a verificação.

A associação ao cgroup é opt-in. Um valor vazio mantém somente os limites por container. Reserve separadamente a memória da API, banco, RabbitMQ, MinIO, WhatsApp e sistema operacional.

## Provisionamento e reparo

O download automático no início é **opt-in**, por `SPEECH_MODEL_AUTO_PROVISION=true`. Sem essa opção, o administrador inicia o download pelo Manager ou pela API. Verificação SHA-256, transferência e reparo rodam em um processo supervisionado, separado do servidor HTTP. Consultas de status usam um fingerprint pequeno dos arquivos; uma mudança dispara nova verificação e retira a prontidão até ela terminar.

A API monta o volume persistente em leitura/escrita e o worker em somente leitura. O provisionador fixa a revisão remota, limita bytes e tempo, valida hashes, prepara uma pasta temporária e troca o diretório de forma controlada. A trava é compartilhada no volume, evitando downloads simultâneos entre réplicas. Um journal permite recuperar uma instalação interrompida e remover o estágio registrado, preservando o modelo anterior quando a troca não terminou.

No endpoint administrativo:

```http
POST /v1/speech/models/whisper-base-q5_1/download
apikey: SUA_CHAVE_ADMINISTRATIVA
Content-Type: application/json

{"force": true}
```

`force=true` permite reparar uma instalação corrompida. Para modelos com `/` no identificador, codifique o segmento de caminho, por exemplo `Xenova%2Fwhisper-small`. Somente o modelo configurado e permitido pode ser baixado por esse endpoint. `activate` confirma a configuração; trocar motor/modelo requer provisionar, alinhar as variáveis e reiniciar o pool. Faça essa troca depois de drenar os jobs que pedem o modelo anterior.

Também é possível provisionar no host ou em um container administrativo:

```bash
node scripts/speech-model-provision.cjs whisper-base-q5_1 ./models
node scripts/speech-model-provision.cjs whisper-base-q5_1 ./models --verify
```

Para um host sem acesso à internet, execute o provisionador em ambiente autorizado e transfira o diretório completo, incluindo `.speech-model-checksums.json`. Preserve a estrutura definida no catálogo. O worker não baixa pesos durante a inferência. A API aceita os diretórios do catálogo sob `SPEECH_MODELS_PATH` (padrão `/models`); um caminho arbitrário ou modelo fora do catálogo fica indisponível.

## Limites de admissão, armazenamento e execução

| Configuração | Padrão do código | Efeito |
| --- | --- | --- |
| `SPEECH_MAX_PENDING_JOBS` | 50 | Jobs ativos mais reservas de upload por pool |
| `SPEECH_MAX_PENDING_JOBS_PER_INSTANCE` | 5 | Limite por instância; administração sem instância usa escopo global próprio |
| `SPEECH_MAX_UPLOADS` / `SPEECH_MAX_UPLOADS_PER_INSTANCE` | 2 / 1 | Reservas de recepção simultânea no banco |
| `SPEECH_MAX_UPLOAD_BYTES` | 50 MiB | Soma dos bytes reservados para uploads em andamento |
| `TRANSCRIPTION_MAX_AUDIO_BYTES` / `DICTATION_MAX_AUDIO_BYTES` | 25 MiB / 5 MiB | Limite por arquivo |
| `SPEECH_MAX_PENDING_AUDIO_BYTES` / `..._PER_INSTANCE` | 1250 MiB / 125 MiB | Orçamento dos jobs ativos |
| `SPEECH_MAX_PENDING_AUDIO_SECONDS` / `..._PER_INSTANCE` | 180000 / 18000 s | Duração máxima reservada dos trabalhos pendentes |
| `SPEECH_UPLOAD_TIMEOUT_SECONDS` | 60 s | Prazo para receber o multipart |
| `SPEECH_UPLOAD_RESERVATION_SECONDS` | 180 s | Expiração da reserva, incluindo persistência |
| `SPEECH_QUEUE_MAX_JOBS` / `SPEECH_QUEUE_MAX_BYTES` | 50 / 8 MiB | Limites adicionais de cada fila quorum; overflow rejeita publicação |
| `SPEECH_POOL_PREFETCH` | 10 | Janela limitada total, dividida entre os consumidores dos dois modos |
| `SPEECH_DICTATION_WEIGHT` | 3 | Peso do ditado por rodada em relação à transcrição |
| `SPEECH_CHUNK_SECONDS` / `SPEECH_STRIDE_SECONDS` | 30 / 5 s | Janela máxima e sobreposição |
| `SPEECH_LEASE_SECONDS` / `SPEECH_HEARTBEAT_INTERVAL_SECONDS` | 30 / 5 s | Lease e frequência de supervisão |
| `SPEECH_CHUNK_DEADLINE_SECONDS` | 180 s | Prazo absoluto de uma operação no motor |
| `SPEECH_MODEL_WARMUP_TIMEOUT_SECONDS` | 300 s | Limite de carga e reconhecimento inicial; também sujeito ao prazo do job |
| `SPEECH_JOB_DEADLINE_SECONDS` / `DICTATION_JOB_DEADLINE_SECONDS` | 900 / 120 s | Prazo total desde a aceitação do job, incluindo fila |
| `TRANSCRIPTION_MAX_DURATION_SECONDS` / `DICTATION_MAX_DURATION_SECONDS` | 3600 / 60 s | Duração máxima real aceita pelo processamento |
| `SPEECH_MODEL_IDLE_TTL_SECONDS` | 300 s | Descarregamento do motor sem uso |
| `SPEECH_MAX_ATTEMPTS` | 3 | Tentativas automáticas limitadas; geração muda também ao ceder uma janela |
| `SPEECH_SOURCE_CACHE_MAX_BYTES` | 50 MiB | Cache local limitado de fontes comprimidas |

A reserva de duração é conservadora e usa o máximo permitido por job antes de conhecer o áudio. A duração declarada pelo cliente não autoriza exceder o limite real. O corpo JSON/form dos endpoints nativos `/v1/speech` e `/v1/transcriptions` tem limite de 64 KiB; áudio deve usar multipart.

O banco limita o conjunto de uploads entre réplicas da API. Os objetos privados usam nomes gerados pelo servidor. Ditado retém a fonte por cinco minutos (`DICTATION_AUDIO_RETENTION_MINUTES`); uploads de transcrição, por 30 dias (`TRANSCRIPTION_SOURCE_RETENTION_SECONDS`). A limpeza respeita execução/lease e usa consultas paginadas, mantendo resultados. Objetos cuja transferência falhou têm registro de reserva para recuperação. A DLQ tem limite próprio, retenção de um dia e não contém áudio inline. Esses prazos não substituem a política de retenção da instalação.

## API e isolamento de instância

Todos os endpoints usam `apikey`. Os caminhos globais `/v1/speech` e `/v1/transcriptions` exigem a chave administrativa. O prefixo `/v1/speech/instances/{instanceName}` permite a chave da instância correspondente e aplica o escopo às consultas, criações e mutações. Uma instância não acessa nem cancela o job de outra. Download e ativação de modelo continuam administrativos, inclusive quando acessados por um caminho escopado.

Para uploads administrativos associados a uma instância, prefira `X-Speech-Instance-Id`: permite reservar a cota da instância antes de receber o corpo. O campo multipart histórico `instanceId` continua aceito pelo administrador, com revalidação e associação atômica antes de gravar no S3. Uma identidade definida pela rota ou pelo header não pode ser substituída pelo corpo.

| Método e caminho relativo a `/v1/speech` | Resultado |
| --- | --- |
| `GET /live` | Liveness do processo HTTP |
| `GET /health` | Estado de controle, capacidades, modelo, fila e limites |
| `GET /ready?mode=all\|dictation\|transcription` | `200` somente com motor verificado e inferência inicial concluída no modo solicitado; caso contrário `503` |
| `GET /models` | Modelo configurado e estados `not_installed`, `verifying`, `downloading`, `ready`, `failed` ou `unavailable` |
| `POST /models/{modelId}/download` | Provisionamento ou reparo administrativo, corpo opcional `force` |
| `POST /models/{modelId}/activate` | Confirmação do modelo já configurado |
| `POST /dictation` | Multipart no campo `audio`; retorna `202` com identificador |
| `GET /dictation/{jobId}` / `POST /dictation/{jobId}/cancel` | Consulta e cancelamento de ditado |
| `POST /transcriptions` | JSON com `messageId` ou multipart com `audio` |
| `POST /transcriptions/upload` | Alias para multipart |
| `GET /transcriptions?limit=30` | Lista recente; máximo 100 |
| `GET /transcriptions/{jobId}` | Estado e resultado persistidos |
| `POST /transcriptions/{jobId}/cancel` | Cancelamento durável |
| `POST /transcriptions/{jobId}/retry` | Nova tentativa controlada de transcrição elegível |
| `DELETE /transcriptions/{jobId}` | Remove resultado e fonte de upload própria após encerrar execução; preserva mídia de mensagem |

Os endpoints legados de transcrição permanecem. `POST /v1/transcriptions/cleanup` exige `confirm=true`, aceita lote limitado e `cursor`, devolve `hasMore`/`nextCursor` e remove fontes expiradas, preservando resultados. A rotina de retenção continua mesmo quando novas submissões estão desativadas.

A saturação retorna `429` com `Retry-After`; indisponibilidade retorna `503`, também podendo informar espera. Violações de formato/tamanho usam `400`, `413` ou `415`; conflito de execução/modelo usa `409`; fonte expirada, `410`. Reutilize `Idempotency-Key` para a mesma operação lógica. A deduplicação por conteúdo considera escopo, modo, fonte, idioma, modelo, motor e revisão.

`/health` distingue `processAlive`, `brokerConnected`, `modelVerified`, `engineReady`, `acceptingJobs` e `lastSuccessfulInferenceAt`. Um pool frio com arquivos verificados pode aceitar seu primeiro trabalho e carregar o motor dentro do prazo desse job. `/ready` continua falso até o reconhecimento inicial; não use esse endpoint como condição circular que impeça o primeiro upload. A contagem de consumidores sozinha não prova prontidão.

## Manager e compatibilidade

O Manager mostra espera, preparação, carregamento, processamento por trechos, retomada e estado terminal. O polling desacelera quando não há mudança, quando a aba está oculta e conforme `Retry-After`. O ditado respeita o prazo informado pela API e permite nova gravação em falhas finais. Duração processada e heartbeat de supervisão são apresentados sem inventar avanço percentual.

Em **Configurações → Voz**, a disponibilidade de cada modo considera as capacidades
e os sinais de controle, além da prontidão do motor. **Disponível sob demanda**
significa que o coordenador pode receber o áudio e carregar o modelo quando houver
trabalho. Esse estado não afirma que o modelo está residente ou que uma transcrição
já terminou. O botão **Atualizar estado** refaz a consulta; uma falha na consulta não
mantém uma leitura anterior apresentada como atual.

O estado agregado `warming` também pode representar um coordenador frio e ocioso.
Quando as capacidades permitem admissão e não há trabalhos em processamento, o
Manager explica o carregamento sob demanda, sem anunciar uma inicialização em
andamento. Já `busy` indica trabalhos registrados como `processing`; a etapa,
`engineProgressAt`, `controlHeartbeatAt`, `leaseExpiresAt` e `deadlineAt` permitem
avaliar se uma execução está avançando. `createdAt` é a criação do registro e não
muda a cada nova tentativa.

O healthcheck Docker do worker acompanha seu coordenador e a conexão com a fila.
Arquivos do modelo instalados, contêiner saudável e capacidade de admissão são
verificações diferentes de uma inferência concluída. A validação funcional requer
um áudio curto que alcance `completed`, com texto correto e consumo acompanhado;
o ditado deve ser validado separadamente no campo de entrada que o utiliza.

Os contratos e fluxos de envio/recebimento ZAPO, Baileys e Meta Compatible permanecem preservados. A conversão de PTT e o sistema geral de logs/eventos não foram alterados nesta correção. O reconhecimento continua separado do envio de notas de voz. Consulte [Mensagens e mídia](messages.md#áudio-comum-e-nota-de-voz).

A fachada Graph mantém seu parser e payloads existentes. Quando chama o serviço de transcrição, recebe os limites de execução, cotas e fila com metadados; seus novos uploads usam o bucket privado, enquanto mídias de mensagens mantêm a origem; a reserva anterior ao recebimento do multipart aplica-se às rotas nativas de fala. Alterar o parser da fachada Graph ficou fora do escopo por orientação do responsável.

Transcrição automática de toda mensagem recebida e publicação de novos eventos de resultado em Webhooks/flows não fazem parte desta correção. O reconhecimento continua sendo solicitado explicitamente. Falhas criptográficas de sessão WhatsApp exigem investigação própria; esta mudança não apaga nem recria sessões.
