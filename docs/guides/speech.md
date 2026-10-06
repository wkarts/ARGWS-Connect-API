# Voz, ditado e transcrição

O subsistema de voz mantém os endpoints legados `/v1/transcriptions` e adiciona uma API para ditado e transcrição de mensagens. O processamento usa o worker local, FFmpeg, VAD e o modelo provisionado. O worker não baixa arquivos durante cada transcrição: a API instala a revisão fixada uma vez no volume persistente compartilhado, e os workers leem os arquivos localmente.

## Habilitar

Somente a stack principal `deploy/develop/` mantém `SPEECH_ENABLED=true` e o profile `transcription`. O profile inicia dois consumidores independentes: o worker de transcrição (`speech.transcription`) e o worker prioritário de ditado (`speech.dictation`). `TRANSCRIPTION_ENABLED` continua aceito como fallback legado nessa stack. `DICTATION_ENABLED=false` desativa apenas o ditado.

Todas as outras stacks, inclusive Fersoft develop e production, têm flags de voz desligadas no Compose e não incluem workers; adicionar o profile a um `.env` antigo não reativa o recurso. O Manager esconde transcrição, ditado e configurações de voz nesses deployments. Não copie o Compose principal de develop para uma VPS de produção.

Para interromper o consumo de RAM em uma VPS que já rodava os workers, atualize para o Compose desta release e execute `docker compose --env-file .env -f compose.yaml up -d --pull never --remove-orphans` após o `pull`. Verifique com `docker compose ps -a` se não restaram containers antigos dos workers. No CloudPanel, use `-f docker-compose.yml`; se o painel não remove órfãos, pare e remova somente os containers antigos de transcrição e ditado da stack. Preserve os volumes de banco, filas e `./models`; não execute `down -v`.

Variáveis principais:

| Variável | Padrão | Uso |
| --- | --- | --- |
| `SPEECH_ENABLED` | `false` | Habilita os endpoints e workers |
| `SPEECH_PROVIDER` | `local` | Provider local |
| `SPEECH_MODEL` | `Xenova/whisper-small` | Modelo configurado |
| `SPEECH_MODEL_PATH` | `/models/Xenova/whisper-small` | Caminho do modelo local verificado |
| `SPEECH_MODELS_HOST_PATH` | `./models` | Diretório persistente do host compartilhado pela API e pelos workers |
| `SPEECH_TRANSCRIPTION_QUEUE` | `speech.transcription` | Fila de transcrições longas |
| `SPEECH_DICTATION_QUEUE` | `speech.dictation` | Fila prioritária de ditado |
| `SPEECH_TRANSCRIPTION_REPLICAS` | `1` | Réplica inicial de transcrição no develop principal; cada réplica mantém seu próprio modelo |
| `SPEECH_WORKER_CONCURRENCY` | `1` | Prefetch de um job por processo; valores maiores são rejeitados |
| `SPEECH_GLOBAL_CONCURRENCY` | `1` | Total máximo de jobs admitidos entre transcrição e ditado no mesmo RabbitMQ e exchange; configure igualmente em todos os workers |
| `SPEECH_SHUTDOWN_GRACE_SECONDS` | `90` | Prazo para concluir a entrega ativa antes de cancelar a inferência e devolver o job |
| `SPEECH_MAX_DURATION_SECONDS` | `3600` | Limite real do PCM decodificado na transcrição, antes do modelo |
| `SPEECH_CHUNK_SECONDS` | `30` | Duração máxima de cada trecho |
| `SPEECH_STRIDE_SECONDS` | `5` | Sobreposição entre trechos |
| `SPEECH_HEARTBEAT_INTERVAL_SECONDS` | `5` | Frequência dos heartbeats |
| `SPEECH_INFERENCE_STALL_SECONDS` | `300` | Tempo máximo sem progresso do motor antes de reiniciar a thread e agendar retry |
| `SPEECH_JOB_STALE_AFTER` | `120` | Limite para considerar heartbeat parado |
| `SPEECH_MAX_ATTEMPTS` | `3` | Tentativas antes de registrar falha definitiva |
| `DICTATION_MAX_AUDIO_BYTES` | `5242880` | Limite do áudio enviado pelo navegador |
| `DICTATION_MAX_DURATION_SECONDS` | `300` | Duração máxima do ditado |
| `DICTATION_AUDIO_RETENTION_MINUTES` | `5` | Tempo máximo de áudio inline aguardando na fila |
| `TRANSCRIPTION_SOURCE_RETENTION_SECONDS` | `2592000` | Retenção de uploads privados em MinIO |

