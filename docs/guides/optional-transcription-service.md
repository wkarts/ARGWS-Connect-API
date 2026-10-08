# Serviço nativo opcional de transcrição

## Escopo e compatibilidade

Esta implementação adiciona a imagem `connect-transcription-service` e um overlay opt-in. A base já possui execução nativa persistente via `whisper.cpp`: por isso reutilizamos seu motor e seu protocolo durável, em vez de introduzir outra API Python, Vosk ou um novo contrato HTTP. Vosk **não foi integrado nesta alteração**. O código legado permanece para rollback; seus containers são escalados a zero ao aplicar o overlay.

O serviço é único por stack, compartilhado por todas as instâncias. Seu coordenador usa o protocolo v2 existente (RabbitMQ, outbox, claims, leases, gerações e checkpoints); o reconhecimento permanece isolado do processo HTTP. Os processos internos de supervisão e inferência são necessários para cancelar trabalho nativo com segurança e não constituem containers por tenant ou por áudio.

Nenhum provider, SDK, rota pública, schema, autenticação ou payload de envio/recebimento foi alterado. REST, Zapo, Baileys e Meta-compatible continuam usando as operações de fala existentes, exclusivamente quando solicitadas. Não há gateway de áudio obrigatório, chamada ASR nos envios normais, conversão automática para PTT, transcrição automática ou envio de mensagem ao concluir o ditado.

Os contratos de jobs, HTTP 202, cancelamento, retry, eventos, isolamento por instância, `workerId`, `workerReady` e health específico de fala permanecem. Não há migração de banco.

## Mudanças efetivas

- Imagem com grafo de dependências nativo: amqplib e MinIO, sem Transformers, ONNX Runtime ou distribuição CUDA. O binário `whisper-server` e o modelo GGML continuam fixados pelas revisões/checksums já usados no projeto. A imagem legada não é removida nem alterada.
- WAV PCM16 ou float32, mono/16 kHz, pode ser lido diretamente em janelas limitadas: sem FFmpeg e sem PCM temporário nesse caminho. Opus/OGG, WebM, MP3, AAC e demais formatos continuam usando a normalização FFmpeg existente, com limites e somente no módulo de fala. A mídia original não é regravada.
- Janela padrão no overlay: 15 segundos para transcrição, 5 segundos para ditado, sobreposição de 1 segundo. A sobreposição é limitada à metade da janela; valores maiores deixavam o processamento avançar apenas uma amostra por chamada.
- Silêncio digital exato não é enviado à inferência por janela. Fala baixa não é eliminada por limiar de energia. Um primeiro job silencioso ainda pode passar pelo aquecimento inicial do motor; isso não significa inferência zero para todo o ciclo de inicialização.
- `SPEECH_PREWARM` aquece antes de despachar os jobs; `SPEECH_MODEL_KEEP_WARM` evita descarregamento ocioso. Ambos são opt-in: manter o modelo quente reduz partidas frias, mas mantém RAM alocada. Shutdown, cancelamento, perda de lease e reconexão continuam com os mecanismos existentes.

**Não é streaming de microfone por WebSocket.** O Manager mantém o fluxo de gravação/upload/job. As janelas menores melhoram o processamento incremental depois da submissão, não fazem palavras aparecerem durante a captura. Nenhuma latência “instantânea”, qualidade equivalente ao ChatGPT ou quantidade arbitrária de sessões é garantida. Preservar esse contrato evita fingir streaming onde há upload assíncrono.

## Implantação opt-in

Nada neste script altera `.env`, reinicia containers, baixa modelos ou modifica o Compose original. Ele gera um arquivo adicional. Precisa de Python 3 e PyYAML (`python3-yaml` em Debian/Ubuntu).

Exemplo usando o checkout desta branch, **sem publicar imagem nem implantar automaticamente**:

```bash
python3 scripts/prepare-transcription-service.py \
  --compose deploy/develop/compose.yaml \
  --output deploy/develop/transcription-service.compose.yaml
```

O overlay gerado usa um contexto de build absoluto apontando para o checkout. Não mova o checkout após gerar esse modo. O custo de compilação é de instalação/CI, não do runtime. Para uma VPS, prefira imagem previamente construída no CI, e não compilar o motor em produção.

A workflow `Transcription Service` constrói e testa AMD64/ARM64 em PR; publica as imagens por arquitetura e o manifesto `ghcr.io/<owner>/connect-transcription-service:develop` **somente após push em `develop`**. A imagem não existe por simples abertura de PR. Para usar uma imagem já publicada/validada (preferencialmente por digest), informe `--image`:

```bash
python3 scripts/prepare-transcription-service.py \
  --compose deploy/develop/compose.yaml \
  --output deploy/develop/transcription-service.compose.yaml \
  --image ghcr.io/wkarts/connect-transcription-service:develop
```

O mesmo gerador atende os dez templates atuais, inclusive `deploy/fersoft/develop/compose.yaml` e `deploy/fersoft/production/compose.yaml`. Ele reutiliza a rede, volumes, credenciais de broker/storage e dependências já existentes do executor; não adiciona dependência do backend em relação ao ASR. `scale: 0` nos executores legados evita execução duplicada mesmo quando os perfis são combinados pelo Compose.

