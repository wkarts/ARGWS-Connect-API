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

Para uma instalação existente, atualize primeiro o Engine pelo fluxo normal e depois habilite o profile `platform` quando quiser ativar o produto completo.
