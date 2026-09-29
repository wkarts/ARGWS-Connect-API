# Deploy — CloudPanel

O runtime usa `docker-compose.yml`, `.env` e `./volumes/*`. Configure o proxy do
CloudPanel para a porta de API definida em `ARGWS_CONNECT_API_HOST_PORT`.

```bash
docker compose --env-file .env -f docker-compose.yml pull
docker compose --env-file .env -f docker-compose.yml up -d --pull never
```

Profiles e credenciais ficam somente no `.env`; os snippets de Nginx são apenas
referência para o proxy, não dependências da stack.

## Traccar interno no Manager

O menu **Traccar** aparece no Manager somente quando `TRACCAR_ENABLED=true`,
`TRACCAR_MODE=internal` e as credenciais internas existentes estão configurados.
Ele usa a rota já existente do Manager e consulta `http://traccar:8082` somente
na rede Docker. Não requer domínio, porta, Traefik, regra adicional do
CloudPanel nem arquivo de runtime. A senha administrativa e o cookie da sessão
do Traccar permanecem no processo da API e nunca são enviados ao navegador.
