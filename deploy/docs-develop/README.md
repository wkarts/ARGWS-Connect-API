# Connect|API DOCs — Develop

Runtime: `compose.yaml` e `.env`.

```bash
docker compose --env-file .env -f compose.yaml pull
docker compose --env-file .env -f compose.yaml up -d --pull never
```

Configure a URL pública no `.env`; não há scripts auxiliares de implantação.
