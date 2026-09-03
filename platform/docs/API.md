# API — Connect|API Platform

OpenAPI: `/api/docs` e `/api/openapi.json`.

## Namespaces
- `/api/control/v1/*` — Control Plane;
- `/api/v1/*` — Tenant Plane;
- `/api/v1/connect/capabilities` — capacidades Connect|API;
- `/api/v1/context` — contexto/branding do tenant;
- `/api/v1/manifest.webmanifest` — manifesto PWA por tenant.

O domínio financeiro de referência só é registrado quando `ENABLE_REFERENCE_FINANCIAL_DOMAIN=true`.

## Regras
Toda operação tenant deve resolver tenant por hostname, aplicar autenticação/RBAC e nunca aceitar um `tenant_id` arbitrário para trocar de organização. Webhooks devem usar idempotência e autenticação do provider.
