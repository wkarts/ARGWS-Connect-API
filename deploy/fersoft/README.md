# Deployments Fersoft

Cada diretório (`develop/` e `production/`) contém somente `compose.yaml` e
`env.example`. Em uma instalação existente, mantenha o `.env` atual e os
diretórios `./volumes/*`; não copie nem execute auxiliares externos.

**Release de áudio suspensa:** as opções de transcrição abaixo descrevem a
configuração futura e não devem ser aplicadas agora aos `.env` instalados.
Mantenha os serviços de voz desativados nas stacks Fersoft enquanto o ensaio
com modelo real é concluído no develop principal. O bloqueio em `main` impede
a publicação da release antes dessa validação.

A full stack é selecionada pelo próprio `.env`. A fala é opt-in e fica
desativada por padrão enquanto a release está suspensa:

```dotenv
COMPOSE_PROFILES=operations,nats,kafka,mysql,traccar
OPERATIONS_ENABLED=true
NATS_ENABLED=true
KAFKA_ENABLED=true
MYSQL_SERVICE_ENABLED=true
TRACCAR_ENABLED=true
TRANSCRIPTION_ENABLED=false
SPEECH_ENABLED=false
DICTATION_ENABLED=false
SPEECH_WORKER_MODE=pool
MANAGER_FEATURE_TRANSCRIPTION=false
SPEECH_TRANSCRIPTION_REPLICAS=1
SPEECH_GLOBAL_CONCURRENCY=1
```

Ditado e transcrição usam o mesmo worker por stack, com perfil `transcription`
e `SPEECH_WORKER_MODE=pool`. O Compose fixa `scale: 1`, inclusive quando um
`.env` antigo contém `SPEECH_TRANSCRIPTION_REPLICAS=2`. O modelo é carregado
no processo filho depois da admissão e permanece residente por até
`SPEECH_MODEL_IDLE_TTL_SECONDS=300` segundos ociosos. A API não carrega o motor.
O worker antigo exclusivo de ditado não integra mais os manifests.

Novos uploads e ditados usam um bucket privado dedicado. A API e o worker
recebem o mesmo `SPEECH_S3_BUCKET_NAME`; vazio deriva `S3_BUCKET` com sufixo
`-speech`. Preserve um valor privado personalizado no `.env` instalado.
Não use o bucket público de mídia. A API verifica a política e não publica
esses objetos; os objetos legados permanecem no bucket de origem.

O adaptador padrão continua `SPEECH_ENGINE=transformers`, com teto de `4g`
para coordenador, processo filho e tmpfs juntos, sem swap adicional.
`TRANSCRIPTION_WORKER_TMPFS_SIZE=256m`, threads explícitas e fila limitada
contêm o trabalho admitido. Esse teto não é uma medição de consumo.
O perfil de configuração `deploy/speech/canary-whisper-cpp.env.example`
seleciona explicitamente whisper.cpp/base multilíngue q5_1, com teto total de
1280 MiB; mantenha-o no develop até medir qualidade pt-BR e carga sustentada.

Em instalações existentes, preserve os segredos, banco, filas, `./models` e
volumes. Somente depois de liberar a release, atualize o Compose e as imagens
da API e do worker no mesmo canal.
Edite o `.env` existente para incluir `transcription` em `COMPOSE_PROFILES`,
ajustar `TRANSCRIPTION_ENABLED=true`, `SPEECH_ENABLED=true`,
`MANAGER_FEATURE_TRANSCRIPTION=true`, `DICTATION_ENABLED=true`,
`SPEECH_TRANSCRIPTION_REPLICAS=1`, `SPEECH_GLOBAL_CONCURRENCY=1` e
`SPEECH_WORKER_MODE=pool` e `TRANSCRIPTION_WORKER_TMPFS_SIZE=256m`.
`DICTATION_MAX_DURATION_SECONDS=60` e `DICTATION_JOB_DEADLINE_SECONDS=120`
limitam os ditados a um prazo útil. O `env.example` não altera o `.env`
instalado. Antes de alternar o protocolo de filas, interrompa a admissão e
drene ou reconcilie os jobs legados conforme `docs/guides/speech.md`.
Faça `pull` e `up -d --remove-orphans` no projeto Compose correto depois da
verificação de jobs e fontes; o comando remove serviços órfãos daquele projeto,
inclusive o worker antigo de ditado, e não deve ser acompanhado de `down -v`.
Em VPS que hospeda develop e production, dimensione o pico simultâneo de todas
as stacks, que podem usar brokers diferentes, antes de ligar os dois perfis.

Suba ou atualize diretamente pelo Dockge/Compose usando esses dois arquivos.
O bootstrap do Traccar é incorporado no `compose.yaml`; os demais comportamentos
de runtime já pertencem às imagens dos services.

O Manager mostra o painel de frota usando somente a API interna do Traccar; não
cria hostname, porta, service ou arquivo de runtime adicional. A senha e a
sessão administrativa do Traccar permanecem no servidor.
