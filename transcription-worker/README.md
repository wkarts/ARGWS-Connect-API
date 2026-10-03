# Connect|API Transcription Worker

Worker opcional para transcrição assíncrona de áudio. A imagem é publicada separadamente no GHCR:

`ghcr.io/wkarts/argws-connect-transcription-worker:develop` no canal de desenvolvimento e a mesma imagem recebe as tags da release estável.

O worker não abre portas. Ele consome `transcription.requested` do RabbitMQ, lê a mídia pelo prefixo privado `argws-connect-api/` no MinIO e publica `transcription.processing`, `transcription.completed` ou `transcription.failed`. A API mantém o estado dos jobs no PostgreSQL.

## Ativação

1. Defina `TRANSCRIPTION_ENABLED=true`, `OPENAI_API_KEY_GLOBAL` e as variáveis do RabbitMQ/MinIO no `.env`.
2. Inclua o perfil `transcription` em `COMPOSE_PROFILES`.
3. Suba a stack. Sem o perfil ou com a flag falsa, nada muda no fluxo existente.

A API expõe:

- `POST /v1/transcriptions` com `{"messageId":"..." }`;
- `GET /v1/transcriptions/:id`;
- `POST /v1/transcriptions/:id/retry`.

As rotas exigem a API key global no header `apikey`. O endpoint aceita somente mídia de áudio já persistida pelo Connect|API; não aceita caminhos arbitrários do MinIO.