### Configuração desabilitada

```dotenv
SPEECH_ENABLED=false
TRANSCRIPTION_ENABLED=false
DICTATION_ENABLED=false
SPEECH_MODEL_AUTO_PROVISION=false
```

Sem o perfil `transcription`, o serviço não é iniciado. Nem um token ASR novo nem um modelo são necessários para a API funcionar. Se o serviço for explicitamente iniciado desabilitado, ele encerra com sucesso, sem conectar broker/storage ou carregar modelo; o overlay usa `restart: on-failure:3`, não reinício infinito após exit 0.

### Ativação explícita do motor nativo

Antes de mudar o motor, drene ou cancele os jobs antigos. Checkpoints de Transformers não podem ser reinterpretados como Whisper. Valores já presentes em `.env` têm precedência sobre defaults: um `SPEECH_MODEL_PATH` apontando para Xenova deve ser atualizado deliberadamente.

```dotenv
SPEECH_ENABLED=true
TRANSCRIPTION_ENABLED=true
DICTATION_ENABLED=true
SPEECH_PROVIDER=local
SPEECH_ENGINE=whisper.cpp
SPEECH_MODEL=whisper-base-q5_1
SPEECH_MODEL_PATH=/models/whisper.cpp/base-q5_1
SPEECH_WHISPER_MODEL_FILE=/models/whisper.cpp/base-q5_1/ggml-base-q5_1.bin
SPEECH_WHISPER_MODEL_SHA256=422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898
SPEECH_MODEL_AUTO_PROVISION=false
SPEECH_SERVICE_MEMORY=1280m
SPEECH_SERVICE_CPUS=1.0
SPEECH_SERVICE_TMPFS_SIZE=128m
SPEECH_GLOBAL_CONCURRENCY=1
SPEECH_INFERENCE_THREADS=1
SPEECH_PREWARM=false
SPEECH_MODEL_KEEP_WARM=false
```

Provisionar o modelo é uma operação explícita no Manager ou com o instalador verificado já existente. Para instalação local, use o diretório HOST que corresponde ao volume `/models` da stack:

```bash
node scripts/speech-model-provision.cjs whisper-base-q5_1 /caminho/host/para/models
```

Depois da instalação, reconhecimento não usa APIs externas. O processo nativo não recebe credenciais de RabbitMQ/S3. O modelo deve estar legível pelo UID usado no container; não aplicar `chmod 777`. Não trocar para outro modelo sem atualizar arquivo, hash e caminho correspondentes.

Para uso interativo, habilite opcionalmente:

```dotenv
SPEECH_PREWARM=true
SPEECH_MODEL_KEEP_WARM=true
```

Isso mantém RAM residente. Reduz partida fria; não elimina tempo de inferência nem espera na fila. O escalonador preserva prioridade ponderada do ditado e justiça entre instâncias, com uma inferência por vez.

### Aplicação e rollback

Na janela de migração escolhida pelo operador, depois de drenar jobs, pare os containers legados pelo nome do serviço na SUA stack. Em develop, o nome atual é `transcription-worker-argws-connect-develop`. Não remova volumes ou dados.

```bash
cd deploy/develop
# Primeiro, revisar a configuração combinada e as variáveis existentes:
docker compose -f compose.yaml -f transcription-service.compose.yaml config --quiet
# Somente depois de drenar/cancelar jobs antigos:
docker compose -f compose.yaml stop transcription-worker-argws-connect-develop
# Aplicar configuração do módulo de fala e iniciar o serviço opcional:
docker compose -f compose.yaml -f transcription-service.compose.yaml --profile transcription up -d
```

O backend pode precisar ser recriado para receber suas novas variáveis de fala. Seus providers, payloads e configuração de conexão não são reescritos. As flags continuam desabilitadas por padrão: gerar/aplicar overlay não equivale a autorizar inferência.

Rollback: pare `transcription-service` pelo Compose combinado; restaure as variáveis de motor/modelo anteriores; volte a usar apenas o Compose original e inicie o executor legado. Não opere simultaneamente modelos diferentes no mesmo pool com jobs pendentes. Não usar `down -v`.

## Testes e limites da validação

```bash
node --test transcription-worker/test/audio-normalizer.test.cjs transcription-worker/test/service.test.cjs
python3 test/transcription-service-overlay.test.py
node transcription-worker/scripts/benchmark-normalization.cjs
```

A comparação com FFmpeg usa WAV sintético e comprova igualdade de amostras e ausência de alteração da origem. O benchmark mede **apenas normalização**, não precisão, tempo de ASR, uso completo de RAM nem capacidade real da VPS. A suíte do projeto e o smoke nativo em containers continuam necessários. CI testa reconhecimento real fixado nas duas arquiteturas; aprovação de CI não substitui PT-BR real, carga multi-instância e falhas de broker/storage.

Teste eliminatório de homologação: com ASR ausente/desligado, enviar e receber texto, documento, áudio e PTT por REST, Meta-compatible, Zapo e Baileys deve continuar funcionando. Somente a operação explicitamente solicitada de fala pode retornar indisponibilidade. Não declarar esta condição como homologada em produção apenas porque os arquivos dos providers não mudaram.
