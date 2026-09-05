# Deploy — Dockge

Stack canônica do ARGWS Connect API para Dockge.

## Contrato de rede

`api` e `docs` possuem `ports:` dedicadas. PostgreSQL, Redis, RabbitMQ, MinIO e serviços opcionais ficam exclusivamente na rede `argws-connect-net`.

O Manager atual está dentro da imagem da API e pode ser aberto em:

```text
http(s)://SEU_HOST/manager
```

Assim, não existe `manager:3000` na stack de produção.

## Serviços padrão

O Deploy/Up normal inicia API, Connect|API DOCs, PostgreSQL, Redis, RabbitMQ e MinIO.

Perfis opcionais:

- `nats`;
- `kafka` (Kafka + Zookeeper);
- `extended` (NATS + Kafka + Zookeeper);
- `mysql` (provider alternativo).

No Dockge, configure `COMPOSE_PROFILES` no `.env` somente quando quiser iniciar um desses grupos.

## Persistência

Todos os dados ficam em `./volumes/...` dentro do diretório da própria stack. Não são usados named volumes.

## GHCR

O erro abaixo significa falta de acesso ao registry, e não falha do PostgreSQL/Redis:

```text
Head "https://ghcr.io/v2/.../manifests/...": denied
```

Se os packages estiverem privados, faça login **no host Docker onde o Dockge roda**:

```bash
export GHCR_USERNAME=wkarts
export GHCR_TOKEN='PAT_COM_READ_PACKAGES'
./registry-login.sh
```

O PAT precisa apenas de `read:packages` para pull.

Depois faça Pull e Deploy/Up pelo Dockge.

## Porta

Por padrão:

```env
ARGWS_CONNECT_BIND_ADDRESS=127.0.0.1
ARGWS_CONNECT_API_HOST_PORT=38080
ARGWS_CONNECT_DOCS_HOST_PORT=38180
SERVER_PORT=8080
```

`SERVER_PORT` é interno e não deve ser usado para escolher a porta publicada no host.

## Contrato operacional vigente

No gerenciador de stacks, forneça o Compose deste deployment e o `.env`, preservando os volumes existentes. Credenciais de registry pertencem à configuração do gerenciador. O pooler gera seus próprios arquivos dentro do container; migrations, bootstrap e backup continuam sob responsabilidade dos serviços. Atualize as imagens homologadas pela ação de atualização da stack, sem aplicadores externos ou overlays obrigatórios. Consulte `OPERATIONS-CONTRACT.md` e `docs/guides/database-pooling.md`.
