# Connect|API DOCs — Topologia oficial de deployment

## DOCs integradas por ambiente

| Ambiente | Porta local DOCs | Imagem | URL pública padrão |
|---|---:|---|---|
| Production | `38180` | `ghcr.io/wkarts/argws-connect-docs:latest` | `https://docs.connect.argws.com.br` |
| Homologation | `38181` | `ghcr.io/wkarts/argws-connect-docs:develop` | `https://docs.connect.argws.com.br` |
| Develop | `38182` | `ghcr.io/wkarts/argws-connect-docs:develop` | `https://d.docs.connect.argws.com.br` |
| Canonical | `38183` | `ghcr.io/wkarts/argws-connect-docs:<SemVer>` | `https://docs.connect.argws.com.br` |

CloudPanel e Dockge seguem o canal estável e apontam por padrão para `https://docs.connect.argws.com.br`.

## DOCs standalone / always-on

### Produção

- diretório: `deploy/docs/`;
- porta: `38280`;
- imagem: `ghcr.io/wkarts/argws-connect-docs:latest`;
- hostname: `https://docs.connect.argws.com.br`.

### Desenvolvimento

- diretório: `deploy/docs-develop/`;
- porta: `38282`;
- imagem: `ghcr.io/wkarts/argws-connect-docs:develop`;
- hostname: `https://d.docs.connect.argws.com.br`.

## Acesso interno e público

Os services DOCs integrados pertencem à mesma network Docker do respectivo ambiente e podem ser alcançados por outros containers através do DNS interno do Compose.

Os binds de host usam `127.0.0.1`, portanto as portas não são públicas por si só. A publicação externa acontece apenas quando CloudPanel/Nginx aponta um hostname ou rota para a porta local correspondente.

Os contratos Scalar usam URLs relativas `openapi/...`. Com isso, a mesma imagem funciona:

- diretamente em `http://127.0.0.1:<porta>/`;
- em hostname dedicado, como `https://docs.connect.argws.com.br/`;
- opcionalmente atrás de `/docs/` com reverse proxy que remova o prefixo antes de encaminhar ao container.

## Variável pública canônica

A aplicação utiliza:

```env
ARGWS_CONNECT_DOCS_PUBLIC_URL=https://docs.connect.argws.com.br
```

Somente o canal `develop` utiliza:

```env
ARGWS_CONNECT_DOCS_PUBLIC_URL=https://d.docs.connect.argws.com.br
```

O frontend não deve conhecer portas Docker ou nomes internos de services; deve navegar para `ARGWS_CONNECT_DOCS_PUBLIC_URL` ou, quando configurado no mesmo hostname, para uma rota pública relativa como `/docs/`.
