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

Todos os dez Compose de aplicação incluem somente o serviço opcional
`transcription-service` (com sufixo de instalação onde aplicável), inclusive
Fersoft develop e production. Não há worker separado de transcrição ou ditado.
Não é necessário aplicar um overlay: o serviço já está nos arquivos-base.
O perfil `transcription` fica fora de `COMPOSE_PROFILES` por padrão em todos os exemplos.
A API, áudio, vídeo, chamadas, Zapo, Baileys e Meta-compatible não dependem do ASR.

As variáveis novas são `TRANSCRIPTION_SERVICE_IMAGE`, `SPEECH_SERVICE_MEMORY`,
`SPEECH_SERVICE_CPUS` e `SPEECH_SERVICE_TMPFS_SIZE`. Seletores, concorrência e
réplicas dos executores antigos não integram mais os exemplos. A imagem nativa
é `ghcr.io/wkarts/connect-transcription-service`; release/develop a publicam
no mesmo fluxo dos demais componentes. A PR nunca publica imagens.
O core canonical conserva suas imagens fixadas; para seu novo ASR, fixe
explicitamente uma versão publicada usando `TRANSCRIPTION_SERVICE_IMAGE`.

Antes de atualizar uma instalação antiga, drene/cancele os jobs de fala e
pare/remova somente os antigos containers de transcrição/ditado do projeto.
Renomear no YAML não remove um container em execução. Preserve `.env`, segredos,
volumes, banco, filas e modelos. Não use `down -v` nem prune global.
Os comandos gerais de atualização acima não substituem essa drenagem prévia.

Para habilitar, acrescente `transcription` aos perfis existentes, ative somente
as flags de fala desejadas e provisione o modelo nativo verificado. Não copie
`env.example` sobre um ambiente instalado e não reutilize um seletor Transformers
como se fosse um modelo GGML. O reconhecimento é local, CPU-only, mas utiliza
um modelo ASR e recursos reais de CPU/RAM. Não há promessa de latência zero.

Consulte [o guia de migração e ativação](../docs/guides/optional-transcription-service.md)
para a lista de parâmetros, formatos, limites, provisão offline e retirada segura.
Os jobs, eventos, rotas e contratos existentes continuam os mesmos.

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
