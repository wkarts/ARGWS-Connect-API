# ARGWS Connect API — Canonical

    Stack independente `canonical`.

    - URL: `https://c.api.connect.argws.com.br`
    - Porta local API: `38083`
    - Porta local DOCs: `38183`
    - API image: `ghcr.io/wkarts/argws-connect-api:1.0.7`
    - Portas locais publicadas: API + Connect|API DOCs
    - Manager: `https://c.api.connect.argws.com.br/manager`
    - Persistência: `./volumes/...`
    - Serviços core: API, Connect|API DOCs, PostgreSQL, Redis, RabbitMQ e MinIO
    - Profiles opcionais: `nats`, `kafka`, `extended`

    Convenção dos services: `<recurso>-argws-connect-canonical`.

    ```bash
    ./prepare-env.sh
    ./deploy.sh
    ```
    