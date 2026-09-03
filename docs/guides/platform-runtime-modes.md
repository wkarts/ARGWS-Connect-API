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

O overlay declara explicitamente o mesmo project e a mesma network da stack-base: `argws-connect-develop` e `argws-connect-develop-net`. O arquivo `platform.env.example` repete esses valores de forma intencional para tornar o contrato auditável e impedir que a Platform seja iniciada acidentalmente como um segundo projeto Compose.

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

## Convenção de project name dos deployments

Todo deployment Compose independente do Connect|API deve declarar `name: ${COMPOSE_PROJECT_NAME:-...}` e manter o mesmo valor em `env.example`. O padrão canônico é `argws-connect-<deployment>`; quando houver rede dedicada, use `argws-connect-<deployment>-net`.

| Deployment | Project name | Network |
| --- | --- | --- |
| canonical | `argws-connect-canonical` | `argws-connect-canonical-net` |
| develop | `argws-connect-develop` | `argws-connect-develop-net` |
| homologation | `argws-connect-homologation` | `argws-connect-homologation-net` |
| production | `argws-connect-production` | `argws-connect-production-net` |
| docs | `argws-connect-docs` | gerenciada pelo próprio compose |
| docs-develop | `argws-connect-docs-develop` | gerenciada pelo próprio compose |
| cloudpanel | `argws-connect-cloudpanel` | `argws-connect-cloudpanel-net` |
| dockge | `argws-connect-dockge` | `argws-connect-dockge-net` |
| platform | `argws-connect-platform` | `argws-connect-platform-net` |

Overlays operacionais também declaram explicitamente o **mesmo** project name da stack-base. Portanto:

- `deploy/develop/compose.platform.yaml` usa `name: ${COMPOSE_PROJECT_NAME:-argws-connect-develop}` e `deploy/develop/platform.env.example` define `COMPOSE_PROJECT_NAME=argws-connect-develop` e `ARGWS_CONNECT_NETWORK_NAME=argws-connect-develop-net`;
- `deploy/platform/compose.local-build.yaml` usa `name: ${COMPOSE_PROJECT_NAME:-argws-connect-platform}`, igual ao `deploy/platform/compose.yaml` e ao `deploy/platform/env.example`.

Isso não cria projetos adicionais; ao contrário, impede divergência acidental e documenta de forma verificável a identidade da stack em cada combinação de Compose.

### Convenção dos services

Todo service de um deployment independente segue `recurso-argws-connect-deployment`, e o `container_name` deve ser idêntico ao service. Exemplos: `api-argws-connect-develop`, `docs-argws-connect-platform`, `platform-api-argws-connect-platform`. Aliases internos estáveis (`connect-engine`, `connect-platform-api`, `argws-connect-postgres` etc.) podem existir para desacoplar a comunicação interna da nomenclatura física.

No overlay `deploy/develop/compose.platform.yaml`, os serviços já existentes mantêm seus nomes `*-argws-connect-develop` e os novos componentes usam `platform-*-argws-connect-develop`.
