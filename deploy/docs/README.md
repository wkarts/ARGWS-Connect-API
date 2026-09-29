# Connect|API DOCs — Produção

Runtime: `compose.yaml` e `.env`.

```bash
docker compose --env-file .env -f compose.yaml pull
docker compose --env-file .env -f compose.yaml up -d --pull never
```

Configure `SERVER_URL` e `ARGWS_CONNECT_DOCS_PUBLIC_URL` no `.env`. O exemplo
Nginx é somente para o proxy público.
