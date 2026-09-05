# ARGWS Connect API — Homologação

Stack oficial de homologação com core enxuto e mensageria avançada opcional.

## Core padrão

Sem profiles adicionais, sobe apenas:

```text
ARGWS Connect API
├── Connect|API DOCs
├── PostgreSQL
├── Redis
├── RabbitMQ
└── MinIO
```

A API publica `127.0.0.1:38081` e o Connect|API DOCs publica `127.0.0.1:38181`. `/manager`, `/health`, `/metrics`, WebSocket e webhooks da aplicação continuam no endpoint da API.

## Mensageria opcional

O Compose também contém:

- profile `nats` → NATS + JetStream;
- profile `kafka` → Kafka + Zookeeper;
- profile `extended` → NATS + Kafka + Zookeeper.

Enquanto um profile está desligado, seus containers não são criados e não consomem recursos do runtime.

Exemplos:

```bash
COMPOSE_PROFILES=nats ./deploy.sh
COMPOSE_PROFILES=kafka ./deploy.sh
COMPOSE_PROFILES=extended ./deploy.sh
```

RabbitMQ continua sendo o event bus/fila padrão. NATS é indicado para pub/sub de baixa latência e comunicação entre serviços; Kafka para retenção, replay e alto volume de eventos. Zookeeper existe somente como dependência do Kafka nesta versão.

## Política de imagem

A homologação usa exclusivamente a imagem contínua da branch `develop`:

```text
ghcr.io/wkarts/argws-connect-api:develop
ghcr.io/wkarts/argws-connect-docs:develop
```

A branch `develop` nunca publica `:latest`, tag SemVer ou GitHub Release. Cada push/merge em `develop` substitui a mesma tag `:develop`.

Quando a versão em homologação estiver confiável, o fluxo é:

```text
develop → PR para main → merge → versão SemVer → GitHub Release
```

A `main` continua sendo a linha estável/versionada. A produção permanece presa a uma tag SemVer aprovada.

## Deploy direto

```bash
./registry-login.sh   # somente se os packages GHCR forem privados
./deploy.sh
**Retaguarda emergencial:** comandos de scripts não compõem o deploy normal. Use somente o Compose e o `.env` no gerenciador da stack, conforme `OPERATIONS-CONTRACT.md`.text
./volumes/instances
./volumes/postgres
./volumes/redis
./volumes/rabbitmq
./volumes/minio
./volumes/logs
./volumes/backups
```

Profiles opcionais podem usar `./volumes/nats`, `./volumes/kafka` e `./volumes/zookeeper`.

Produção e homologação permanecem isoladas por projeto Compose, rede, banco, Redis, RabbitMQ, bucket, porta e diretório físico.

## Operação

```bash
./update.sh
./status.sh
```

Use `nginx-location.conf.example` no CloudPanel para `h.api.connect.argws.com.br`. SSL/TLS termina no CloudPanel/Cloudflare; internamente a API permanece HTTP em `8080`.

## Contrato operacional vigente

No gerenciador de stacks, forneça o Compose deste deployment e o `.env`, preservando os volumes existentes. Credenciais de registry pertencem à configuração do gerenciador. O pooler gera seus próprios arquivos dentro do container; migrations, bootstrap e backup continuam sob responsabilidade dos serviços. Atualize as imagens homologadas pela ação de atualização da stack, sem aplicadores externos ou overlays obrigatórios. Consulte `OPERATIONS-CONTRACT.md` e `docs/guides/database-pooling.md`.
