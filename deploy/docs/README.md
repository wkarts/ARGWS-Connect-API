# Connect|API DOCs — Standalone Produção

Deployment independente/always-on da documentação oficial estável.

- imagem: `ghcr.io/wkarts/argws-connect-docs:latest`;
- bind local: `127.0.0.1:38280`;
- URL pública padrão: `https://docs.connect.argws.com.br`;
- healthcheck: `/health`.

O hostname público é atendido pelo CloudPanel/Nginx usando `nginx-location.conf.example`. O container continua acessível localmente pela porta 38280 sem depender da API.

```bash
cp env.example .env
./preflight.sh
./deploy.sh
```

As stacks completas mantêm seus próprios DOCs integrados nas portas `3818x`. Esta stack é a documentação pública estável e pode permanecer online durante deploys da API.
