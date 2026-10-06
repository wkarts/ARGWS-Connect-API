# Deployments Fersoft

Cada diretório (`develop/` e `production/`) contém somente `compose.yaml` e
`env.example`. Em uma instalação existente, mantenha o `.env` atual e os
diretórios `./volumes/*`; não copie nem execute auxiliares externos.

A full stack é selecionada pelo próprio `.env`:

```dotenv
COMPOSE_PROFILES=operations,nats,kafka,mysql,traccar
OPERATIONS_ENABLED=true
NATS_ENABLED=true
KAFKA_ENABLED=true
MYSQL_SERVICE_ENABLED=true
TRACCAR_ENABLED=true
TRANSCRIPTION_ENABLED=false
SPEECH_ENABLED=false
MANAGER_FEATURE_TRANSCRIPTION=false
```

Transcrição e ditado estão suspensos em ambos os canais Fersoft. Somente
`deploy/develop` (o develop principal) mantém esses workers. O Compose Fersoft
removeu os services de voz e força as flags da API a `false`, inclusive se um
`.env` antigo contiver `true`. O Manager também oculta a função.

Em instalações existentes, preserve os segredos, banco e volumes. Remova
`transcription` de `COMPOSE_PROFILES`, defina `TRANSCRIPTION_ENABLED=false`,
`SPEECH_ENABLED=false`, `DICTATION_ENABLED=false` e
`MANAGER_FEATURE_TRANSCRIPTION=false`, e atualize o Compose e a imagem da API.
Remova os containers antigos de transcrição e ditado com a opção de remover
órfãos do Compose/Dockge; a troca de imagem sozinha não para esses processos.
Não apague o diretório `./models` ou os dados das filas durante a mitigação.

Suba ou atualize diretamente pelo Dockge/Compose usando esses dois arquivos.
O bootstrap do Traccar é incorporado no `compose.yaml`; os demais comportamentos
de runtime já pertencem às imagens dos services.

O Manager mostra o painel de frota usando somente a API interna do Traccar; não
cria hostname, porta, service ou arquivo de runtime adicional. A senha e a
sessão administrativa do Traccar permanecem no servidor.
