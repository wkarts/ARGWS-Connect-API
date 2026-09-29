# ARGWS Connect API — Homologação

Runtime: `compose.yaml`, `.env` e `./volumes/*`.

```bash
docker compose --env-file .env -f compose.yaml pull
docker compose --env-file .env -f compose.yaml up -d --pull never
```

Defina `COMPOSE_PROFILES` e as flags de services diretamente no `.env`.
