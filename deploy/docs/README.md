# Connect|API DOCs — Standalone Produção

Deployment independente/always-on da documentação oficial estável.

- imagem: `ghcr.io/wkarts/argws-connect-docs:latest`;
- bind local: `127.0.0.1:38280`;
- URL pública padrão: `https://docs.connect.argws.com.br`;
- servidor da API exibido pelo Scalar: variável `SERVER_URL`;
- healthcheck: `/health`.

O hostname público é atendido pelo CloudPanel/Nginx usando `nginx-location.conf.example`. O container continua acessível localmente pela porta 38280 sem depender da API.

Antes do deploy, ajuste no `.env` tanto a URL pública da documentação quanto a URL pública da API que deve aparecer no seletor `Server` e ser usada pelo `Try It`:

```env
SERVER_URL=https://api.seu-dominio.com.br
ARGWS_CONNECT_DOCS_PUBLIC_URL=https://docs.seu-dominio.com.br
```

```bash
cp env.example .env
./preflight.sh
./deploy.sh
```

As stacks completas mantêm seus próprios DOCs integrados nas portas `3818x`. Esta stack é a documentação pública estável e pode permanecer online durante deploys da API.
