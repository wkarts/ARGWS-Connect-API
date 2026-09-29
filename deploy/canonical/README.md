# ARGWS Connect API — Canonical

Runtime: `compose.yaml`, `.env` e `./volumes/*`.

```bash
docker compose --env-file .env -f compose.yaml pull
docker compose --env-file .env -f compose.yaml up -d --pull never
```

Configure profiles diretamente no `.env`. Não há instalador ou arquivo auxiliar.
