# Validação dos deployments — Connect|API

## Contrato canônico

Os deployments versionados do Connect|API possuem identidade Docker explícita e previsível.

Para cada stack independente:

```text
project        argws-connect-<deployment>
network        argws-connect-<deployment>-net
service        <recurso>-argws-connect-<deployment>
container_name idêntico ao service
```

O workflow **Deployment Naming Integrity** descobre automaticamente todos os arquivos `compose*.yaml/yml` e `docker-compose*.yaml/yml` versionados e falha caso exista um Compose fora do contrato.

## Stacks operacionais principais

| Deployment | Project |
| --- | --- |
| production | `argws-connect-production` |
| homologation | `argws-connect-homologation` |
| develop | `argws-connect-develop` |
| canonical | `argws-connect-canonical` |
| platform | `argws-connect-platform` |
| platform-develop | `argws-connect-platform-develop` |

`deploy/platform-develop/` é uma stack completa e independente. Não usa overlay de `deploy/develop`.

## Platform develop

Project e rede obrigatórios:

```text
argws-connect-platform-develop
argws-connect-platform-develop-net
```

Componentes obrigatórios:

- Connect|API Engine;
- Connect|API DOCs;
- PostgreSQL operacional;
- Redis;
- RabbitMQ;
- MinIO;
- PostgreSQL da Platform;
- migrations Platform e tenants;
- bootstrap;
- Control API;
- worker;
- scheduler;
- frontend Vue/PWA;
- gateway.

Todos os componentes sobem por padrão, sem `--profile platform`.

Imagens da aplicação devem usar o canal `develop`:

```text
ghcr.io/wkarts/argws-connect-api:develop
ghcr.io/wkarts/argws-connect-docs:develop
ghcr.io/wkarts/argws-connect-platform-api:develop
ghcr.io/wkarts/argws-connect-platform-web:develop
ghcr.io/wkarts/argws-connect-platform-gateway:develop
```

## Portas e domínios develop

```text
API Engine  127.0.0.1:38082  d.api.connect.argws.com.br
DOCs        127.0.0.1:38182  d.docs.connect.argws.com.br
Gateway     127.0.0.1:38802  hosts da Platform
```

Hosts da Platform:

```text
d.connect.argws.com.br
d.control.connect.argws.com.br
d.admin.connect.argws.com.br
d.partner.connect.argws.com.br
d.demo.connect.argws.com.br
<tenant>.d.connect.argws.com.br
```

Como API e DOCs preservam as portas do develop clássico, `argws-connect-develop` e `argws-connect-platform-develop` não podem operar simultaneamente com os valores padrão. Para coexistência, altere as portas da Platform develop.

## Persistência e isolamento

A Platform develop usa somente bind mounts próprios em:

```text
deploy/platform-develop/volumes/
```

Nenhum volume de `deploy/develop` é compartilhado automaticamente. Sessões WhatsApp existentes só devem ser migradas com a stack antiga parada.

## Segredos

`deploy/platform-develop/prepare-env.sh`:

- copia `env.example` para `.env`;
- sincroniza `CONNECT_API_VERSION` com `VERSION`;
- gera valores fortes para todos os placeholders `CHANGE_ME_*`;
- aplica `chmod 600`.

`preflight.sh` recusa ambiente com placeholder pendente e valida project, network, services, containers, imagens e domínios antes do deploy.

## CI

A validação é dividida entre:

- **Deployment Naming Integrity** — project/service/container/network de todos os Compose;
- **Platform Integrity** — Control API, Vue/PWA, testes da Platform e renderização dos deployments Platform;
- **Deployment Integrity** — stacks operacionais e contratos gerais de deployment;
- **Database Integrity** — migrations e integridade dos bancos;
- **Security Scan** — verificações de segurança;
- **Docs Integrity** e **DOCs Deployment Integrity** — documentação e imagem DOCs.
