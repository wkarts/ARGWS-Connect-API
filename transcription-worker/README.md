# ARGWS Connect|API — worker local de transcrição

O worker consome a fila `transcription.requested`, lê o áudio do prefixo privado do MinIO e publica o resultado em RabbitMQ. O reconhecimento é local, com Whisper via `@huggingface/transformers`; nenhum SDK, chave ou chamada à OpenAI é usado por este componente.

## Configuração mínima

```dotenv
TRANSCRIPTION_ENABLED=true
TRANSCRIPTION_PROVIDER=local
TRANSCRIPTION_LOCAL_MODEL=Xenova/whisper-small
TRANSCRIPTION_LOCAL_DEVICE=cpu
TRANSCRIPTION_LOCAL_DTYPE=q8
TRANSCRIPTION_MODEL_CACHE_DIR=/home/node/.cache/huggingface
```

O primeiro job baixa o modelo configurado para o volume de cache. O volume deve ser persistente para que recriações do container não repitam o download.

## Contrato

- `POST /v1/transcriptions` continua aceitando `messageId` para áudios já recebidos por uma instância.
- `POST /v1/transcriptions/upload` recebe `multipart/form-data` com o campo `audio`, além de `language` opcional.
- `GET /v1/transcriptions` lista os jobs recentes.
- `GET /v1/transcriptions/:jobId` consulta o estado e o texto.
- `POST /v1/transcriptions/:jobId/retry` reenfileira uma falha.

Todos os endpoints exigem a autenticação administrativa já usada pelo Manager. O áudio é guardado no MinIO privado; não é exposto por URL pública.
