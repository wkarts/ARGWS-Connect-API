> **Modelos atuais:** o perfil `operations` é entregue selecionado e seu segredo é gerado pelo preparador. Todos os modelos ativos de API estão cobertos; `canonical` antiga e DOCs independentes são preservados. Consulte [implantação e gráficos operacionais](../docs/operations/deploy-and-statistics.md).

# Deployments oficiais — ARGWS Connect API

A plataforma possui duas stacks oficiais e autocontidas: `deploy/production/` e `deploy/homologation/`.

Cada ambiente possui projeto Compose, rede, banco, cache, event bus, bucket e persistência física próprios e pode rodar simultaneamente no mesmo host.

## Portas locais oficiais

Cada stack publica duas portas de aplicação: API e Connect|API DOCs. A infraestrutura continua interna.

- Produção: API `127.0.0.1:38080` | DOCs `127.0.0.1:38180`
- Homologação: API `127.0.0.1:38081` | DOCs `127.0.0.1:38181`
- Develop: API `127.0.0.1:38082` | DOCs `127.0.0.1:38182`
- Canonical: API `127.0.0.1:38083` | DOCs `127.0.0.1:38183`

`/manager`, `/health`, `/metrics`, WebSocket, webhooks e demais rotas da aplicação continuam no endpoint da API. O Scalar roda no service `docs`.

## Core padrão

Sem nenhum profile adicional, as duas stacks sobem:

- API;
- Connect|API DOCs;
- PostgreSQL;
- Redis;
- RabbitMQ;
- MinIO.

PostgreSQL é o banco oficial, Redis é cache/estado rápido, RabbitMQ é o event bus/fila padrão e MinIO é o storage S3 local.

## Mensageria opcional

NATS, Kafka e MySQL auxiliar permanecem disponíveis no mesmo `compose.yaml` por profiles e ficam desligados por padrão na stack normal. Enquanto desligados, seus containers não são criados e não consomem CPU/RAM do runtime. A full stack usa exatamente esse Compose com todas as flags locais ligadas.

- `nats` → sobe NATS com JetStream;
- `kafka` → sobe Kafka + Zookeeper;
- `mysql` → sobe MySQL auxiliar; PostgreSQL continua sendo o banco da API;
- `extended` → sobe NATS + Kafka + Zookeeper.

Na stack normal, altere as flags no `.env` e execute o preparador antes do deploy; ele sincroniza `COMPOSE_PROFILES` sem trocar segredos:

```bash
NATS_ENABLED=true
KAFKA_ENABLED=true
MYSQL_SERVICE_ENABLED=true
./prepare-env.sh
./deploy.sh
```

`COMPOSE_PROFILES` explícito continua compatível para instalações antigas, mas as flags são a fonte de seleção no fluxo atual. A full stack mantém `OPERATIONS_ENABLED`, `NATS_ENABLED`, `KAFKA_ENABLED`, `MYSQL_SERVICE_ENABLED` e `TRACCAR_ENABLED` ligados.

Eles não substituem Redis. NATS/Kafka sobrepõem parte do papel de mensageria do RabbitMQ, mas atendem cenários diferentes: RabbitMQ continua como padrão; NATS é útil para pub/sub de baixa latência e comunicação entre serviços; Kafka é útil para alto volume, retenção e replay de eventos. Zookeeper é infraestrutura do Kafka usado nessa versão e não é consumido diretamente pela API.

## Manager

O Manager atual é servido em `/manager` pela própria API e não possui service/container separado.

## Deploy sem preencher segredos manualmente

Na primeira execução, `prepare-env.sh` cria `.env` a partir de `env.example`, gera os segredos fortes localmente, aplica `chmod 600` e mantém o arquivo fora do Git.

```bash
./registry-login.sh   # somente se o GHCR exigir autenticação
./deploy.sh
```

## Persistência

Core:

```text
./volumes/
├── instances/
├── postgres/
├── redis/
├── rabbitmq/
├── minio/
├── logs/
└── backups/
```

Profiles opcionais podem usar também `./volumes/nats`, `./volumes/kafka` e `./volumes/zookeeper`. Não são usados named volumes.

## Preparo seguro de volumes opcionais

Os scripts oficiais `deploy.sh` e `update.sh` agora executam, depois do pull e antes do start, o
preparador local `prepare-volumes.py`. Quando os profiles `mysql` ou `kafka` estão selecionados,
ele identifica o UID/GID real da imagem e prepara somente diretórios de bind **vazios** de MySQL,
Kafka e ZooKeeper. Diretórios com dados, em uso ou sem permissão compatível são recusados sem
alteração: não há `chmod 777`, `chown -R`, remoção de dados ou volumes nomeados.

CloudPanel e Dockge continuam suportados. Se o deploy for feito pelo botão direto da interface,
execute antes do primeiro Up com esses profiles o `prepare-volumes.py` da própria stack. Os scripts
oficiais já fazem isso automaticamente.

## Parceiro Fersoft

Os quatro perfis autocontidos ficam em `deploy/fersoft/`: `develop/`, `develop/full-stack/`,
`production/` e `production/full-stack/`. Eles isolam projeto Compose, rede, serviços internos,
bancos, domínio, porta e dados com a identidade Fersoft. As referências GHCR são herdadas, sem
alteração, dos respectivos templates ARGWS de origem. Nenhum deployment oficial existente foi
removido ou substituído.

## GHCR

Produção e homologação consomem exclusivamente imagens `ghcr.io/wkarts/argws-connect-*`. O bootstrap inicial já foi executado com sucesso e o workflow de sincronização mantém core e mensageria opcional espelhados no GHCR.

`production/` e `homologation/` são as referências canônicas para o provisionamento futuro do Control Plane; CloudPanel e Dockge continuam como integrações operacionais.


## DOCs standalone / always-on

`deploy/docs/` mantém o Connect|API DOCs online de forma independente na porta local `38280`. O reverse proxy recomendado publica a documentação em `/docs/` no mesmo hostname da API.


## Connect|API DOCs — hostnames públicos

- `deploy/docs/` → `https://docs.connect.argws.com.br` → `127.0.0.1:38280` → `:latest`;
- `deploy/docs-develop/` → `https://d.docs.connect.argws.com.br` → `127.0.0.1:38282` → `:develop`.

As stacks completas mantêm DOCs integrados nas portas `38180` a `38183`. A variável `ARGWS_CONNECT_DOCS_PUBLIC_URL` define o destino público usado pela aplicação; somente o deployment `develop` usa por padrão `d.docs.connect.argws.com.br`.

## Google Find Hub

[Guia completo de implantação e autenticação](../docs/guides/google-find-hub.md). A chave local é preparada por `prepare-findhub-env.py`, sem rotacionar segredos existentes. O Scalar inclui o documento `openapi/findhub.openapi.json`.
