# Diagnóstico e operação dos workers de áudio

## Loop de reinício na inicialização do develop (07/10/2026)

Os logs do develop mostram tanto as réplicas de transcrição quanto o ditado saindo com código 1 após `TypeError: Cannot read properties of null (reading 'jobId')` em `InferenceClient.onMessage`. A thread publica `speech_inference_memory` na fase `before_model`, sem identificador de job; o consumidor comparava `this.active?.id` (indefinido quando não há job) com `message.id` (também indefinido) e, por isso, tentava acessar `this.active.jobId` quando `this.active` era `null`. A correção só associa a amostra a um job quando existe uma execução ativa e o identificador da mensagem corresponde a ela. Amostras de inicialização e ociosidade continuam disponíveis sem `jobId`.

Esse encerramento acontece antes do warm-up do modelo; os logs apresentados registram cerca de 75 MiB de RSS nessa fase e não atribuem esse loop a OOM. Isso não esclarece os OOMs históricos da VPS Fersoft, que continuam exigindo correlação própria. A captura do Dockge também mostra duas réplicas de transcrição, enquanto o Compose atual usa `SPEECH_TRANSCRIPTION_REPLICAS=1` por padrão: confira o valor efetivo no `.env`, overrides e escala do painel para manter a capacidade conservadora.

Após a imagem corrigida estar disponível no develop principal, recrie somente os serviços `transcription-worker-argws-connect-develop` e `speech-dictation-worker-argws-connect-develop`. Verifique nos logs `before_model`, `after_model`, ausência do `TypeError`, prontidão do modelo e contagem de reinícios estável; então processe um job curto de cada modo e confirme resultado e métricas vinculadas ao `jobId`. Preserve RabbitMQ, banco, MinIO e modelos; não execute `down -v`. A nova release também publica o worker estável para transcrição nos demais deploys; ditado continua limitado ao develop principal.

## Amostras após correção do warm-up (07/10/2026)

Os logs posteriores à PR #216 registram `before_model` perto de 75 MiB, `after_model` com RSS de 2.731.515.904 bytes no worker de transcrição e 2.669.789.184 bytes no de ditado, seguidos de prontidão de ambos. O `TypeError` de inicialização não reapareceu nessas amostras. São medições de partida, sem prova de inferência concluída, pico sob carga ou estabilidade prolongada. A troca de motor ou de modelo exigirá medição comparável e teste de precisão em áudio real em português.

### Opção de motor mais leve

