# ARGWS Connect API — Develop

Stack canônica `develop` do Connect|API Engine.

- API: `https://d.api.connect.argws.com.br`
- Porta local API: `38082`
- Porta local DOCs: `38182`
- API image: `ghcr.io/wkarts/argws-connect-api:develop`
- DOCs image: `ghcr.io/wkarts/argws-connect-docs:develop`
- Persistência: `./volumes/...`
- Instâncias/sessões: `./volumes/instances`
- Serviços core: API, Connect|API DOCs, PostgreSQL, Redis, RabbitMQ e MinIO
- Profiles opcionais: `nats`, `kafka`, `extended`
- Manager legado: removido; a interface administrativa pertence à Connect|API Platform.

Convenção dos services core: `<recurso>-argws-connect-develop`.

```bash
bash prepare-env.sh
bash deploy.sh
```

## Platform develop

A Platform **não é mais instalada como overlay desta stack**.

O deployment oficial develop da Platform é independente e fica em:

```text
deploy/platform-develop/
```

Identidade:

```text
project: argws-connect-platform-develop
network: argws-connect-platform-develop-net
```

Ele contém sua própria cópia operacional de:

- Connect|API Engine;
- Connect|API DOCs;
- PostgreSQL do Engine;
- Redis;
- RabbitMQ;
- MinIO;
- PostgreSQL da Platform;
- migrations/bootstrap;
- Control API;
- worker/scheduler;
- frontend Vue/PWA;
- gateway.

A Platform develop mantém os mesmos domínios públicos do ambiente develop:

```text
d.connect.argws.com.br
d.control.connect.argws.com.br
d.admin.connect.argws.com.br
d.partner.connect.argws.com.br
d.api.connect.argws.com.br
d.docs.connect.argws.com.br
d.demo.connect.argws.com.br
<tenant>.d.connect.argws.com.br
```

Por padrão, a nova stack também usa `38082` para API e `38182` para DOCs para facilitar a substituição no reverse proxy. Portanto esta stack clássica e `argws-connect-platform-develop` não podem subir simultaneamente com essas portas. Para operação lado a lado, altere as portas na `.env` de `deploy/platform-develop/`.

Primeiro deploy da Platform develop:

```bash
cd ../platform-develop
bash prepare-env.sh
bash preflight.sh
bash deploy.sh
```

## Migrar sessões existentes

Nenhum volume desta stack é compartilhado automaticamente com a Platform develop.

Se for necessário levar sessões WhatsApp existentes de `deploy/develop/volumes/instances` para a nova stack, faça a migração de forma controlada com a stack antiga parada. Não monte o mesmo diretório de sessões simultaneamente em dois projects.

A funcionalidade **Adotar existente** da Platform continua disponível para Engines acessíveis, criando somente um `EngineBinding` sem recriar a instância.
