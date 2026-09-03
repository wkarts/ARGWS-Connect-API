# Connect|API Platform v1 — runtime e deployments

A Platform é uma nova superfície de produto do **mesmo Connect|API**. O Engine Node/TypeScript continua sendo a API canônica e `VERSION`, branches, GitHub Actions, releases e SemVer continuam pertencendo à raiz do repositório.

> Platform controla. Engine executa.

## Perfis oficiais

### API-only

É o deployment headless e continua plenamente suportado. Inclui o Connect|API Engine e a infraestrutura necessária para REST, Webhooks, Events e providers. Não inclui frontend administrativo.

No compose unificado da Platform, é o perfil padrão, sem `--profile` adicional.

### API + DOCs

Adiciona o Connect|API DOCs/Scalar ao deployment API-only.

```bash
docker compose --env-file deploy/platform/.env -f deploy/platform/compose.yaml --profile docs up -d
```

### Platform completa

Adiciona Control API, frontend Vue/PWA, banco de governança da Platform, workers/scheduler e gateway. O Engine permanece como serviço especializado e mantém seu banco operacional separado.

```bash
docker compose --env-file deploy/platform/.env -f deploy/platform/compose.yaml --profile platform up -d
```

A observabilidade completa permanece opt-in com o profile `observability`.

## Instalações `deploy/develop` já existentes

Uma instalação develop que já possui Engine, banco e sessões WhatsApp **não precisa ser migrada para um segundo stack**. O arquivo `deploy/develop/compose.platform.yaml` é um overlay do compose já utilizado e reaproveita os serviços/volumes atuais.

```bash
cd deploy/develop
cp platform.env.example .platform.env
# preencher os segredos e domínios novos da Platform

docker compose \
  --env-file .env \
  --env-file .platform.env \
  -f compose.yaml \
  -f compose.platform.yaml \
  --profile platform \
  up -d
```

O overlay preserva:

- `api-argws-connect-develop` como o mesmo Connect|API Engine;
- o PostgreSQL operacional atual;
- Redis, RabbitMQ e MinIO atuais;
- `./volumes/instances` e as sessões já pareadas.

Ele acrescenta somente a camada Platform, incluindo um PostgreSQL separado para governança/Control Plane.

No primeiro rollout o domínio da API existente pode continuar apontando para sua porta atual. Os novos hosts da Platform podem ser encaminhados para o gateway local da Platform (`127.0.0.1:38800` por padrão), reduzindo o impacto da ativação.

## Adoção de instâncias existentes

A Platform não precisa recriar uma instância que já está funcionando no Engine. Em **Instâncias → Adotar existente**, ela consulta `/instance/fetchInstances` e cria apenas um `EngineBinding` tenant-safe.

A adoção:

- não chama `/instance/create`;
- não gera QR/pairing code;
- não altera o nome real da instância;
- não desconecta a sessão;
- não move nem apaga contatos, chats ou mensagens;
- não altera `./volumes/instances`.

Uma instância adotada tem origem `ADOPTED_EXISTING`. Ao removê-la da Platform, a ação disponível é **Desvincular da Platform**, que apaga somente o binding; a instância e a sessão continuam no Engine.

## Manager legado

O frontend histórico em `manager/dist` foi aposentado nesta frente. A imagem do Engine deixa de copiar esses assets e a rota `/manager` deixa de existir. A nova superfície administrativa é `platform/web`.

A retirada do Manager não remove endpoints REST, Templates, Actions, Recipes, Micro Apps, providers, Webhooks ou Events do Engine.

## Versionamento e imagens

A Platform não possui versão independente. Platform API, Platform Web e Gateway devem ser publicados com os mesmos canais do Connect|API:

- `develop` para a branch `develop`;
- SemVer e `latest` somente pelo release canônico em `main`.

O primeiro release contendo a Platform continuará a sequência SemVer existente do Connect|API.

## Migração

Não há migração destrutiva do banco do Engine nesta frente. A Platform usa seu próprio banco para tenants, parceiros, usuários, RBAC, branding, domínios, provisioning, auditoria e bindings com instâncias do Engine.

Para uma instalação existente, atualize o Engine pelo fluxo normal e depois ative a Platform usando o overlay correspondente ao deployment que já está em uso. Em `deploy/develop`, use `compose.platform.yaml` para manter a mesma stack e os mesmos volumes.