Os ditados são enviados inline pela fila prioritária e não criam objetos de áudio em MinIO. A fila descarta mensagens não atendidas após o prazo configurado; o watchdog marca os jobs expirados como falha. Uploads longos são armazenados em MinIO privado; o áudio de origem é removido após a retenção e o resultado do job permanece.

Cada réplica mantém seu próprio modelo carregado e consome um job por vez. O padrão no develop é uma réplica de transcrição e uma de ditado; a reserva global no RabbitMQ admite apenas **um job de inferência** entre as duas, incluindo a preparação do áudio. O ditado tem fila própria, mas a reserva não garante preempção ou ordem estrita entre modos. Prefetch continua em um por processo: um job aguardando capacidade aparece como `processing`/`waiting_for_capacity` e recebe heartbeat. O áudio PCM fica temporariamente em `/tmp` e é lido por trechos; o limite de 4 GiB por worker continua e precisa de validação com o modelo real. Amplie a capacidade somente após medir o RSS dos modelos residentes, pico de inferência, FFmpeg e outros processos da VPS.

O diagnóstico da API reutiliza a conexão RabbitMQ aberta. Um erro transitório no banco fecha o canal de resultados e devolve a mensagem ainda não confirmada para processamento após a reconexão. Em um retry atrasado, o job permanece com estágio `retrying` até a próxima tentativa; o watchdog respeita o atraso. Um heartbeat vencido passa a `awaiting_redelivery`, sem publicar uma segunda cópia: o RabbitMQ recupera a entrega original após a perda do canal. Se não houver retomada no período seguinte, o estado passa a `failed` com `WORKER_HEARTBEAT_EXPIRED`; o retry manual desse estado fica bloqueado porque a entrega original pode ainda existir. O limite `SPEECH_MAX_ATTEMPTS` cobre retries publicados pelo worker e entregas repetidas após falhas abruptas pelo cabeçalho `x-delivery-count`. `attempts` representa as tentativas publicadas; o contador de redelivery fica nos logs. Retry manual é aceito para outras falhas finais de transcrição cujo áudio ainda esteja disponível; ditado precisa ser gravado novamente.

Ao parar, o consumidor cancela novas entregas, aguarda até 90 segundos o trabalho ativo, depois interrompe a thread e devolve a mensagem ainda não confirmada. O Compose concede 105 segundos antes de encerrar o container. A API aplica resultados por comparação de status e tentativa; uma conclusão repetida não altera um job terminal. Consulte o [diagnóstico operacional dos workers](speech-worker-diagnostics.md) para medições, limites e atualização segura.

Os sinais de cancelamento usam um canal independente daquele que processa áudio. Cada réplica recebe o evento, inclusive quando outra está ocupada. O endpoint de saúde informa consumidores registrados, mas a prova de operação é observar heartbeats e jobs terminando como `completed` ou `failed`; consumidor registrado sozinho não comprova que a inferência avança.

## Baixar e manter o modelo

Ao iniciar com voz habilitada na stack principal de develop, a API confere o volume e baixa automaticamente o modelo se ele ainda não estiver instalado. Com voz desabilitada, a API não inicia esse download. O pacote q8 do `Xenova/whisper-small` tem aproximadamente 250 MB; a API baixa uma revisão fixada da Hugging Face, verifica SHA-256 e grava os arquivos em `./models` por padrão. A tela **Gerenciador → Transcrição de áudio**, disponível somente no develop principal, mostra o progresso e permite iniciar ou repetir o download manualmente.

O mesmo diretório do host é montado como `/models` com leitura e escrita na API e somente leitura nos workers. Depois da primeira instalação, transcrição e ditado carregam o modelo desse volume; reiniciar ou atualizar os containers reutiliza os arquivos sem baixar os pesos novamente. Preserve `./models` entre implantações. Os pesos não fazem parte da imagem GHCR e não são armazenados em `/tmp`.

O resultado do ditado contém somente texto, então o worker não calcula timestamps para esse caminho curto. O upload de transcrição continua produzindo segmentos temporizados. O navegador interrompe somente gravações sem trechos capturados ou com zero bytes; uma gravação curta que contenha dados segue para o worker.

