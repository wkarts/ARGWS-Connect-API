# ARGWS Connect API — Develop

    Stack independente `develop`.

    - URL: `https://d.api.connect.argws.com.br`
    - Porta local padrão: `38082`
    - API image: `ghcr.io/wkarts/argws-connect-api:develop`
    - Única porta publicada: API
    - Manager: `https://d.api.connect.argws.com.br/manager`
    - Persistência: `./volumes/...`
    - Serviços core: API, PostgreSQL, Redis, RabbitMQ e MinIO
    - Profiles opcionais: `nats`, `kafka`, `extended`

    Convenção dos services: `<recurso>-argws-connect-develop`.

    ```bash
    ./prepare-env.sh
    ./deploy.sh
    ```
    