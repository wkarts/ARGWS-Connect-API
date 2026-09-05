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

**Retaguarda emergencial:** comandos de scripts não compõem o deploy normal. Use somente o Compose e o `.env` no gerenciador da stack, conforme `OPERATIONS-CONTRACT.md`.

## Contrato operacional vigente

No gerenciador de stacks, forneça o Compose deste deployment e o `.env`, preservando os volumes existentes. Credenciais de registry pertencem à configuração do gerenciador. O pooler gera seus próprios arquivos dentro do container; migrations, bootstrap e backup continuam sob responsabilidade dos serviços. Atualize as imagens homologadas pela ação de atualização da stack, sem aplicadores externos ou overlays obrigatórios. Consulte `OPERATIONS-CONTRACT.md` e `docs/guides/database-pooling.md`.
