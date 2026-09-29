# ARGWS Connect API — Produção

Runtime: `compose.yaml`, `.env` e `./volumes/*`.

```bash
docker compose --env-file .env -f compose.yaml pull
docker compose --env-file .env -f compose.yaml up -d --pull never
```

Preserve o `.env` e os volumes existentes. A seleção de profiles pertence ao
`.env`; nenhum instalador externo é necessário.
