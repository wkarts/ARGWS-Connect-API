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

- identidade telefônica estável disponível em `GET /compat/meta/{instanceName}`;
- `Authorization: Bearer <INSTANCE_TOKEN>`;
- identidade (`phoneNumberId`/`businessAccountId`) correspondente à instância correta.

### Templates no HUB e instâncias com o mesmo número

A API nativa usa `apikey`; as rotas `/graph` usam `Authorization: Bearer`.
Estar conectado ou ter o webhook configurado não comprova que o Bearer usado
na consulta de templates pertence à instância correta.

Quando duas instâncias persistidas compartilham o mesmo `phoneNumberId` ou
`businessAccountId`, o resolvedor prioriza, entre as identidades daquele objeto,
a instância cujo token corresponde ao Bearer. Assim, uma instância antiga não
provoca `401` apenas por aparecer primeiro na consulta. A autorização continua
obrigatória: token inválido, ausente ou pertencente a outro objeto não concede
acesso e mantém a resposta OAuth `190`/HTTP `401` para um objeto existente.

Essa seleção não altera a política administrativa já existente no
`MetaCloudAuthService`. O Bearer global continua aceito pelo código, mas não
individualiza instâncias com o mesmo número; nesse caso, a seleção legada é
preservada. Para integrações por caixa de entrada, utilize o token exclusivo da
instância e a identidade retornada por `/compat/meta/{instanceName}`.

A rota de templates é `GET /graph/{version}/{businessAccountId}/message_templates`.
Um `200` com `data: []` é uma consulta bem-sucedida sem modelos visíveis, não uma falha de autenticação.
Após a migration `20260911200000_local_templates`, ZAPO/Baileys possuem catálogo local real.
O `hello` em `pt_BR` é cadastrado para instâncias existentes pela migration e para novas instâncias na mesma gravação de criação.
A leitura não cria nem reabilita registros. Modelos arquivados não reaparecem. O HUB deve ser atualizado para reconhecer
`source=connectapi_local` e `status=LOCAL_READY`, e depois a caixa deve ser reconciliada.
Templates Business continuam no serviço oficial e na tabela anterior. Consulte `local-templates.md`.

Regressão automatizada: `test/meta-cloud/graph-identity-routing.test.ts`,
executada pela suíte existente `npm run test:compat`. Os testes usam banco e
providers simulados e não substituem a validação da instalação em produção.

## `/graph` retorna 409

A instância pode estar desconectada. Consulte o estado nativo e restabeleça a conexão antes do envio.

## Mídia não resolve em `/graph/{version}/{mediaId}`

A resolução depende de `Message`/`Media` existentes e do objeto correspondente em S3/MinIO. O service não cria uma cópia binária permanente apenas para compatibilidade.
