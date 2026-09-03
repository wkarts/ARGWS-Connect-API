# Arquitetura — Connect|API Platform

## Visão geral

```text
Cloudflare / DNS / SSL
        |
        v
connect-gateway
   |          |
   v          v
connect-web  connect-api
                |
      +---------+---------+
      |         |         |
 PostgreSQL   Redis    RabbitMQ
      |                   |
 Platform DB        connect-worker-*
      |                   |
      +--> Tenant DBs <---+
      |
    MinIO/S3
```

## Planos

### Control Plane
Responsável por tenants, planos, domínios, provisioning, recursos, usuários da plataforma, whitelabel, auditoria global, backups, observabilidade e segurança.

### Tenant Plane
Executa o domínio Connect|API: canais, instâncias, mensagens, eventos, webhooks, automações, integrações, PBX e VOIP.

## Isolamento
Cada tenant possui PostgreSQL próprio, usuário PostgreSQL próprio e storage segregado. O hostname é a autoridade de resolução. Jobs, webhooks e schedules carregam `tenant_id`/tenant context explicitamente.

## Assíncrono
RabbitMQ/Celery executam processamento assíncrono. Eventos de negócio devem preferir Transactional Outbox, idempotência e correlation IDs.

## Serviços canônicos
- `connect-api`; `connect-web`; `connect-gateway`;
- `connect-postgres`; `connect-redis`; `connect-rabbitmq`; `connect-minio`;
- `connect-worker-default`; `connect-worker-events`; `connect-worker-notifications`; `connect-worker-backups`;
- `connect-beat`; `connect-log-agent`; `connect-prometheus`; `connect-grafana`.

## Escala
A API e os workers são stateless em relação à sessão de usuário e podem ser escalados horizontalmente. Exemplo:

```bash
docker compose up -d --scale connect-api=3 --scale connect-worker-default=4
```

## Domínio financeiro herdado
Permanece apenas como referência técnica e está desativado por padrão. Não faz parte do runtime canônico Connect|API.
