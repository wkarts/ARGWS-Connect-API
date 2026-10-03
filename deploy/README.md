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
docker compose --env-file .env -f compose.yaml up -d --pull never
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

Para usar a transcrição local, `TRANSCRIPTION_ENABLED=true` precisa vir junto
com o perfil `transcription`:

```dotenv
COMPOSE_PROFILES=operations,nats,kafka,mysql,traccar,transcription
TRANSCRIPTION_PROVIDER=local
```

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
  --modules operations,traccar
.\argws-connect-deployer-win-x64.exe generate `
  --flavor develop `
  --modules operations,traccar `
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
