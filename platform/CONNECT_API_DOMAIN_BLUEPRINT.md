# Connect|API Platform — Domain Blueprint

## Objetivo
Plataforma multitenant de comunicação e integração, orientada a canais, eventos e APIs, com extensões de telefonia PBX/VOIP.

## Módulos

### 1. Channels
Catálogo de canais e capacidades. Um canal define tipo, provider, recursos suportados, limites e política de credenciais.

### 2. Instances
Instâncias isoladas por tenant. Lifecycle mínimo: `CREATING`, `CONNECTING`, `ONLINE`, `DEGRADED`, `OFFLINE`, `SUSPENDED`, `ERROR`, `DELETED`. Credenciais sempre criptografadas.

### 3. Messages
Envelope canônico independente do provider. Deve suportar idempotency key, correlation id, direção, sender/recipient, content metadata, delivery status e provider reference.

### 4. Events
Todo evento recebido deve ser normalizado, persistido com hash/idempotência e publicado via Outbox. Nunca processar webhook externo diretamente como efeito irreversível sem idempotência.

### 5. Webhooks
Endpoints inbound assinados/verificados e subscriptions outbound por tenant. Retry exponencial, DLQ, assinatura HMAC, replay auditável e proteção contra SSRF.

### 6. Automations
Regras `trigger -> conditions -> actions`. Execução assíncrona, tenant context obrigatório, retries e histórico de execução.

### 7. Integrations
Adapters desacoplados por provider. Nenhuma regra de negócio deve depender diretamente de SDK/protocolo específico.

### 8. PBX
Ramais, filas, URA, trunks, dialplan, gravações/metadados, presença e eventos de chamada. Áudio/segredos devem seguir política própria de retenção e acesso.

### 9. VOIP
Contas SIP, registro, dispositivos, chamadas, codecs, CDR, health e observabilidade. Não expor credenciais SIP em logs.

## Contratos obrigatórios
- database-per-tenant;
- tenant context em request, worker, webhook, exportação e schedule;
- RBAC por capability;
- auditoria para alterações administrativas;
- Outbox para eventos assíncronos;
- idempotência para ingestão;
- observabilidade com `request_id`, `correlation_id`, `tenant_id`, `instance_id` quando aplicável;
- secrets criptografados e nunca retornados integralmente após cadastro.

## Permissões sugeridas
`channels.read/manage`, `instances.read/manage`, `messages.read/send`, `events.read/replay`, `webhooks.read/manage`, `automations.read/manage/execute`, `integrations.read/manage`, `pbx.read/manage`, `voip.read/manage`.
