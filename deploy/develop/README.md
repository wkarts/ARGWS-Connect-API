# ARGWS Connect API — Develop

Stack canônica `develop` do Connect|API.

- API: `https://d.api.connect.argws.com.br`
- Porta local API: `38082`
- Porta local DOCs: `38182`
- API image: `ghcr.io/wkarts/argws-connect-api:develop`
- DOCs image: `ghcr.io/wkarts/argws-connect-docs:develop`
- Persistência: `./volumes/...`
- Instâncias/sessões: `./volumes/instances`
- Serviços core: API, Connect|API DOCs, PostgreSQL, Redis, RabbitMQ e MinIO
- Profiles opcionais: `nats`, `kafka`, `extended`
- Manager legado: removido; a interface administrativa passa a ser a Connect|API Platform.

Convenção dos services core: `<recurso>-argws-connect-develop`.

```bash
./prepare-env.sh
./deploy.sh
```

## Elevar a instalação develop existente para Platform

A Platform pode ser adicionada **sobre esta mesma stack**, sem criar um segundo Connect|API Engine e sem mover o banco/sessões já existentes.

O overlay `compose.platform.yaml` reutiliza diretamente:

- `api-argws-connect-develop` como Engine;
- `postgres-argws-connect-develop` e o banco operacional atual do Engine;
- `redis-argws-connect-develop`;
- `rabbitmq-argws-connect-develop`;
- `minio-argws-connect-develop`;
- `./volumes/instances`, onde as sessões existentes permanecem.

Somente os componentes próprios da Platform são acrescentados:

- `connect-platform-postgres` — governança/Control Plane, separado do banco do Engine;
- `connect-platform-api`;
- `connect-platform-web`;
- `connect-platform-worker`;
- `connect-platform-scheduler`;
- `connect-gateway`.

### 1. Preparar as variáveis exclusivas da Platform

O `.env` atual continua intacto e continua sendo a configuração do Engine.

```bash
cd deploy/develop
cp platform.env.example .platform.env
```

Edite `.platform.env` e substitua todos os `CHANGE_ME`. Não copie a API key, Redis, RabbitMQ ou MinIO para esse arquivo: o overlay reutiliza os valores do `.env` atual.

### 2. Validar antes de subir

```bash
docker compose \
  --env-file .env \
  --env-file .platform.env \
  -f compose.yaml \
  -f compose.platform.yaml \
  --profile platform \
  config >/dev/null
```

### 3. Subir a Platform sem trocar de stack

```bash
docker compose \
  --env-file .env \
  --env-file .platform.env \
  -f compose.yaml \
  -f compose.platform.yaml \
  --profile platform \
  pull

docker compose \
  --env-file .env \
  --env-file .platform.env \
  -f compose.yaml \
  -f compose.platform.yaml \
  --profile platform \
  up -d
```

O gateway da Platform publica por padrão em `127.0.0.1:38800`.

No primeiro rollout você pode **manter a API existente exatamente como está** em `127.0.0.1:38082` e os DOCs em `127.0.0.1:38182`. Adicione no CloudPanel/reverse proxy apenas os novos hosts da Platform para `127.0.0.1:38800` (por exemplo `d.connect.*`, `d.control.connect.*`, `d.admin.connect.*` e `d.partner.connect.*`).

## Adotar uma instância que já está rodando

A ativação da Platform não recria automaticamente suas sessões. Depois de criar/selecionar o tenant no Control Plane:

1. abra **Instâncias**;
2. clique em **Adotar existente**;
3. escolha a instância encontrada em `/instance/fetchInstances`;
4. defina apenas um alias visual para a Platform;
5. clique em **Adotar sem recriar**.

A operação cria somente um `EngineBinding`. Ela **não chama `/instance/create`**, não gera novo QR, não desconecta o WhatsApp e não altera o nome real, banco, JID, contatos, mensagens ou arquivos da sessão.

Instâncias adotadas aparecem com origem **Adotada**. A ação de remoção nesse caso é **Desvincular da Platform** e remove apenas o binding; a instância continua existindo no Engine.

## Rollback da camada Platform

Como o Engine permanece o mesmo, um problema na nova interface não exige rollback dos dados/sessões do WhatsApp. Basta parar os componentes `connect-platform-*`/`connect-gateway`; a API develop continua utilizando os volumes e serviços core existentes.
