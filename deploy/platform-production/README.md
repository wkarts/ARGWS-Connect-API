# Connect|API Platform — Production

Stack **completa, independente e autocontida** da Connect|API Platform para produção.

Ela não é overlay de `deploy/production/` e não compartilha project, network ou volumes com a stack clássica.

## Identidade Docker

- project: `argws-connect-platform-production`
- network: `argws-connect-platform-production-net`
- services: `<recurso>-argws-connect-platform-production`
- `container_name`: idêntico ao service

## Domínios

- Platform: `https://connect.argws.com.br`
- Control Plane: `https://control.connect.argws.com.br`
- Administração: `https://admin.connect.argws.com.br`
- Partner Plane: `https://partner.connect.argws.com.br`
- API/Engine: `https://api.connect.argws.com.br`
- DOCs: `https://docs.connect.argws.com.br`
- Demo: `https://demo.connect.argws.com.br`
- Tenants: `*.connect.argws.com.br`

## Portas locais

- Engine API: `127.0.0.1:38080`
- DOCs: `127.0.0.1:38180`
- Platform Gateway: `127.0.0.1:38800`

O gateway é o ponto recomendado para os hosts da Platform. API e DOCs continuam expostos em loopback para compatibilidade operacional e troubleshooting.

## Componentes

A stack sobe por padrão:

- Connect|API Engine;
- Connect|API DOCs;
- PostgreSQL do Engine;
- Redis;
- RabbitMQ;
- MinIO;
- PostgreSQL da Platform/Control Plane;
- migrations da Platform;
- migrations dos tenants;
- bootstrap da Platform;
- Platform Control API;
- Platform Worker;
- worker dedicado de backups;
- Platform Scheduler;
- Docker Socket Proxy somente leitura + Log Agent;
- Prometheus + Grafana;
- ACME + CloudPanel Agent opcionais pelo profile `cloudpanel`;
- Platform Web;
- Platform Gateway.

## Lifecycle

Production segue o lifecycle canônico do Connect|API:

- Engine/DOCs/Platform usam `:latest` no deployment operacional;
- releases imutáveis continuam usando a mesma SemVer da raiz;
- a Platform não possui versão própria;
- `VERSION`/`package.json` da raiz continuam sendo a fonte canônica.

## CloudPanel / ACME opcional

O deployment padrão continua sem privilégios de host. Quando o ambiente usa CloudPanel e deseja gestão automática do wildcard/certificado, ative o profile:

```bash
docker compose --env-file .env --profile cloudpanel up -d
```

Para Nginx/Certbot de host sem CloudPanel, use `deploy/platform/domain-agent/`.

## Primeiro deploy

```bash
cd deploy/platform-production
./prepare-env.sh
# revisar .env e domínios/segredos
./preflight.sh
./deploy.sh
```

## Atualização

```bash
./update.sh
```

## Status

```bash
./status.sh
```

## Stack clássica x Platform

`deploy/production/` continua sendo a opção production clássica/API-first.

`deploy/platform-production/` é a opção production do **produto completo**. Elas são stacks distintas e não devem ser iniciadas simultaneamente com as mesmas portas locais. Escolha qual deployment irá atender os domínios públicos de production.
