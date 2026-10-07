# Deploys oficiais — Compose + `.env`

Cada stack é autônoma com apenas três elementos de runtime:

- `compose.yaml` (ou `docker-compose.yml` no CloudPanel);
- `.env` da própria instalação;
- `./volumes/*` já persistidos.

Não há scripts, Python, Shell, bootstrap montado ou outro arquivo obrigatório no
host. Quando uma capacidade precisa de inicialização, ela é declarada como um
service do próprio Compose e executa seu `entrypoint` dentro do container.

## Subir ou atualizar

No diretório da stack, preserve o `.env` existente e execute diretamente pelo
Dockge ou pelo Docker Compose:

```bash
docker compose --env-file .env -f compose.yaml pull
docker compose --env-file .env -f compose.yaml up -d --pull never --remove-orphans
docker compose --env-file .env -f compose.yaml ps
```

Para CloudPanel, troque o arquivo por `docker-compose.yml`. Nunca use
`docker compose down -v`: os dados ficam em `./volumes/*`.

## Serviços e profiles

O mesmo Compose contém core e opcionais. O `.env` define o que sobe:

```dotenv
# normal: somente core + Operations
COMPOSE_PROFILES=operations

# full stack
COMPOSE_PROFILES=operations,nats,kafka,mysql,traccar
OPERATIONS_ENABLED=true
NATS_ENABLED=true
KAFKA_ENABLED=true
MYSQL_SERVICE_ENABLED=true
TRACCAR_ENABLED=true
TRACCAR_MODE=internal
```

Todos os Compose de aplicação incluem um worker de transcrição no profile
`transcription`, inclusive Fersoft develop e production. O worker de ditado
continua somente no develop principal. A release estável publica a imagem do
worker junto com a API e o Manager; use o mesmo canal de imagem na stack.

Ao atualizar uma VPS, preserve o `.env`, segredos, volumes, filas e `./models`.
Altere o `.env` efetivo: adicione `transcription` em `COMPOSE_PROFILES`, defina
`SPEECH_ENABLED=true`, `TRANSCRIPTION_ENABLED=true`,
`MANAGER_FEATURE_TRANSCRIPTION=true`, `DICTATION_ENABLED=false` fora do develop
principal, `SPEECH_TRANSCRIPTION_REPLICAS=1`, `SPEECH_GLOBAL_CONCURRENCY=1` e
`TRANSCRIPTION_WORKER_TMPFS_SIZE=1g`. Atualize o Compose e execute os comandos
acima; `env.example` não modifica um `.env` instalado. Confira os containers
e o resultado de um job curto. `--remove-orphans` retira o ditado legado nas
stacks Fersoft sem excluir volumes.

No `deploy/develop/` principal, o profile `transcription` inicia dois
consumidores independentes; nos demais deploys inicia somente transcrição.
A API baixa a revisão fixada do
`Xenova/whisper-small` para `./models` quando o recurso está habilitado. São
cerca de 250 MB no disco; preserve o diretório entre atualizações.

```dotenv
SPEECH_ENABLED=true
SPEECH_PROVIDER=local
SPEECH_MODEL=Xenova/whisper-small
SPEECH_MODELS_HOST_PATH=./models
SPEECH_MODEL_PATH=/models/Xenova/whisper-small
TRANSCRIPTION_WORKER_TMPFS_SIZE=1g
SPEECH_WORKER_MEMORY=4g
SPEECH_WORKER_CPUS=2.00
```

Os logs após a correção de inicialização mediram cerca de 2,5 GiB de RSS por
worker com o modelo carregado, antes de inferências. Os limites de 4 GiB por
container não controlam a soma entre stacks. Em especial, Fersoft develop e
production na mesma VPS carregam dois modelos independentes; confira a margem
do host antes de ativar o perfil em ambas e acompanhe RSS, OOM e reinícios.

Para uma instalação sem acesso à Internet, copie os pesos compatíveis para o
volume e gere o manifesto SHA-256 com
`node transcription-worker/scripts/create-model-manifest.cjs <diretório-do-modelo>`.
Consulte [o guia de voz](../docs/guides/speech.md) para os endpoints, limites e
passos de provisionamento.

Kafka e ZooKeeper dependem do service interno `volume-init`. Ele fica saudável
em execução depois de preparar apenas diretórios vazios, por isso não deixa a
stack como encerrada no Dockge. Diretórios com dados e proprietário incompatível
continuam preservados e bloqueiam os brokers com erro explícito.

MySQL depende de `mysql-volume-init`, também interno ao Compose. Ele corrige
somente a propriedade do próprio bind `./volumes/mysql` para o usuário da imagem
Percona; não remove, recria ou inicializa arquivos existentes. O banco Traccar
reconcilia a conta e o database `traccar` ausentes no próprio entrypoint, sem
trocar uma credencial já existente.

## Fersoft

`deploy/fersoft/production/` é a full stack Fersoft: copie apenas seu
`compose.yaml` para a instalação e mantenha o `.env` e `./volumes` atuais. Os
nomes de projeto, containers, rede, portas e referências GHCR permanecem
isolados e preservados.

O Manager e as DOCs integradas continuam na API, em `/manager` e
`/manager/docs`; não exigem um arquivo ou service externo no host.

## Gerador portátil

Para preparar uma instalação sem depender de scripts auxiliares no servidor,
baixe o `argws-connect-deployer-win-x64.exe` (CLI) ou o
`argws-connect-deployer-gui-win-x64.exe` (interface gráfica) da pré-release
`connect-api-develop` ou da release estável. A CLI pode ser executada na
máquina do operador:

```powershell
.\argws-connect-deployer-win-x64.exe plan `
  --flavor develop `
  --modules operations,traccar,transcription
.\argws-connect-deployer-win-x64.exe generate `
  --flavor develop `
  --modules operations,traccar,transcription `
  --output .\out\argws-connect-develop
.\argws-connect-deployer-win-x64.exe validate `
  --directory .\out\argws-connect-develop
```

O resultado contém somente `compose.yaml` e `.env`. O modo padrão do Traccar
usa as credenciais administrativas internas e deixa `TRACCAR_TOKEN` vazio. A
ferramenta recusa reutilizar `AUTHENTICATION_API_KEY` como token do Traccar,
que foi a causa do incidente de provisionamento. O `.exe` é Rust nativo e não
embute Node.js; os testes `index.cjs` permanecem apenas como contrato de
compatibilidade no repositório.
