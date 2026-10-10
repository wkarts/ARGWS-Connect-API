# Serviço único e opcional de transcrição

## Estado e escopo

As bases Compose agora contêm apenas `transcription-service` (com o sufixo da
instalação, quando existente). Os executores `transcription-worker` e
`speech-dictation-worker` foram retirados das bases, dos exemplos de ambiente e
dos caminhos de construção/publicação. Não há overlay a aplicar para substituí-los.
O diretório anterior e seus executáveis foram removidos. O único entrypoint é
`transcription-service/src/service.js`; o coordenador durável reutilizado preserva
cancelamento, admissão, leases, checkpoints, recuperação e isolamento por instância.

A implementação é CPU-only com whisper.cpp persistente. Transformers, ONNX Runtime,
CUDA e a execução separada de ditado não fazem parte da imagem deste serviço.
Isso não remove dependências usadas por outros recursos da API.

**Integração opcional, não interceptação:** enviar/receber áudio ou PTT, vídeo,
chamadas, Baileys, Zapo, Meta-compatible e REST não exige uma transcrição.
O serviço não é um `depends_on` de nenhum outro serviço. O perfil `transcription`
e as quatro flags de fala ficam desligados em todos os exemplos, inclusive develop
e Fersoft. A ativação não autoriza transcrição automática de mensagens.

As rotas, envelopes de resposta, identificadores, autenticação, estados dos jobs,
eventos e webhooks existentes são conservados. Um pedido que retorna `202` com job
continua assíncrono. `workerId` e campos históricos de health continuam nos contratos
internos/persistidos por compatibilidade; não significam containers legados ativos.

## Matrizes de implantação

Atualizados: raiz, desenvolvimento Docker, production, develop, canonical,
CloudPanel, Dockge, homologation, Fersoft/develop e Fersoft/production. Os deploys
somente de documentação não ganham ASR. Os geradores Fersoft e deployers acompanham
a nova configuração. Nenhum arquivo `.env` de VPS, banco ou volume instalado é editado
pela PR. Nenhuma imagem é publicada a partir da PR.

## Configuração e recursos

| Variável | Padrão | Significado |
|---|---|---|
| `TRANSCRIPTION_SERVICE_IMAGE` | Canal/tag da instalação | Imagem única, `ghcr.io/wkarts/connect-transcription-service` |
| `SPEECH_SERVICE_MEMORY` | `1280m` | Teto total, incluindo coordenador, engine e tmpfs; não consumo medido |
| `SPEECH_SERVICE_CPUS` | `1.00` | Cota de CPU do container |
| `SPEECH_SERVICE_TMPFS_SIZE` | `128m` | Temporários limitados, sem gravação persistente do PCM |
| `SPEECH_INFERENCE_THREADS` | `1` | Threads de inferência |
| `SPEECH_MODEL_IDLE_TTL_SECONDS` | `300` | Descarregamento do modelo ocioso |
| `SPEECH_MODEL_KEEP_WARM` | `false` | Manter residente: reduz partida fria, mas retém RAM |
| `SPEECH_PREWARM` | `false` | Aquecer explicitamente antes do primeiro pedido |
| `SPEECH_PCM_FAST_PATH` | `true` | Leitura direta de WAV canônico |
| `SPEECH_SKIP_DIGITAL_SILENCE` | `true` | Não inferir silêncio digital exato |
| `SPEECH_MODEL_AUTO_PROVISION` | `false` | Não baixar modelo automaticamente |

Não existem mais seletores/replicadores de workers. `SPEECH_WORKER_MODE`,
`SPEECH_WORKER_CONCURRENCY`, `TRANSCRIPTION_WORKER_CONCURRENCY`,
`SPEECH_TRANSCRIPTION_REPLICAS`, `SPEECH_DICTATION_REPLICAS`,
`ARGWS_CONNECT_TRANSCRIPTION_WORKER_IMAGE` e os antigos limites `*_WORKER_*`
saem dos exemplos. Os deployers descartam esses valores ao gerar um ambiente.
Os limites foram reunidos nas três variáveis de serviço acima. Não reutilize um
seletor antigo de modelo Transformers sem uma migração explícita.

A inferência é serializada. As duas filas e múltiplas instâncias compartilham essa
capacidade; concorrência de requisições não significa inferência simultânea ilimitada.
O agendador conserva prioridade de ditado sem abandonar transcrições. Um container
por stack não equivale a um container por VPS: develop e production independentes
precisam de orçamento conjunto; o cgroup pai opcional permanece disponível.

## Ativação sem perder configurações

Preserve o `.env` instalado. Acrescente `transcription` aos seus `COMPOSE_PROFILES`
existentes sem substituir os demais. Ative explicitamente os recursos desejados:

