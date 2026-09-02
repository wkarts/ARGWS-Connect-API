# ARGWS Connect API — Develop

    Stack independente `develop`.

    - URL: `https://d.api.connect.argws.com.br`
    - Porta local API: `38082`
    - Porta local DOCs: `38182`
    - API image: `ghcr.io/wkarts/argws-connect-api:develop`
    - DOCs image: `ghcr.io/wkarts/argws-connect-docs:develop`
    - Portas locais publicadas: API + Connect|API DOCs
    - Manager: `https://d.api.connect.argws.com.br/manager`
    - Persistência: `./volumes/...`
    - Serviços core: API, Connect|API DOCs, PostgreSQL, Redis, RabbitMQ e MinIO
    - Profiles opcionais: `nats`, `kafka`, `extended`

    Convenção dos services: `<recurso>-argws-connect-develop`.

    ```bash
    ./prepare-env.sh
    ./deploy.sh
    ```
    