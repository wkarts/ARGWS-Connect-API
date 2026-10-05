# Deployments Fersoft

Cada diretório (`develop/` e `production/`) contém somente `compose.yaml` e
`env.example`. Em uma instalação existente, mantenha o `.env` atual e os
diretórios `./volumes/*`; não copie nem execute auxiliares externos.

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
```

Os exemplos de `develop` e `production` incluem o perfil `transcription`,
a API habilitada e os workers de transcrição e ditado. O modelo local usa
`SPEECH_MODELS_HOST_PATH=./models` e as filas do RabbitMQ da mesma stack.
Em instalações existentes, atualize o `.env` preservando seus segredos e
volumes: acrescente `transcription` a `COMPOSE_PROFILES` e defina
`TRANSCRIPTION_ENABLED=true` e `SPEECH_ENABLED=true`. Então recrie a API e os
dois workers com Compose/Dockge; manter o `.env` antigo desativado não inicia
os workers mesmo após atualizar a imagem ou o compose.

Suba ou atualize diretamente pelo Dockge/Compose usando esses dois arquivos.
O bootstrap do Traccar é incorporado no `compose.yaml`; os demais comportamentos
de runtime já pertencem às imagens dos services.

O Manager mostra o painel de frota usando somente a API interna do Traccar; não
cria hostname, porta, service ou arquivo de runtime adicional. A senha e a
sessão administrativa do Traccar permanecem no servidor.
