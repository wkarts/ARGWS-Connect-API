# Voz, ditado e transcrição

O subsistema de voz mantém os endpoints legados `/v1/transcriptions` e adiciona uma API para ditado e transcrição de mensagens. O processamento usa o worker local, FFmpeg, VAD e o modelo provisionado. O worker não baixa arquivos durante cada transcrição: a API instala a revisão fixada uma vez no volume persistente compartilhado, e os workers leem os arquivos localmente.

## Habilitar

Defina `SPEECH_ENABLED=true` e inclua o profile `transcription` no Compose. O profile inicia dois consumidores independentes: o worker de transcrição (`speech.transcription`) e o worker prioritário de ditado (`speech.dictation`). `TRANSCRIPTION_ENABLED` continua aceito como fallback para instalações antigas. `DICTATION_ENABLED=false` desativa apenas o ditado.

O exemplo `deploy/develop/env.example` já inclui o profile. Em outras stacks, acrescente `transcription` a `COMPOSE_PROFILES` antes de recriar os serviços.

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
| `SPEECH_TRANSCRIPTION_REPLICAS` | `2` | Processos de transcrição em paralelo no Compose; ajuste conforme CPU e memória disponíveis |
| `SPEECH_WORKER_CONCURRENCY` | `1` | Um job por processo; aumente réplicas para processar simultaneamente |
| `SPEECH_CHUNK_SECONDS` | `30` | Duração máxima de cada trecho |
| `SPEECH_STRIDE_SECONDS` | `5` | Sobreposição entre trechos |
| `SPEECH_HEARTBEAT_INTERVAL_SECONDS` | `5` | Frequência dos heartbeats |
| `SPEECH_JOB_STALE_AFTER` | `120` | Limite para considerar heartbeat parado |
| `DICTATION_MAX_AUDIO_BYTES` | `5242880` | Limite do áudio enviado pelo navegador |
| `DICTATION_MAX_DURATION_SECONDS` | `300` | Duração máxima do ditado |
| `DICTATION_AUDIO_RETENTION_MINUTES` | `5` | Tempo máximo de áudio inline aguardando na fila |
| `TRANSCRIPTION_SOURCE_RETENTION_SECONDS` | `2592000` | Retenção de uploads privados em MinIO |

Os ditados são enviados inline pela fila prioritária e não criam objetos de áudio em MinIO. A fila descarta mensagens não atendidas após o prazo configurado; o watchdog marca os jobs expirados como falha. Uploads longos são armazenados em MinIO privado; o áudio de origem é removido após a retenção e o resultado do job permanece.

Cada réplica mantém seu próprio modelo carregado e consome um job por vez. A inferência executa numa thread separada da conexão RabbitMQ, permitindo que o heartbeat continue durante trechos síncronos do modelo. O padrão de duas réplicas permite dois áudios simultâneos; aumente `SPEECH_TRANSCRIPTION_REPLICAS` para mais paralelismo e dimensione CPU/memória por réplica. O ditado conserva sua fila prioritária própria. A velocidade depende da duração do áudio, do processador e do número de réplicas; jobs já reenfileirados pelo watchdog voltam a ser consumidos ao atualizar a stack.

## Baixar e manter o modelo

Ao iniciar, a API confere o volume e baixa automaticamente o modelo se ele ainda não estiver instalado. Isso também acontece depois de instalar ou atualizar a stack. O pacote q8 do `Xenova/whisper-small` tem aproximadamente 250 MB; a API baixa uma revisão fixada da Hugging Face, verifica SHA-256 e grava os arquivos em `./models` por padrão. A tela **Gerenciador → Transcrição de áudio** mostra o progresso e permite iniciar ou repetir o download manualmente.

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

O Manager oferece transcrição manual de mensagens de áudio. O VAD reduz o trabalho ao selecionar trechos com atividade de voz, mas não bloqueia sozinho uma gravação: se nenhum trecho superar o limiar de energia, o worker envia o áudio decodificado inteiro ao Whisper, o que permite reconhecer fala capturada em volume baixo. O job só retorna `NO_SPEECH` depois que o modelo também não reconhece texto. No navegador, somente gravações sem dados capturados ou com zero bytes são interrompidas; áudios curtos com conteúdo seguem para processamento.

A transcrição automática de mensagens recebidas, controles de preferência por instância e publicação de `speech.transcription.completed` em Webhooks/flows ainda precisam de integração específica; os endpoints e os dados persistidos já podem ser usados como base para essa etapa.
