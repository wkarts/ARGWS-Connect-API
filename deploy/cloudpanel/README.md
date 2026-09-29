# Deploy — CloudPanel

O runtime usa `docker-compose.yml`, `.env` e `./volumes/*`. Configure o proxy do
CloudPanel para a porta de API definida em `ARGWS_CONNECT_API_HOST_PORT`.

```bash
docker compose --env-file .env -f docker-compose.yml pull
docker compose --env-file .env -f docker-compose.yml up -d --pull never
```

Profiles e credenciais ficam somente no `.env`; os snippets de Nginx são apenas
referência para o proxy, não dependências da stack.
