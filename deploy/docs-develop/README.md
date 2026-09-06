# Connect|API DOCs — Standalone Develop

Deployment independente/always-on da documentação do canal de desenvolvimento.

- imagem: `ghcr.io/wkarts/argws-connect-docs:develop`;
- bind local: `127.0.0.1:38282`;
- URL pública padrão: `https://d.docs.connect.argws.com.br`;
- healthcheck: `/health`.

Esse ambiente acompanha a branch `develop` e não interfere na documentação estável em `docs.connect.argws.com.br`.

```bash
cp env.example .env
./preflight.sh
./deploy.sh
```