```dotenv
SPEECH_ENABLED=true
TRANSCRIPTION_ENABLED=true
DICTATION_ENABLED=true
MANAGER_FEATURE_TRANSCRIPTION=true
SPEECH_ENGINE=whisper.cpp
SPEECH_PROVIDER=local
SPEECH_MODEL=whisper-base-q5_1
SPEECH_MODEL_PATH=/models/whisper.cpp/base-q5_1
SPEECH_DTYPE=q5_1
TRANSCRIPTION_LOCAL_MODEL=whisper-base-q5_1
TRANSCRIPTION_LOCAL_DTYPE=q5_1
SPEECH_WHISPER_MODEL_FILE=/models/whisper.cpp/base-q5_1/ggml-base-q5_1.bin
SPEECH_WHISPER_MODEL_SHA256=422f1ae452ade6f30a004d7e5c6a43195e4433bc370bf23fac9cc591f01a8898
```

Baixe/verifique o modelo pela administração existente ou prepare-o em uma máquina
conectada com o código-fonte:

```sh
node scripts/speech-model-provision.cjs whisper-base-q5_1 ./models
```

Para um host isolado, transfira o diretório completo verificado, incluindo o manifesto,
para o volume de modelos da instalação. O serviço monta os modelos como somente leitura.
Instalação/build/provisionamento podem necessitar internet; a inferência não chama
Hugging Face, OpenAI ou outro fornecedor. Broker, storage e API internos continuam
necessários para os contratos de jobs já existentes. Não há LLM, GPU ou API externa
obrigatórios. Isso não significa ausência de bibliotecas ou de um modelo ASR local.

O perfil nativo `whisper-small-q5_1` permanece uma opção: atualize conjuntamente
modelo, diretório, arquivo, checksum do catálogo e orçamento (referência de 2048 MiB).
Não há seleção automática de um modelo diferente. A qualidade de base versus small,
e de quantização versus o motor anterior, precisa de corpus PT-BR real.

## Normalização sem modificar mídia

Somente uma operação de fala autorizada pode normalizar o áudio. WAV PCM16/float32
mono/16 kHz é lido diretamente em janelas, sem subprocesso FFmpeg nesse caminho.
Outros formatos usam FFmpeg limitado dentro do cgroup. O arquivo de origem, o MIME
público, as chaves, a identificação de mensagem e a intenção áudio/PTT não são alterados.
A sobreposição nunca ultrapassa metade da janela. Silêncio digital exato não executa
inferência, enquanto fala baixa não é descartada como se fosse silêncio.

O ditado ainda utiliza gravação/upload/job. Não há transcrição do microfone em streaming
WebSocket nesta entrega. Janelas menores não equivalem a palavras exibidas durante a fala.

## Retirada segura em instalações existentes

1. Desative novas admissões de fala, mantendo mensagens e os providers operantes.
   Aguarde concluir ou cancele os jobs antigos pelos endpoints existentes. Confira
   pendências e leases; não apague tabelas ou purgue filas para forçar a migração.
2. Identifique os containers pelo projeto Compose e pelo label do serviço. Pare/remova
   **somente** os antigos `transcription-worker*` e `speech-dictation-worker*` daquela
   instalação, depois da drenagem. Nunca remova workers de vídeo, chamadas, mensagens,
   integrações ou outros recursos. Não execute `down -v`, prune global nem remova volumes.
3. Atualize o Compose e migre as variáveis de fala do `.env` preservando segredos,
   redes, volumes e as demais configurações. Provisione o novo modelo e aguarde a
   imagem correspondente estar publicada no mesmo canal; a PR não publica tags.
4. Suba a stack sem o perfil de fala e valide áudio, vídeo, PTT, texto e chamadas.
   Habilite o perfil e faça pedidos explícitos de transcrição. Pare o ASR novamente
   e confirme que apenas pedidos de fala ficam indisponíveis.

Renomear o serviço no YAML não remove containers antigos já em execução. A retirada
operacional é deliberada e seletiva; não foi executada em qualquer VPS por esta PR.
Rollback é feito pela revisão anterior no Git e sua imagem correspondente, após
reconciliar os jobs. Não há uma segunda implementação legada no novo Compose.

## Validação e limites do resultado

A suíte `test/speech-service-deployment.test.py` verifica as dez bases, ausência de
executáveis/depêndencias antigas, exemplos opt-in, isolamento e inicialização desligada.
O CI mantém contratos de mensagens, providers, Manager, banco, storage e cancelamento,
build nativo em AMD64/ARM64 e reconhecimento real com checksum e processo reutilizado.
O teste nativo usa amostra de referência em inglês: não certifica qualidade PT-BR.

Uma transcrição offline necessariamente executa cálculos e ocupa memória. Whisper,
Vosk e sherpa-onnx usam modelos de reconhecimento; retirar APIs externas de IA não
elimina o modelo local. Não há promessa de zero hardware, latência zero ou qualidade
igual/superior sem medição. Vosk oferece streaming e modelos compactos, mas precisa
comparação em português; sherpa-onnx depende de um modelo adequado e do runtime ONNX.
O runtime nativo atual foi mantido para não introduzir outro motor sem homologação.

Fontes oficiais para a avaliação técnica:
- https://github.com/ggml-org/whisper.cpp
- https://alphacephei.com/vosk/models
- https://alphacephei.com/vosk/
- https://k2-fsa.github.io/sherpa/onnx/
