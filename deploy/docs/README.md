# Connect|API DOCs — Deployment Standalone

Stack independente para manter a documentação oficial **sempre online**, sem depender do ciclo de vida da API, PostgreSQL, Redis, RabbitMQ ou MinIO.

## Componentes

- image: `ghcr.io/wkarts/argws-connect-docs:latest`;
- container: `docs-argws-connect-standalone`;
- bind local padrão: `127.0.0.1:38280`;
- URL pública recomendada: `https://api.connect.argws.com.br/docs/`;
- healthcheck: `/health`.

## Subir

```bash
cp env.example .env
./preflight.sh
./deploy.sh
```

## Reverse proxy

Use `nginx-location.conf.example` no mesmo virtual host da API. O `proxy_pass` remove o prefixo `/docs/` antes de encaminhar ao Scalar.

O frontend nunca precisa conhecer a porta `38280`: links da aplicação devem apontar para a URL relativa `/docs/`.

## Convivência com as stacks completas

Esta stack usa `38280`, portanto pode permanecer online enquanto `production`, `homologation`, `develop` ou `canonical` são atualizadas. As stacks completas continuam tendo seus próprios services DOCs nas portas `3818x`.

Se o reverse proxy público usar o standalone, mantenha `/docs/ -> 127.0.0.1:38280`. Se preferir o DOCs integrado da produção, use `/docs/ -> 127.0.0.1:38180`.
