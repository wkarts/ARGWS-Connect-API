# Connect|API Platform — Arquitetura de Produto

## Decisão arquitetural

A Platform é uma nova camada do mesmo produto/repositório. Ela **não substitui** a API Node/TypeScript.

```text
Platform = controle, UX, tenancy, governança, provisionamento
Engine   = comunicação, providers, templates, Actions, Recipes, Micro Apps, eventos
```

## Componentes

### Engine

Serviço `connect-engine`, baseado na aplicação Node atual. Pode ser implantado sozinho e continua sendo uma API pública completa.

### Platform Control API

FastAPI em `platform/control-api`. Responsável por Control/Partner/Tenant Plane, autenticação, RBAC, 2FA, branding, domínios, provisionamento e bridge interno para o Engine.

### Engine Bridge

A Platform mantém um `EngineBinding` por tenant/instância. O navegador nunca recebe a API key global do Engine. Instâncias criadas pela Platform recebem nomes tenant-scoped (`t-<tenant>-<alias>`).

### Platform Web

Vue 3 + TypeScript + Pinia + Router + Tailwind em `platform/web`.

### Gateway

Nginx em `platform/gateway` direciona hostnames da API, DOCs e planes do produto para os containers corretos.

## Studios

- Template Studio → Template Engine;
- Integration Studio → Action Registry;
- Automation Studio → Recipe Engine;
- Micro App Studio → Micro App runtime;
- Flow/Graph View → opcional no futuro, como visualização da definição declarativa.

## Isolamento

A Platform usa database-per-tenant para seu domínio próprio conforme o RC34. O Engine mantém o banco operacional existente nesta etapa. O vínculo é explícito no Platform DB e verificado em toda rota bridge.

## Lifecycle

Nenhum `VERSION` do RC34 foi promovido a lifecycle independente. A raiz Connect|API continua canônica e os componentes Platform recebem `APP_VERSION` da mesma release.
