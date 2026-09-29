# ARGWS Connect API — Develop

Runtime: `compose.yaml`, `.env` e `./volumes/*`.

```bash
docker compose --env-file .env -f compose.yaml pull
docker compose --env-file .env -f compose.yaml up -d --pull never
```

Os profiles são definidos no `.env`; o mesmo Compose atende core e full stack.
