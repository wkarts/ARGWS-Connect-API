# Deployments Fersoft

Cada diretório (`develop/` e `production/`) contém somente `compose.yaml` e
`env.example`. Em uma instalação existente, mantenha o `.env` atual e os
diretórios `./volumes/*`; não copie nem execute auxiliares externos.

**Release de áudio suspensa:** as opções de transcrição abaixo descrevem a
configuração futura e não devem ser aplicadas agora aos `.env` instalados.
Mantenha os serviços de voz desativados nas stacks Fersoft enquanto o ensaio
com modelo real é concluído no develop principal. O bloqueio em `main` impede
a publicação da release antes dessa validação.

A full stack é selecionada pelo próprio `.env`:

```dotenv
COMPOSE_PROFILES=operations,nats,kafka,mysql,traccar,transcription
OPERATIONS_ENABLED=true
NATS_ENABLED=true
KAFKA_ENABLED=true
MYSQL_SERVICE_ENABLED=true
TRACCAR_ENABLED=true
TRANSCRIPTION_ENABLED=true
SPEECH_ENABLED=true
DICTATION_ENABLED=false
MANAGER_FEATURE_TRANSCRIPTION=true
SPEECH_TRANSCRIPTION_REPLICAS=1
SPEECH_GLOBAL_CONCURRENCY=1
```

Transcrição usa um worker por stack, com perfil `transcription`. Na correção em
validação, o modelo é armazenado em `./models`, carregado somente após obter
a vaga global e descarregado ao terminar cada job. As amostras anteriores
registraram cerca de 2,5 GiB por processo ocioso; ainda falta medir o novo
patamar no host. O ditado permanece desativado nos dois canais Fersoft e seu
serviço não é incluído no Compose.

Em instalações existentes, preserve os segredos, banco, filas, `./models` e
volumes. Somente depois de liberar a release, atualize o Compose e as imagens
da API e do worker no mesmo canal.
Edite o `.env` existente para incluir `transcription` em `COMPOSE_PROFILES`,
ajustar `TRANSCRIPTION_ENABLED=true`, `SPEECH_ENABLED=true`,
`MANAGER_FEATURE_TRANSCRIPTION=true`, `DICTATION_ENABLED=false`,
`SPEECH_TRANSCRIPTION_REPLICAS=1`, `SPEECH_GLOBAL_CONCURRENCY=1` e
`TRANSCRIPTION_WORKER_TMPFS_SIZE=1g`. O `env.example` não altera o `.env`
instalado. Faça `pull` e `up -d --remove-orphans` no projeto Compose correto;
isso remove apenas o serviço antigo de ditado, sem apagar volumes.
Em VPS que hospeda develop e production, dimensione o pico simultâneo de todas
as stacks, que podem usar brokers diferentes, antes de ligar os dois perfis.

Suba ou atualize diretamente pelo Dockge/Compose usando esses dois arquivos.
O bootstrap do Traccar é incorporado no `compose.yaml`; os demais comportamentos
de runtime já pertencem às imagens dos services.

O Manager mostra o painel de frota usando somente a API interna do Traccar; não
cria hostname, porta, service ou arquivo de runtime adicional. A senha e a
sessão administrativa do Traccar permanecem no servidor.
