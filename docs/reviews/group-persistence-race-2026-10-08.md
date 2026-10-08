# Group persistence race — 2026-10-08

## Evidence and scope

The diagnostics endpoint returned two `PrismaClientKnownRequestError` events with
code `P2002` at `2026-10-08T19:22:09.014Z` and `2026-10-08T19:22:09.105Z`, both
recorded as `unhandledRejection` with the same sanitized fingerprint. The API and
diagnostics endpoint subsequently returned HTTP 200. The transcription worker was
still in `created`, and its recovery command stopped before updating or starting
it because RabbitMQ was `running/unhealthy`.

The deployed application revision is `588df291fc5ba23598415a762a7213c1dfd917be`.
Its source tree matches local build source revision
`062029068c72fc8e23c1ce8ee814623eb2270e2e`. In that local build, the diagnostic
frames `main.js:346:1944` and `main.js:346:5906` map to the group Chat upsert and
its call from `handleIncomingMessage`, respectively. The local `dist/main.js`
SHA-256 is `0b6d4883500241a60571cb8a4d3fbbbb01dd71b7c0c3fbc95912ea913f1662c7`.
The deployed bundle hash was not collected, so the source-map correlation is
supporting evidence rather than a claim of byte-for-byte deployment verification.

The concurrency defect was independently reproduced by executing the actual
production method with a database double that coordinates two missing-row reads
before either insert. The pre-fix implementation rejects one caller with `P2002`.
The actual message callback also leaves a rejected handler Promise unobserved.

## Cause and correction

`Chat` is unique by `(instanceId, remoteJid)` on PostgreSQL and MySQL. When group
metadata is unavailable, `persistGroupConversation` intentionally uses an empty
upsert update to preserve an existing group name. Prisma can implement this
upsert as a read followed by an insert; two concurrent callers can both observe
the row as missing and one insert then conflicts with the other.

The correction retries only `chat.upsert` once when its error code is `P2002`,
using exactly the original `where`, `update`, and `create` arguments. Other errors
and any error from the second attempt propagate without another retry. The
`message` event callback observes and logs a rejected handler Promise through the
existing logger and its sanitized diagnostics path.

The retry does not replay `handleIncomingMessage`: message persistence, webhook
publication, chatbot processing and Chatwoot delivery may already have happened
before group persistence. Contact persistence and the group update notification
remain after the successful Chat write. This change does not introduce global
message or webhook deduplication.

No schema, migration, index, provider contract, SDK version, message payload,
session, speech model, engine, worker mode, queue or deployment topology changes
are included. The RabbitMQ health failure is a separate operational finding
whose cause requires the effective healthcheck output and runtime metrics.

## Regression coverage

`test/zapo-group-persistence.test.cjs` executes the production methods extracted
with the TypeScript AST without initializing external integrations. It covers:

- concurrent creation without metadata: both calls settle and one scoped row remains;
- preservation of an existing group name when metadata is unavailable;
- one contact write and group notification after the retried Chat write;
- propagation without retry for errors other than `P2002`;
- propagation of a second unique conflict after one retry;
- propagation of a different database error on the retry;
- observation of the message handler rejection and one log of the original error.

The suite is an explicit step in `Operations and ZAPO Regression Tests`.
Before the production fix, it reported 1 pass and 6 failures; after the fix it
reported 7 passes and 0 failures. Type checking and documentation integrity also
passed locally. This test uses a controlled database double, not a live PostgreSQL
or MySQL concurrency test and not a real WhatsApp session.

Final local validation used Node.js 24.19.0:

- `node --test test/zapo-group-persistence.test.cjs test/zapo-message-contract.test.cjs test/operations-groups-catalog.test.cjs test/zapo-baileys-parity.test.cjs`: 34 passed, 0 failed.
- `npx eslint src/api/integrations/channel/whatsapp/zapo.whatsapp.service.ts`: passed.
- `npx tsc --noEmit --incremental false`: passed.
- `npm run docs:check`: generated contracts are synchronized.
- `NODE_OPTIONS=--max-old-space-size=4096 npm run build`: CJS and ESM builds and the official runtime dependency check passed.
- `git diff --check`: passed.

The CI regression workflow uses Node.js 22. Local build success does not represent
a newly published container image or a VPS deployment.

## Deployment and validation

After the PR is merged and the usual image publication pipeline succeeds, deploy
the new API image through the existing stack workflow. This patch introduces no
new environment values or database migrations. Keep the installed volume,
hostname, worker mode and image provenance under the existing deployment controls.

Verify API health and inspect a new diagnostic time window after deployment.
Exercise concurrent incoming group messages with metadata temporarily unavailable
in a controlled test session: the Chat row must remain scoped to the instance,
existing names must remain intact, and this persistence race must not surface as
an unhandled rejection. Other genuine database failures must remain observable.

RabbitMQ must be independently verified before starting speech workers. An API
health response does not prove the broker, audio model or transcription pipeline
is ready. Complete a real transcription and dictation test before closing the
broader recovery incident.

## Rollback

Restore the previously recorded API image if the update introduces a regression.
There is no database or configuration rollback for this code change. The previous
image retains the original group-persistence race. No deployed service was
modified from the development workspace as part of preparing this patch.

## References

- [Prisma ORM v6 error reference: P2002](https://www.prisma.io/docs/orm/v6/reference/error-reference#p2002)
- [Prisma ORM v6 upsert concurrency and database-upsert criteria](https://www.prisma.io/docs/orm/v6/reference/prisma-client-reference#unique-key-constraint-errors-on-upserts)
- [RabbitMQ monitoring and health checks](https://www.rabbitmq.com/docs/monitoring)
