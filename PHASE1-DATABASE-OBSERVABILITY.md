# ARGWS Connect API — Phase 1 Database & Observability Foundation

This temporary branch document records the Phase 1 stabilization contract.

## Database

- The product starts from new databases; no legacy product database upgrade is supported by this baseline.
- PostgreSQL and MySQL migrations must create canonical ARGWS Connect names directly.
- `ConnectBot`, `ConnectBotSetting`, `ConnectAI`, `ConnectAISetting` are canonical database names.
- PostgreSQL and PgBouncer schemas must have identical data models; PgBouncer differs only in datasource configuration.
- MySQL must expose every field used by provider-independent runtime code.
- Provider-specific Prisma JSON path syntax is isolated behind `prismaJsonPath`.

## Observability

- Generic application payloads and credentials must not be written to stdout in clear text or in derived form.
- Generic dynamic values are reduced to static type descriptors such as `[STRING REDACTED]`, `[BUFFER REDACTED]`, `[ERROR REDACTED]`, `[ARRAY REDACTED]` and `[OBJECT REDACTED]`.
- The generic logger must not derive hashes, lengths, object keys, error properties or fingerprints from values that may contain credentials or API keys.
- Fixed lifecycle/status messages remain available through the explicit system log surface.
- WhatsApp terminal QR rendering is explicitly supported through `LOG_QRCODE` and must not include pairing codes.
- Prometheus remains independent of the log stream.
- CodeQL must remain green for all logging changes.

## Docker boot

- Database migrations run before application startup.
- Migration retries tolerate database startup ordering.
- Database connection URIs are never echoed to logs.
- The runtime image does not embed `.env`.
- Docker health uses `/health`, which is local and does not depend on WhatsApp or another external service.

## CI acceptance

A Phase 1 change is accepted only when:

1. PostgreSQL schema validates.
2. PostgreSQL migrations apply from zero on an empty PostgreSQL database.
3. PostgreSQL Prisma client type-checks the application.
4. MySQL schema validates.
5. MySQL migrations apply from zero on an empty MySQL database.
6. MySQL Prisma client type-checks the application.
7. PgBouncer schema matches PostgreSQL models.
8. Lint and production build pass.
9. Security scanning remains enabled and green.
