# Deploy do Connect|API DOCs

O Scalar é parte oficial da stack e roda como service `docs` no Compose raiz e em todos os deployments oficiais (`production`, `homologation`, `develop`, `canonical`, `cloudpanel` e `dockge`).

## Service

O container usa a imagem GHCR `ghcr.io/wkarts/argws-connect-docs`, derivada do Scalar API Reference e com contratos/branding incorporados na própria imagem.

Porta padrão local:

```text
38082 → 8080
```

Variáveis:

```env
ARGWS_CONNECT_DOCS_IMAGE=ghcr.io/wkarts/argws-connect-docs:latest
ARGWS_CONNECT_DOCS_HOST_PORT=38082
```

O bind usa a mesma variável global da stack:

```env
ARGWS_CONNECT_BIND_ADDRESS=127.0.0.1
```

## Portas por deployment

```text
production   38180
homologation 38181
develop      38182
canonical    38183
cloudpanel   38180
dockge       38180
```

O Compose raiz continua usando `38082` por compatibilidade local.

## Subir somente documentação

```bash
npm run docs:generate
docker compose up -d docs
```

## Subir a stack completa

```bash
docker compose up -d
```

## Healthcheck

```bash
curl -fsS http://127.0.0.1:38082/health
```

## Reverse proxy

O service pode ser publicado atrás do proxy da infraestrutura em um hostname dedicado, por exemplo:

```text
https://docs.connect.argws.com.br
```

O proxy deve encaminhar para o host/porta configurados para o container `docs`. Não é necessário expor PostgreSQL, Redis, RabbitMQ ou MinIO publicamente para servir a documentação.

## Atualização

Antes de publicar uma alteração funcional:

```bash
npm run docs:generate
npm run docs:check
```

O workflow `Docs Integrity` repete a validação no CI.

## Versionamento

Os contratos carregam a versão do `package.json` no momento da geração. Em `develop`, a documentação acompanha o canal de desenvolvimento. Na promoção/release, o snapshot pode ser preservado junto da versão final sem alterar o mecanismo de SemVer existente.

## Segurança

A documentação contém exemplos e schemas, nunca credenciais reais. O botão de autenticação do Scalar deve receber tokens somente no navegador do usuário; chaves não devem ser versionadas no repositório nem embutidas nos documentos.


### Endpoint público `/docs/`

Os deployments oficiais definem `ARGWS_CONNECT_DOCS_PUBLIC_BASE_PATH=/docs`. O reverse proxy recebe `/docs/...`, remove o prefixo ao encaminhar para o Scalar e mantém a documentação no mesmo origin da API. Assim o frontend pode usar simplesmente `/docs/`, sem conhecer porta ou nome de container.

### Deployment standalone

`deploy/docs/` usa `127.0.0.1:38280` por padrão e pode ficar continuamente online mesmo durante deploy/restart das stacks da API.
