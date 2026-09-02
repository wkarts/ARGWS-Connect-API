# Deploy do Connect|API DOCs

O Scalar é parte oficial da stack e roda como service `docs` no mesmo `docker-compose.yaml`.

## Service

O container usa a imagem oficial do Scalar API Reference e monta os contratos gerados como volumes somente leitura.

Porta padrão local:

```text
38082 → 8080
```

Variáveis:

```env
ARGWS_CONNECT_DOCS_IMAGE=scalarapi/api-reference:latest
ARGWS_CONNECT_DOCS_HOST_PORT=38082
```

O bind usa a mesma variável global da stack:

```env
ARGWS_CONNECT_BIND_ADDRESS=127.0.0.1
```

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