Se uma transcrição for enviada antes de o download terminar, a API pede para tentar novamente quando o modelo estiver pronto. O arquivo selecionado na tela de transcrição é mantido; no ditado pelo microfone, o áudio capturado fica disponível no botão de nova tentativa enquanto o modelo baixa.

O provisionamento manual continua disponível para ambientes sem acesso à Internet. Copie os arquivos compatíveis para o diretório do host e gere o manifesto SHA-256:

Gere o manifesto SHA-256 antes de subir os workers:

```bash
node transcription-worker/scripts/create-model-manifest.cjs ./models/Xenova/whisper-small
```

Exemplo de `.env`:

```dotenv
SPEECH_MODELS_HOST_PATH=./models
SPEECH_MODEL_PATH=/models/Xenova/whisper-small
SPEECH_MODEL=Xenova/whisper-small
```

O worker valida o manifesto e todos os hashes antes do warm-up. Sem manifesto, com checksum inválido ou sem modelo compatível, o worker não fica pronto. Enquanto o download gerenciado termina, os workers aguardam o modelo no volume compartilhado. O Transformers.js documenta o carregamento local e a desativação de modelos remotos em sua [referência de ambiente](https://huggingface.co/docs/transformers.js/v3.8.1/api/env).

O endpoint `GET /v1/speech/models` informa instalação, progresso e prontidão do modelo. `POST /v1/speech/models/{modelId}/download` inicia o download do modelo configurado. A troca de modelo continua exigindo provisionar arquivos compatíveis, atualizar `SPEECH_MODEL`/`SPEECH_MODEL_PATH` e reiniciar os workers.

## API

Todos os endpoints usam o header `apikey`.

| Método e caminho | Descrição |
| --- | --- |
| `GET /v1/speech/live` | Liveness da API |
| `GET /v1/speech/ready` | Readiness de pelo menos um worker |
| `GET /v1/speech/health` | Estado das filas, modelo e contagens |
| `GET /v1/speech/models` | Modelo configurado e progresso de instalação |
| `POST /v1/speech/models/{modelId}/download` | Inicia ou consulta o download gerenciado do modelo |
| `POST /v1/speech/models/{modelId}/activate` | Confirma o modelo já configurado |
| `POST /v1/speech/dictation` | Recebe áudio curto em `multipart/form-data`, campo `audio` |
| `GET /v1/speech/dictation/{jobId}` | Lê estado e resultado do ditado |
| `POST /v1/speech/dictation/{jobId}/cancel` | Cancela o ditado |
| `POST /v1/speech/transcriptions` | Recebe JSON com `messageId` ou upload multipart |
| `POST /v1/speech/transcriptions/upload` | Alias multipart para upload |
| `GET /v1/speech/transcriptions` | Lista jobs recentes |
| `GET /v1/speech/transcriptions/{jobId}` | Lê estado e resultado |
| `POST /v1/speech/transcriptions/{jobId}/cancel` | Cancela o job |
| `POST /v1/speech/transcriptions/{jobId}/retry` | Reenfileira job elegível |
| `DELETE /v1/speech/transcriptions/{jobId}` | Remove o resultado sem apagar a mídia original da mensagem |

Os jobs têm `mode`, `sourceType`, estágio, percentual real, duração processada, heartbeat, tentativas, hash, idempotency key e resultado. A deduplicação usa mensagem, chave de idempotência e hash do áudio com modelo e idioma. O Manager acompanha o ditado por polling e insere o texto no campo ativo; na conversa, a ação “Transcrever áudio” guarda o resultado no mesmo job e permite mostrá-lo novamente após recarregar a página.

## Limites atuais

No develop principal, o Manager oferece transcrição manual de mensagens de áudio. O VAD reduz o trabalho ao selecionar trechos com atividade de voz, mas não bloqueia sozinho uma gravação: se nenhum trecho superar o limiar de energia, o worker envia o áudio decodificado inteiro ao Whisper, o que permite reconhecer fala capturada em volume baixo. O job só retorna `NO_SPEECH` depois que o modelo também não reconhece texto. No navegador, somente gravações sem dados capturados ou com zero bytes são interrompidas; áudios curtos com conteúdo seguem para processamento.

A transcrição automática de mensagens recebidas, controles de preferência por instância e publicação de `speech.transcription.completed` em Webhooks/flows ainda precisam de integração específica; os endpoints e os dados persistidos já podem ser usados como base para essa etapa.
