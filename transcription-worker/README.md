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

O primeiro job baixa o modelo configurado para o cache local. Na stack oficial, o
cache é um bind mount para `./volumes/transcription-models`, preparado pelo
serviço `transcription-volume-init`. Ele não é um volume nomeado e não é
apagado por recriação de containers nem por `docker compose down -v`; só é
removido se o diretório do host for apagado manualmente. O serviço de init cria
`./volumes/transcription-models/Xenova` e ajusta a permissão para o usuário do
worker antes do consumo da fila.

Os áudios enviados e os resultados continuam no MinIO privado da aplicação.
O MinIO não é usado como cache do modelo: o runtime local do Transformers.js
precisa de um diretório de arquivos para carregar os pesos com segurança e sem
refazer o download a cada job.

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

Todos os endpoints exigem a autenticação administrativa já usada pelo Manager. O áudio é guardado no MinIO privado; não é exposto por URL pública.
