# Phase 6 — security boundaries

- `components` Meta não recebe extensões proprietárias da Phase 6.
- Sessões de Micro App usam token HMAC expiráveis e estado server-side.
- API keys e credenciais não são colocadas na URL pública do Micro App.
- Estado público remove chaves com nomes compatíveis com segredo/token/credential/cookie.
- Geofence `JUSTIFY` e `APPROVAL` são fail-closed nesta fase: sinalizam a condição e não autorizam automaticamente uma Action/Recipe.
- O modo operacional implementado no Studio é `CONVERSATION_SESSION`; valores de autenticação adicionais são reservados e não equivalem a enforcement de autenticação forte.
