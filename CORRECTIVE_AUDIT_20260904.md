# Connect|API Platform — Auditoria Corretiva 2026-09-04

Esta correção foi aplicada sobre a portabilidade atual, preservando o desenho existente do projeto, os nomes de deploy e a divisão Engine/Platform. Não houve refatoração arquitetural abrupta.

## Correções operacionais aplicadas

- Celery Beat: schedule e pid movidos para `/tmp`, removendo o `PermissionError` observado em `/var/lib/celery/celerybeat-schedule` sem executar o container como root.
- Provisionamento: validação final real de PostgreSQL (`SELECT 1`), bucket S3 (`HEAD bucket`) e domínio/SSL antes de marcar o tenant como `ACTIVE`.
- Storage: MinIO embarcado continua padrão; `PLATFORM_S3_*` permite endpoint S3/S3-compatible externo sem alterar o contrato do deploy.
- Readiness: S3 validado via protocolo S3, sem acoplamento ao endpoint `/minio/health/live`.
- Operações corretivas de tenant: `VALIDATE`, `MIGRATE_DATABASE`, `ENSURE_STORAGE`, `RECONCILE_DOMAIN` e `ACTIVATE_IF_READY`.
- Backups: worker dedicado, persistência `/data/backups`, política `BACKUP_ENABLED` respeitada pelo scheduler e por disparos manuais.
- Logs: Docker Socket Proxy somente leitura (`POST=0`) + Log Agent sem acesso direto ao socket.
- Observabilidade: Prometheus e Grafana integrados aos três deployments da família Platform.
- ACME/CloudPanel: mantidos opcionais pelo profile `cloudpanel`, sem alterar o caminho padrão de deploy.
- Domain Agent: artefatos systemd entregues em `deploy/platform/domain-agent` para hosts Nginx/Certbot sem CloudPanel.
- Frontend: mapeamento da página de Observabilidade corrigido para os nomes reais dos containers da portabilidade atual; navegação de Tenant restaurada para Events/PBX/VOIP e Studios existentes; 2FA e destaques reaproximados do tema claro Connect|API.
- Public site: `/v1/public/site` só é consultado quando há Tenant Context válido, evitando 404 espúrio em Control/Partner/hosts sem tenant.
- Prepare-env: merge conservador de chaves novas em `.env` existente, sem sobrescrever valores implantados.
- Dependências Python: `pyproject.toml` agora declara as dependências de runtime e o extra `test`, mantendo `requirements.txt` como contrato da imagem Docker.

## Padrões preservados

- `deploy/platform` → `argws-connect-platform`
- `deploy/platform-develop` → `argws-connect-platform-develop`
- `deploy/platform-production` → `argws-connect-platform-production`
- nomes atuais de containers e aliases internos estáveis;
- Engine e Platform continuam separados;
- MinIO, PostgreSQL, Redis e RabbitMQ existentes não foram substituídos;
- frontend atual foi corrigido incrementalmente, sem troca integral de stack ou framework.

## Serviços operacionais adicionados à família Platform

- `platform-worker-backups-*`
- `platform-docker-proxy-*`
- `platform-log-agent-*`
- `platform-prometheus-*`
- `platform-grafana-*`
- `platform-acme-*` (profile `cloudpanel`)
- `platform-cloudpanel-agent-*` (profile `cloudpanel`)

## Validação

O pacote final deve passar:

- `python platform/scripts/validate_platform_integration.py`
- `python platform/scripts/validate_project.py`
- testes corretivos em `platform/control-api/tests/connect_platform/test_operational_foundation_corrective.py`
- contrato do scheduler em `test_celery_beat_compose_contract.py`
- parse YAML dos três `deploy/platform*/compose.yaml`
- `bash -n` dos scripts shell alterados

## Pendências não bloqueantes deliberadamente não refatoradas

- O Engine ainda registra aviso do RabbitMQ sobre `global_qos` depreciado; deve ser corrigido no cliente AMQP/origem que solicita QoS global, e não mascarado habilitando permanentemente a feature depreciada no broker.
- O backend ainda possui usos explícitos de `ORJSONResponse` que geram warnings em FastAPI recente. Não foram trocados em massa nesta correção para evitar alteração transversal de serialização.
- Não foi adicionado Loki/Alloy nesta correção; o contrato atual permanece Log Agent + Prometheus/Grafana, conforme o desenho da portabilidade.
