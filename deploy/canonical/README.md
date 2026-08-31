# ARGWS Connect API — Canonical

    Stack independente `canonical`.

    - URL: `https://c.api.connect.argws.com.br`
    - Porta local padrão: `38083`
    - API image: `ghcr.io/wkarts/argws-connect-api:1.0.7`
    - Única porta publicada: API
    - Manager: `https://c.api.connect.argws.com.br/manager`
    - Persistência: `./volumes/...`
    - Serviços core: API, PostgreSQL, Redis, RabbitMQ e MinIO
    - Profiles opcionais: `nats`, `kafka`, `extended`

    Convenção dos services: `<recurso>-argws-connect-canonical`.

    ```bash
    ./prepare-env.sh
    ./deploy.sh
    ```
    