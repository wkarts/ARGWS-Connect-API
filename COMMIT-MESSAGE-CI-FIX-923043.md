fix(ci): close Zapo typecheck and formatter failures

- preserve existing Baileys group typing and change formatting only
- keep QR and pairing-code behavior untouched
- validate ZAPO_LOG_LEVEL as the Zapo LogLevel union
- fix Prettier formatting in Zapo audio and VOIP concurrency code
- preserve PostgreSQL/MySQL migrations and Manager behavior

Fixes CI runs 92304396640, 92304396648 and 92304396970.
