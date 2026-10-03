# ARGWS Connect|API — worker local de transcrição

O worker consome a fila `transcription.requested`, lê o áudio do prefixo privado do MinIO e publica o resultado em RabbitMQ. O reconhecimento é local, com Whisper via `@huggingface/transformers`; nenhum SDK, chave ou chamada à OpenAI é usado por este componente.

## Configuração mínima

```dotenv
TRANSCRIPTION_ENABLED=true
TRANSCRIPTION_PROVIDER=local
TRANSCRIPTION_LOCAL_MODEL=Xenova/whisper-small
TRANSCRIPTION_LOCAL_DEVICE=cpu
TRANSCRIPTION_LOCAL_DTYPE=q8
TRANSCRIPTION_MODEL_CACHE_DIR=/tmp/argws-connect-transcription-model-cache
TRANSCRIPTION_MODEL_STORAGE_PREFIX=transcription-models
TRANSCRIPTION_SOURCE_RETENTION_SECONDS=86400
TRANSCRIPTION_SOURCE_CLEANUP_INTERVAL_SECONDS=900
```

O primeiro job restaura o modelo configurado do bucket S3/MinIO da aplicação
para o diretório temporário `TRANSCRIPTION_MODEL_CACHE_DIR` dentro do worker.
Se ainda não existir no bucket, o Transformers.js baixa o modelo e o worker
persiste o cache no mesmo bucket. Não há bind mount de
`./volumes/transcription-models`, serviço de init ou dependência de diretório do
host; recriar o container só refaz o staging temporário.

Os áudios enviados ficam no MinIO privado da aplicação; o estado e o resultado
textual do job continuam no banco da Connect|API.
Somente uploads diretos da API, no prefixo `argws-connect-api/transcriptions/`,
são temporários. Por padrão, o áudio e o registro/resultado de jobs terminais
(`completed`/`failed`) são removidos após 24 horas; jobs em processamento ficam
protegidos. Mídia e jobs referenciados por `messageId` pertencem à instância e
nunca são removidos por essa rotina.

`TRANSCRIPTION_SOURCE_RETENTION_SECONDS=0` desliga a limpeza automática. A
limpeza manual exige API key e confirmação explícita:

```bash
curl -X POST 'http://127.0.0.1:38080/v1/transcriptions/cleanup' \
  -H 'apikey: <API_KEY>' -H 'Content-Type: application/json' \
  -d '{"confirm":true,"olderThanSeconds":86400,"limit":250}'
```

O retorno informa quantos objetos e registros foram encontrados, removidos,
falharam e o total de bytes liberados. A rotina nunca varre ou remove outros
prefixos do bucket.

## Compose

O serviço pertence ao perfil opcional `transcription`. Em uma stack que já usa
outros perfis, acrescente `transcription` à lista existente:

```dotenv
COMPOSE_PROFILES=operations,extended,traccar,mysql,transcription
TRANSCRIPTION_ENABLED=true
TRANSCRIPTION_PROVIDER=local
```

O perfil controla a criação do container; `TRANSCRIPTION_ENABLED` controla o
consumo da fila dentro dele. Não configure `openai` como provider deste worker.
Por compatibilidade, o valor legado `openai` é normalizado para `local`, mas a
configuração recomendada é declarar `local` explicitamente.

Antes de testar no Manager, confirme que o perfil realmente foi ativado e que
o worker está consumindo a fila:

```bash
docker compose config --services | grep transcription
docker compose ps -a | grep transcription
```

Se a API responder `503` informando que o worker não está ativo, o perfil não
foi incluído no `COMPOSE_PROFILES` da stack ou o worker ainda não ficou
`healthy`. Recrie somente o `transcription-worker-*`; o modelo será restaurado
do bucket automaticamente.

O Manager também pode gravar pelo microfone usando `MediaRecorder`. A gravação
é limitada a 60 minutos, pode ser pausada, retomada ou descartada, e mostra o
nível RMS aproximado em decibéis em tempo real. O navegador costuma produzir
`audio/webm;codecs=opus` ou `video/webm`; a API normaliza esses MIME types para
`audio/webm` antes de publicar o job, e o worker usa `ffmpeg -vn` para extrair
o áudio mesmo quando o contêiner WebM declara uma trilha de vídeo auxiliar.

## Contrato

- `POST /v1/transcriptions` continua aceitando `messageId` para áudios já recebidos por uma instância.
- `POST /v1/transcriptions/upload` recebe `multipart/form-data` com o campo `audio`, além de `language` opcional.
- `GET /v1/transcriptions` lista os jobs recentes.
- `GET /v1/transcriptions/:jobId` consulta o estado e o texto.
- `POST /v1/transcriptions/:jobId/retry` reenfileira uma falha.
- `POST /v1/transcriptions/cleanup` remove uploads temporários expirados após `confirm=true`.

Todos os endpoints exigem a autenticação administrativa já usada pelo Manager. O áudio é guardado no MinIO privado; não é exposto por URL pública.
