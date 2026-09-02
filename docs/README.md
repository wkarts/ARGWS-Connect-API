# Connect|API DOCs

O `docs` é um service oficial da stack Connect|API baseado em **Scalar API Reference** e contratos OpenAPI/AsyncAPI versionados junto do código.

## Objetivos

- referência REST interativa da API nativa;
- referência Meta Compatible `/graph`;
- catálogo de eventos;
- exemplos de autenticação e uso;
- documentação versionada junto da aplicação;
- validação automática para impedir drift entre código e docs.

## Service

O `docker-compose.yaml` publica o Scalar em:

```text
http://127.0.0.1:38082
```

O host/porta podem ser alterados por:

```text
ARGWS_CONNECT_DOCS_IMAGE
ARGWS_CONNECT_DOCS_HOST_PORT
ARGWS_CONNECT_BIND_ADDRESS
```

Healthcheck do container:

```text
/health
```

## Documentos carregados no Scalar

```text
docs/openapi/connect-api.openapi.json
docs/openapi/meta-compatible.openapi.json
docs/asyncapi/connect-api-events.asyncapi.json
```

O Scalar recebe múltiplas sources e permite alternar entre REST nativo, Meta Compatible e Eventos.

## Branding

O service reutiliza os assets canônicos já existentes:

```text
public/branding/connect-api/docs/
public/branding/connect-api/core/
```

A apresentação inicial é clara, com dark mode opcional.

## Geração

```bash
npm run docs:generate
```

O gerador percorre as definições `*.router.ts`, resolve mounts de routers e materializa o inventário OpenAPI da API nativa. A camada Meta Compatible e o catálogo de eventos recebem schemas/descrições específicas.

## Validação

```bash
npm run docs:check
```

O check falha quando:

- uma rota mudou e o OpenAPI não foi regenerado;
- o enum `Events` mudou e o AsyncAPI ficou stale;
- um arquivo gerado obrigatório não existe;
- o inventário de cobertura não corresponde ao código atual.

## Estrutura

```text
docs/
├── DOCUMENTATION-CONTRACT.md
├── README.md
├── scripts/
│   └── generate-openapi.mjs
├── openapi/
│   ├── connect-api.openapi.json
│   ├── meta-compatible.openapi.json
│   └── coverage.json
├── asyncapi/
│   └── connect-api-events.asyncapi.json
└── guides/
    ├── getting-started.md
    ├── authentication.md
    ├── instances.md
    ├── messages.md
    ├── events.md
    ├── meta-compatible.md
    ├── deployment.md
    └── troubleshooting.md
```

## Regra de manutenção

Leia `DOCUMENTATION-CONTRACT.md` antes de finalizar mudanças públicas. Documentação é parte do Definition of Done do Connect|API.
