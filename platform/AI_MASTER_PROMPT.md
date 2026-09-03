# PROMPT MESTRE — CONNECT|API PLATFORM

Você está trabalhando no repositório canônico **Connect|API Platform**. Antes de alterar código, leia `README.md`, `PRODUCT_IDENTITY.md`, `CONNECT_API_DOMAIN_BLUEPRINT.md`, `connect-api.config.yaml`, `docs/architecture/ARCHITECTURE.md` e `docs/security/TENANT_ISOLATION.md`.

## Identidade imutável
- Nome visual: `Connect|API Platform`; curto: `Connect|API`;
- `|` é obrigatório na marca visual;
- técnico: `connect-api-platform`, `connect-api`, `connect_api_*`;
- light mode é padrão;
- use somente os assets em `branding/official`; não redesenhe logos;
- PBX, VOIP e DOCs são extensões/submarcas oficiais.

## Arquitetura que não pode ser degradada
Preserve Control Plane x Tenant Plane, database-per-tenant, tenant por hostname, migrations separadas, provisioning, storage segregado, RBAC, 2FA do Control Plane, auditoria, rate limit, backups, Redis/RabbitMQ/Celery, Outbox, observabilidade e segurança de secrets.

## Domínio Connect|API
Implemente progressivamente Channels, Instances, Messages, Events, Webhooks, Automations, Integrations, PBX e VOIP segundo `CONNECT_API_DOMAIN_BLUEPRINT.md`. Não renomeie modelos financeiros antigos para conceitos de mensageria. O domínio financeiro herdado é referência e permanece desativado por padrão via `ENABLE_REFERENCE_FINANCIAL_DOMAIN=false`.

## Padrão obrigatório para cada módulo
1. model tenant; 2. migration tenant; 3. schemas; 4. service/use-case; 5. endpoints; 6. RBAC; 7. auditoria; 8. eventos/Outbox; 9. telas Vue; 10. testes de isolamento A/B; 11. docs OpenAPI.

## Segurança
Nunca registre tokens, cookies, Authorization, API keys, secrets de provider, credenciais SIP ou senhas. Webhooks inbound devem validar autenticidade, timestamp/replay e idempotência. Webhooks outbound devem bloquear SSRF, usar allow/deny policy de destinos e assinatura HMAC. Jobs devem carregar tenant context explicitamente.

## Critério de aceite
Executar backend tests, frontend build/typecheck, `docker compose config`, validação de manifests/assets, auditoria de identidade e teste de isolamento entre dois tenants. Atualizar `SPECIALIZATION_REPORT.md`/changelog apenas com fatos verificáveis.
