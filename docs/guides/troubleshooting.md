# Troubleshooting

## Scalar abre, mas não mostra os contratos

Regere e valide:

```bash
npm run docs:generate
npm run docs:check
```

Confirme os arquivos:

```text
docs/openapi/connect-api.openapi.json
docs/openapi/meta-compatible.openapi.json
docs/asyncapi/connect-api-events.asyncapi.json
```

Depois recrie o service:

```bash
docker compose up -d --force-recreate docs
```

## `Docs Integrity` acusa documento stale

Uma rota, mount ou evento mudou sem regenerar os contratos.

```bash
npm run docs:generate
git diff -- docs/openapi docs/asyncapi
npm run docs:check
```

Revise o diff antes do commit; a geração automática não substitui a revisão semântica de exemplos e descrições específicas.

## Endpoint aparece com schema genérico

O inventário automático garante cobertura de rotas, mas endpoints que precisam de request/response detalhados devem receber override específico em:

```text
docs/scripts/generate-openapi.mjs
```

Não invente campos: use DTOs, JSON schemas e comportamento real do controller/service.

## Instância aparece no Manager, mas está desconectada

`close` significa instância desconectada, não necessariamente inexistente. Operações de lifecycle devem considerar persistência no banco além de memória/Redis.

## Erros Baileys `No session found to decrypt message`

São erros de sessão/Signal do provider e não indicam falha do Scalar ou da documentação. Analise separadamente o lifecycle da sessão e sincronização do WhatsApp.

## `Connection Closed` / status 428

Indica socket/provider fechado durante uma operação do WhatsApp. Não é erro do service `docs`.

## `/graph` retorna 401

Confirme:

- Meta Compatible habilitado para a instância;
- `Authorization: Bearer <INSTANCE_TOKEN>`;
- identidade (`phoneNumberId`/`businessAccountId`) correspondente à instância correta.

## `/graph` retorna 409

A instância pode estar desconectada. Consulte o estado nativo e restabeleça a conexão antes do envio.

## Mídia não resolve em `/graph/{version}/{mediaId}`

A resolução depende de `Message`/`Media` existentes e do objeto correspondente em S3/MinIO. O service não cria uma cópia binária permanente apenas para compatibilidade.
