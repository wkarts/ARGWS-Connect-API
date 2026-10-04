# Voz, ditado e transcrição

O subsistema de voz mantém os endpoints legados `/v1/transcriptions` e adiciona uma API para ditado e transcrição de mensagens. O processamento usa o worker local, FFmpeg, VAD e o modelo provisionado. O worker desabilita downloads remotos do Transformers.js.

## Habilitar

Defina `SPEECH_ENABLED=true` e inclua o profile `transcription` no Compose. O profile inicia dois consumidores independentes: o worker de transcrição (`speech.transcription`) e o worker prioritário de ditado (`speech.dictation`). `TRANSCRIPTION_ENABLED` continua aceito como fallback para instalações antigas. `DICTATION_ENABLED=false` desativa apenas o ditado.

O exemplo `deploy/develop/env.example` já inclui o profile. Em outras stacks, acrescente `transcription` a `COMPOSE_PROFILES` antes de recriar os serviços.

Variáveis principais:

| Variável | Padrão | Uso |
| --- | --- | --- |
| `SPEECH_ENABLED` | `false` | Habilita os endpoints e workers |
| `SPEECH_PROVIDER` | `local` | Provider local |
| `SPEECH_MODEL` | `Xenova/whisper-small` | Modelo configurado |
| `SPEECH_MODEL_PATH` | vazio | Caminho do modelo local verificado |
| `SPEECH_TRANSCRIPTION_QUEUE` | `speech.transcription` | Fila de transcrições longas |
| `SPEECH_DICTATION_QUEUE` | `speech.dictation` | Fila prioritária de ditado |
| `SPEECH_WORKER_CONCURRENCY` | `1` | Concorrência por worker |
| `SPEECH_CHUNK_SECONDS` | `30` | Duração máxima de cada trecho |
| `SPEECH_STRIDE_SECONDS` | `5` | Sobreposição entre trechos |
| `SPEECH_HEARTBEAT_INTERVAL_SECONDS` | `5` | Frequência dos heartbeats |
| `SPEECH_JOB_STALE_AFTER` | `120` | Limite para considerar heartbeat parado |
| `DICTATION_MAX_AUDIO_BYTES` | `5242880` | Limite do áudio enviado pelo navegador |
| `DICTATION_MAX_DURATION_SECONDS` | `300` | Duração máxima do ditado |
| `DICTATION_AUDIO_RETENTION_MINUTES` | `5` | Tempo máximo de áudio inline aguardando na fila |
| `TRANSCRIPTION_SOURCE_RETENTION_SECONDS` | `2592000` | Retenção de uploads privados em MinIO |

Os ditados são enviados inline pela fila prioritária e não criam objetos de áudio em MinIO. A fila descarta mensagens não atendidas após o prazo configurado; o watchdog marca os jobs expirados como falha. Uploads longos são armazenados em MinIO privado; o áudio de origem é removido após a retenção e o resultado do job permanece.

## Provisionar um modelo offline

Copie previamente os arquivos de modelo para um diretório local. Monte o diretório do host com `SPEECH_MODELS_HOST_PATH` e configure `SPEECH_MODEL_PATH` para a pasta que contém `config.json` e os arquivos do modelo. O caminho montado é somente leitura nos workers.

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

O worker valida o manifesto e todos os hashes antes do warm-up. Sem manifesto, com checksum inválido ou sem modelo compatível, o worker não fica pronto. O runtime não baixa arquivos de modelo. O Transformers.js documenta o carregamento de modelos por `env.localModelPath` e a desativação de modelos remotos em sua [referência de ambiente](https://huggingface.co/docs/transformers.js/v3.8.1/api/env).

O endpoint `GET /v1/speech/models` mostra o modelo configurado. A ativação pela API só confirma o mesmo modelo configurado; a troca de modelo requer provisionar os arquivos, atualizar `SPEECH_MODEL` e reiniciar os workers.

## API

Todos os endpoints usam o header `apikey`.

| Método e caminho | Descrição |
| --- | --- |
| `GET /v1/speech/live` | Liveness da API |
| `GET /v1/speech/ready` | Readiness de pelo menos um worker |
| `GET /v1/speech/health` | Estado das filas, modelo e contagens |
| `GET /v1/speech/models` | Modelo configurado |
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

O Manager oferece transcrição manual de mensagens de áudio. A transcrição automática de mensagens recebidas, controles de preferência por instância e publicação de `speech.transcription.completed` em Webhooks/flows ainda precisam de integração específica; os endpoints e os dados persistidos já podem ser usados como base para essa etapa.