O worker atual mantém uma única pipeline Transformers.js com `Xenova/whisper-small` q8 por processo; reduzir as réplicas evita modelos duplicados dentro da mesma stack. `whisper.cpp` oferece modelos multilíngues `tiny`, `base` e `small` e quantização, com estimativas publicadas de memória para o motor que não incluem o nosso Node, FFmpeg, buffers, tmpfs e filas. `faster-whisper` int8 também tem medições publicadas menores que a execução fp32 em CPU em um benchmark específico. Consulte [whisper.cpp](https://github.com/ggml-org/whisper.cpp#memory-usage) e [faster-whisper](https://github.com/SYSTRAN/faster-whisper#benchmark).

Esta release mantém o motor atual para preservar contratos e permitir o retorno da transcrição sem introduzir outro pipeline não ensaiado. Para trocar, primeiro compare o mesmo conjunto de áudios em português (curtos, longos, ruído e sem fala) em execução isolada: RSS antes/depois, pico, duração, precisão, cancelamento e recuperação do job. A API atualmente baixa uma revisão fixada somente de `Xenova/whisper-small`; configurar apenas `SPEECH_MODEL` para outro modelo não provisiona seus pesos nem garante que o worker fique pronto. Uma migração de motor exigirá provisionamento verificado, integração e testes de regressão.

## Evidências disponíveis em 06/10/2026

O laudo da VPS Fersoft traz duas amostras às 09:26:51 e 09:27:56 (UTC−3), com 65 segundos de intervalo. O host tinha 6 vCPU e 15,61 GiB de RAM. As duas coletas registraram, respectivamente, 2,329/2,328 GiB no ditado, 2,298/2,297 GiB na primeira réplica de transcrição e 1,607/0,990 GiB na segunda. O conjunto passou de 6,234 para 5,615 GiB. A segunda réplica teve dois reinícios (62 → 64) e mudou de PID; o contador de mortes por OOM no host passou de 260 para 262. As amostras **não** demonstram vazamento nem provam que as vítimas contemporâneas do OOM foram os workers. Não foram fornecidos logs de saída, eventos do cgroup ou IDs das vítimas contemporâneas.

Os ZIPs de stacks anteriores às PRs #213/#214 contêm Compose e `.env`, não logs. Na Fersoft antiga havia serviços de ditado e duas réplicas de transcrição com limite individual de 4 GiB, mesmo com `SPEECH_ENABLED=false` no `.env` e sem o profile `transcription` na lista usual. O `.env` antigo tinha `DICTATION_ENABLED=flase` e `MANAGER_FEATURE_TRANSCRIPTION=true`. Containers já criados, um deploy anterior com profile explícito ou órfãos poderiam permanecer vivos; a causa exata da permanência deles exige `docker inspect`/histórico do deploy. A produção padrão antiga tinha flags de voz habilitadas, profile e duas réplicas. A release 1.2.1 retirou os serviços e forçou as flags para `false`; a nova release introduz apenas uma réplica de transcrição em cada stack.

## Mecanismos confirmados no código

| Mecanismo anterior | Efeito demonstrável | Mudança |
| --- | --- | --- |
| Uma pipeline Whisper q8 por processo, mantida em singleton na thread | Três processos podem manter três modelos residentes mesmo ociosos; 4 GiB por container não limita o conjunto | Develop inicia uma réplica de transcrição e uma de ditado; uma reserva RabbitMQ limita a uma inferência global inicialmente |
| FFmpeg acumulava stdout em `Buffer[]`, concatenava em novo `Buffer` e copiava para `Float32Array` | Pelo menos três representações do PCM inteiro coexistiam no pico; 1 hora mono 16 kHz f32 representa ~219,7 MiB por cópia | FFmpeg grava PCM em arquivo temporário com backpressure; VAD lê quadros e Whisper recebe trechos limitados; limite de duração é verificado durante a decodificação |
| Watchdog da API republicava jobs `processing` quando o heartbeat envelhecia | A entrega original ainda poderia estar não confirmada; o ditado republicado perderia o payload inline | Estado `awaiting_redelivery`, sem republicação; a entrega original volta pelo broker quando o canal se fecha, ou termina em falha identificável após novo prazo |
| Retry do worker serializava o job normalizado sem o objeto `source` | A próxima entrega falhava na validação e não podia voltar ao processamento; no ditado, duração de retenção também não era preservada | Retry monta novamente o contrato da fila, preserva `source`, áudio inline e data de entrada; teste normaliza a mensagem da segunda tentativa |
| Encerramento fechava a thread e os canais imediatamente | Entregas em andamento precisavam da recuperação abrupta do broker; limpeza e confirmação não eram aguardadas | Cancelamento do consumidor, espera limitada pelo job ativo e `nack` para devolver entrega interrompida; timeout Compose de 105 s |
| Inicialização com manifesto presente e modelo inválido | Falha de warm-up reiniciava o container por `on-failure`, repetindo o carregamento | O worker permanece sem prontidão e espera mudança do manifesto antes de tentar novamente; uma falha inicial de conexão RabbitMQ usa reconexão |

Não há prova de qual mecanismo causou os dois reinícios da réplica 2. Também não há medição pós-correção com modelo real. O limite de 4 GiB permanece até medir o pico: `--max-old-space-size` não cobriria memória nativa do modelo ou do FFmpeg.

## Configuração efetiva no develop principal

| Configuração | Padrão | Efeito |
| --- | --- | --- |
| `SPEECH_TRANSCRIPTION_REPLICAS` | `1` | Uma pipeline de transcrição residente; ditado mantém outra |
| `SPEECH_WORKER_CONCURRENCY` | `1` | Prefetch por processo; valores maiores falham na validação |
| `SPEECH_GLOBAL_CONCURRENCY` | `1` | Vagas exclusivas compartilhadas pelo mesmo exchange RabbitMQ para os dois modos; todas as réplicas devem usar o mesmo valor |
| `SPEECH_MAX_DURATION_SECONDS` | `3600` | PCM de transcrição acima do limite falha com `AUDIO_TOO_LONG` |
| `DICTATION_MAX_DURATION_SECONDS` | `300` | O worker valida o áudio decodificado, independentemente da duração informada pelo cliente |
| `SPEECH_SHUTDOWN_GRACE_SECONDS` | `90` | Conclusão voluntária antes de interromper e devolver a entrega |
| `SPEECH_MAX_ATTEMPTS` | `3` | Limita retries e redeliveries por falhas de processo observadas em quorum queues |
| `SPEECH_JOB_STALE_AFTER` | `120` | Prazo após o último heartbeat para começar a aguardar redelivery; o estágio `retrying` respeita antes seu atraso |

A vaga é representada por uma fila exclusiva e efêmera cujo nome deriva do exchange e do índice. Uma conexão RabbitMQ a mantém durante o job; a perda da conexão interrompe a inferência e fecha o canal do job. A conexão fecha para liberar a vaga. Essa solução usa o broker existente; requer que os workers compartilhem broker, vhost, exchange e valor de concorrência. Uma vaga controla inferência, mas não elimina o segundo modelo residente. A fila de ditado continua separada, sem prioridade estrita na disputa pela vaga.

O Compose monta `/tmp` como tmpfs de 1 GiB: o PCM gravado ali continua consumindo memória contabilizada pelo cgroup, embora deixe de ocupar várias cópias no heap e nos buffers do Node. Uma hora decodificada ocupa aproximadamente 219,7 MiB desse tmpfs. Compare `memory.current`/`docker stats` e RSS para verificar a economia real; ampliar o limite de duração exige rever tamanho do tmpfs e orçamento do host.

## Métricas e validação

O log estruturado `speech_memory` registra `workerId`, `jobId`, tentativa, jobs ativos, RSS, `heapUsed`, `heapTotal`, `external`, `arrayBuffers`, tempo do job e pico observado em: antes/depois do modelo, recebimento, admissão, a cada 5 segundos durante trabalho, conclusão e ociosidade a cada 60 segundos. `speech_inference_memory` traz as medidas da thread e RSS do FFmpeg em `/proc/<pid>/status` durante a decodificação. RSS do processo inclui a thread; RSS do FFmpeg é separado. A amostragem não captura necessariamente o pico instantâneo entre intervalos. Nenhum log registra texto transcrito, áudio ou credenciais.

| Medida | Antes, VPS Fersoft | Depois, teste local | Depois, VPS com modelo real |
| --- | --- | --- | --- |
| Três workers, soma RSS | 6,234 → 5,615 GiB nas duas amostras | Não executados com modelo | Pendente |
| Reinícios da réplica 2 em 65 s | 2; OOM host +2, vítima não identificada | Sem Docker/VPS para correlação | Pendente |
| PCM mono 16 kHz f32 de 65 s | Antes exigia três cópias completas, ~11,9 MiB juntas | Teste verificou arquivo de 4.160.000 bytes, leitura em trechos de até 480.000 amostras e limpeza | Pendente |
| RSS do processo em decodificação sintética de 65 s | Não medido isoladamente antes | 37,74 MiB antes; 42,49 MiB maior amostra durante; 42,74 MiB após (processo sem modelo, GC explícito, amostra a cada 5 ms) | Pendente |
| Inferências simultâneas | Até 3 pelo Compose antigo | Reserva global testada com dois clientes simulados: máximo 1 | Pendente em broker real |

O FFmpeg dessa amostra curta encerrou antes da primeira coleta de RSS do subprocesso, portanto o pico do subprocesso é desconhecido. O RSS após a operação excedeu a maior amostra durante por causa do intervalo de amostragem; esses valores não demonstram um patamar estável nem o consumo de Whisper.

Para validar no develop com dados seguros, faça uma janela de pelo menos 60 minutos e anote quantidade/duração de jobs curtos, longos, inválidos, sem fala, ditado e cancelamentos. Compare `docker stats`, `docker inspect --format '{{.State.OOMKilled}} {{.State.ExitCode}} {{.RestartCount}}' <container>` e `docker logs --since 1h <container>` com os registros `speech_memory`, `speech_inference_memory`, estado de `/v1/speech/health` e jobs no Manager. Verifique RSS na partida, durante lotes, após término, após ociosidade, FFmpeg, soma de todos os containers, memória livre do host e `memory.events` do cgroup. Registre volume, duração, p95/pico e número de reinícios antes de ampliar capacidade. Teste SIGTERM em trabalho ativo, `docker kill --signal=KILL` num ambiente isolado, indisponibilidade do motor, redelivery, TTL do ditado e ausência de publicação duplicada. Um teste de unidade com pipeline simulada não substitui esse ensaio.

Para esclarecer os reinícios antigos, obtenha logs com timestamps imediatamente anteriores a cada encerramento, `docker inspect` com `State.ExitCode`, `State.Error`, `State.OOMKilled`, `RestartCount` e container ID da época, `docker events`, `journalctl -k` do intervalo e `memory.events` do cgroup correspondente. Correlacione jobId, `x-delivery-count` e tentativas. Não atribua IDs históricos de OOM a containers atuais.

## Atualização sem perder dados

1. Preserve os volumes de banco, RabbitMQ, MinIO e `./models`. Verifique o orçamento por **host**: cada stack carrega o próprio modelo; uma vaga global em brokers separados não coordena as stacks.
2. Atualize o Compose da stack, a imagem da API e a imagem estável do worker. No `.env` efetivo inclua `transcription` em `COMPOSE_PROFILES`, habilite `SPEECH_ENABLED`, `TRANSCRIPTION_ENABLED`, `MANAGER_FEATURE_TRANSCRIPTION`, mantenha `DICTATION_ENABLED=false` nas produções, fixe uma réplica, concorrência global um e tmpfs de 1 GiB. Execute `docker compose --env-file .env -f compose.yaml pull` e `docker compose --env-file .env -f compose.yaml up -d --pull never --remove-orphans` no projeto correto. Confira `docker compose ps -a`; não execute `down -v`.
3. No develop principal, mantenha o worker de ditado e sua flag apenas se houver margem de RAM. Aplique as migrations de `TranscriptionJob.workerId`, atualize API e workers juntos. Confira que o modelo foi instalado e que os containers não estão reiniciando antes de ampliar carga.
4. Monitore jobs `queued`, `waiting_for_capacity`, `retrying`, `awaiting_redelivery`, `completed`, `cancelled` e `failed`. Para um job de transcrição terminal com áudio persistente, o retry manual é possível; no ditado, solicite nova gravação. Não delete volumes nem republique mensagens brutas para resolver filas antigas.

Permanecem pendentes o ensaio sustentado com Whisper real, uma medição de RSS antes/depois no mesmo hardware, a confirmação das vítimas do OOM e os testes de recuperação e prioridade em broker real. A habilitação da transcrição em produção requer observar a soma de memória de todas as stacks do host e o resultado efetivo dos jobs.
