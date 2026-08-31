# ARGWS Connect API — Production

    Stack independente `production`.

    - URL: `https://api.connect.argws.com.br`
    - Porta local padrão: `38080`
    - API image: `ghcr.io/wkarts/argws-connect-api:latest`
    - Única porta publicada: API
    - Manager: `https://api.connect.argws.com.br/manager`
    - Persistência: `./volumes/...`
    - Serviços core: API, PostgreSQL, Redis, RabbitMQ e MinIO
    - Profiles opcionais: `nats`, `kafka`, `extended`

    Convenção dos services: `<recurso>-argws-connect-production`.

    ```bash
    ./prepare-env.sh
    ./deploy.sh
    ```
    