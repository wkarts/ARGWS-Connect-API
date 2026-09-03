# Runtime, exposição de portas e operação interna

## Contrato de rede

O runtime da Connect|API Platform adota o princípio **single-port**:

```text
Internet / Cloudflare / CloudPanel
               |
               v
     127.0.0.1:GATEWAY_PORT
               |
       connect-gateway
               |
       connect-internal
        /   /   |   \   \
      API PG  Redis Rabbit MinIO ...
```

Somente `connect-gateway` publica uma porta no host. Por padrão ela é ligada a
`127.0.0.1`, para consumo pelo reverse proxy local (CloudPanel/Nginx).

PostgreSQL, Redis, RabbitMQ, MinIO, workers, Celery Beat, migrations e demais
serviços **não publicam portas no host**. Eles se comunicam somente pela rede
Docker `connect-internal` usando DNS de serviço.

## Deploy é sempre image-only

Nenhum arquivo dentro de `deployments/` pode possuir `build:`. Os deployments
consomem exclusivamente as imagens oficiais:

```text
ghcr.io/YOUR_ORG/connect-api-platform-api:latest
ghcr.io/YOUR_ORG/connect-api-platform-web:latest
ghcr.io/YOUR_ORG/connect-api-platform-gateway:latest
```

O único modelo de build local permitido é `compose.local-build.yaml`, usado
explicitamente em desenvolvimento/CI junto com `compose.yaml`:

```bash
docker compose -f compose.yaml -f compose.local-build.yaml up -d --build
```

Esse arquivo não é consumido por Dockge, Portainer, CloudPanel, staging ou
produção.

## Persistência

O runtime usa bind mounts visíveis dentro da pasta da stack:

```text
./data-postgres
./data-redis
./data-rabbitmq
./data-minio
./data-backups
./data-runtime
./data-celery
./secrets
```

Não há dependência de named volumes para os dados principais.

## Preflight antes de migrations

`connect-preflight` executa antes da inicialização do storage e das migrations,
sem acesso à rede (`network_mode: none`). Ele valida coerência de configuração
sem imprimir valores secretos.

Entre os erros bloqueados antes de alterar banco ou subir a aplicação:

- placeholders `CHANGE_ME` em segredos obrigatórios de produção;
- usuário PostgreSQL administrativo igual ao usuário principal com senha divergente;
- credenciais RabbitMQ inconsistentes;
- credenciais S3/MinIO inconsistentes quando a stack usa o MinIO interno;
- valor inválido de `SMTP_SECURITY`;
- SMTP 465 configurado sem `ssl`;
- integrações habilitadas sem credenciais mínimas.

## Logs e auditoria

Todos os containers do runtime usam logging Docker com rotação (`driver: local`,
limite por arquivo e retenção curta). Isso impede crescimento ilimitado dos logs
do daemon.

A evolução do Control Plane para auditoria centralizada deve seguir este modelo:

1. um coletor interno (Vector, Fluent Bit, OpenTelemetry Collector ou equivalente)
   recebe logs/telemetria sem publicar porta no host;
2. o armazenamento de logs fica em rede interna e com retenção configurável;
3. o Control Plane consulta uma API interna autenticada de observabilidade;
4. a interface permite filtrar por serviço, tenant, nível, período, correlation id,
   request id e operação;
5. ações administrativas ficam registradas em audit log próprio;
6. segredos e payloads sensíveis são redigidos antes da persistência.

O Control Plane **não deve receber o Docker socket bruto** por padrão. Acesso ao
socket tornaria a aplicação equivalente a root no host. Caso seja necessário um
agente operacional, ele deve expor uma API mínima, autenticada e allow-listed,
sem porta pública.

## Acesso administrativo excepcional

Interfaces administrativas de RabbitMQ, MinIO, PostgreSQL ou Redis não ficam
permanentemente publicadas. Quando houver necessidade real de troubleshooting,
o acesso deve ser temporário e explícito, por uma das opções:

- `docker exec`/CLI no servidor;
- SSH tunnel com bind local;
- VPN privada (ex.: WireGuard/Tailscale) com regras específicas;
- proxy temporário/autenticado criado pelo módulo operacional do Control Plane;
- agente interno com autorização por tempo limitado e auditoria.

Ao encerrar a sessão, o acesso temporário deve desaparecer sem alteração do
contrato single-port da stack.

## Garantia contra regressão

A CI executa `scripts/validate_runtime_contract.py` e falha se:

- qualquer deployment voltar a conter `build:`;
- qualquer serviço que não seja `connect-gateway` publicar uma porta;
- API/Web/Gateway deixarem de usar GHCR `:latest` no runtime;
- os arquivos de runtime divergirem do Compose canônico;
- o modelo local deixar de ficar isolado em `compose.local-build.yaml`.
