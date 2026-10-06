# ARGWS Connect|API — worker local de transcrição

O worker consome a fila `transcription.requested`, lê o áudio do prefixo privado do MinIO e publica o resultado em RabbitMQ. O reconhecimento é local, com Whisper via `@huggingface/transformers`; nenhum SDK, chave ou chamada à OpenAI é usado por este componente.

## Configuração mínima

Este componente está temporariamente disponível apenas no Compose `deploy/develop/` principal. Produção, homologação, templates genéricos e os dois canais Fersoft estão desativados; não inicie o worker nessas VPS.

```dotenv
TRANSCRIPTION_ENABLED=true
TRANSCRIPTION_PROVIDER=local
TRANSCRIPTION_LOCAL_MODEL=Xenova/whisper-small
TRANSCRIPTION_LOCAL_DEVICE=cpu
TRANSCRIPTION_LOCAL_DTYPE=q8
SPEECH_MODEL_PATH=/models/Xenova/whisper-small
SPEECH_MODELS_HOST_PATH=./models
TRANSCRIPTION_SOURCE_RETENTION_SECONDS=86400
TRANSCRIPTION_SOURCE_CLEANUP_INTERVAL_SECONDS=900
```

Ao iniciar, a API baixa `Xenova/whisper-small` se ele ainda não estiver no
diretório persistente `./models`. A tela **Baixar modelo** no Gerenciador
permite iniciar ou repetir a instalação manualmente. Os workers montam o mesmo
volume somente para leitura em `/models`. O arquivo de imagem GHCR não inclui
os pesos. O worker aguarda o modelo no volume, valida o manifesto SHA-256 e
carrega a pipeline uma vez por processo. Jobs seguintes usam a mesma pipeline
em memória, e reiniciar ou atualizar containers reutiliza os arquivos locais.

O modelo q8 ocupa aproximadamente 250 MB. Acompanhe o primeiro download em
**Gerenciador → Transcrição de áudio** e envie novamente quando o modelo e o
worker estiverem prontos. No ditado pelo microfone, o Manager conserva o áudio
capturado para nova tentativa.

Para instalações sem acesso à Internet, copie manualmente os arquivos do
modelo para `./models/Xenova/whisper-small` e crie o manifesto com
```bash
node transcription-worker/scripts/create-model-manifest.cjs ./models/Xenova/whisper-small
```

Faça isso antes de iniciar os workers.

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

O serviço pertence ao perfil `transcription` do develop principal. Nesse
deployment, o exemplo já ativa o profile:

```dotenv
COMPOSE_PROFILES=operations,transcription
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

Se a API responder `503` informando que o modelo está baixando, aguarde a
conclusão em **Gerenciador → Transcrição de áudio** e tente novamente. Se o
worker continuar indisponível depois da instalação, confira se o perfil foi
incluído no `COMPOSE_PROFILES` e se ambos os workers montam o mesmo
`SPEECH_MODELS_HOST_PATH`.

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
- `GET /v1/transcriptions/health` informa consumidores, jobs na fila, idade do job mais antigo e `maxUploadBytes`; é somente leitura.
- `GET /v1/transcriptions/:jobId` consulta o estado e o texto.
- `POST /v1/transcriptions/:jobId/retry` reenfileira uma falha.
- `POST /v1/transcriptions/cleanup` remove uploads temporários expirados após `confirm=true`.

Todos os endpoints exigem a autenticação administrativa já usada pelo Manager. O áudio é guardado no MinIO privado; não é exposto por URL pública.

O Manager consulta até 100 jobs em uma única chamada por atualização. Jobs na fila mostram há quanto tempo aguardam; somente jobs `processing` sem heartbeat além de `TRANSCRIPTION_STALE_JOB_SECONDS` são recuperados automaticamente. A recuperação não republica jobs `queued`, porque RabbitMQ pode já ter entregue uma mensagem ainda sem confirmação. O limite de upload exibido no Manager vem de `TRANSCRIPTION_MAX_AUDIO_BYTES` informado pela API.
