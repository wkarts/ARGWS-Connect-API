# ARGWS Connect API — Production

    Stack independente `production`.

    - URL: `https://api.connect.argws.com.br`
    - Porta local API: `38080`
    - Porta local DOCs: `38180`
    - API image: `ghcr.io/wkarts/argws-connect-api:latest`
    - DOCs image: `ghcr.io/wkarts/argws-connect-docs:latest`
    - Portas locais publicadas: API + Connect|API DOCs
    - Manager: `https://api.connect.argws.com.br/manager`
    - Persistência: `./volumes/...`
    - Serviços core: API, Connect|API DOCs, PostgreSQL, Redis, RabbitMQ e MinIO
    - Profiles opcionais: `nats`, `kafka`, `extended`

    Convenção dos services: `<recurso>-argws-connect-production`.

    ```bash
    ./prepare-env.sh
    ./deploy.sh
    ```
    