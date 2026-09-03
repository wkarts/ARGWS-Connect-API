# Índice da Entrega — Connect|API Platform v1.0.0-rc.2

Este arquivo é o ponto de entrada operacional da entrega completa.

## Pacotes e código

- `backend/`: API FastAPI, workers Celery, migrations, providers, serviços, modelos e testes.
- `frontend/`: aplicação Vue 3/TypeScript/Tailwind PWA para Control Plane, Tenant Plane e portal público.
- `compose.yaml`: stack canônica com build pelo código-fonte.
- `deployments/docker/`: Docker genérico por fonte ou imagens.
- `deployments/dockge/`: stack e automações para Dockge.
- `deployments/cloudpanel/`: stack, vhosts e automações CloudPanel.
- `deployments/portainer/`: stack por imagens, stack com build, API deploy e webhook.
- `infrastructure/`: gateway, ACME, CloudPanel Agent, RabbitMQ, Prometheus, Grafana e backup.
- `.github/workflows/`: CI, build de imagens e release.

## Entrada rápida

### Desenvolvimento/local

```bash
cp .env.example .env
python3 scripts/generate_secrets.py --env .env
./scripts/install_local.sh
```

### Docker em servidor

```bash
./deployments/docker/install.sh \
  --domain connect.exemplo.com.br \
  --admin-email admin@exemplo.com.br \
  --mode source
```

### Dockge

```bash
sudo ./deployments/dockge/install.sh \
  --domain connect.exemplo.com.br \
  --admin-email admin@exemplo.com.br \
  --stacks-dir /opt/stacks
```

### CloudPanel

```bash
sudo ./deployments/cloudpanel/install.sh \
  --domain connect.exemplo.com.br \
  --admin-email admin@exemplo.com.br \
  --stack-dir /home/connectapi/htdocs/connect.exemplo.com.br/connect-api-platform
```

### Portainer

```bash
./deployments/portainer/deploy.sh \
  --domain connect.exemplo.com.br \
  --admin-email admin@exemplo.com.br \
  --url https://portainer.exemplo.com.br \
  --api-key ptr_xxxxxxxxx \
  --endpoint-id 1
```

## Control Plane

O Control Plane administra tenants, planos, limites, usuários da plataforma, domínios, DNS/SSL, provisionamento, integrações globais, API keys, suporte auditado, consumo, saúde, backup e restore. O host padrão é `control.<PLATFORM_DOMAIN>`.

## Tenant Plane

Cada tenant possui banco PostgreSQL, usuário PostgreSQL, storage e domínio segregados. Um tenant pode cadastrar múltiplas empresas/CNPJs e emitir cobranças por qualquer empresa autorizada ao usuário.

O Tenant Plane cobre clientes, serviços, contratos, recorrência, recebíveis, cobrança, boleto/Pix Sandbox, adapter Asaas, Pix Automático, CNAB 240/400 extensível, pagamentos, estornos, conciliação, OFX/CSV, negociações, links públicos, documentos, SMTP, Evolution API, API keys, webhooks e relatórios.

## Documentação obrigatória

- `README.md`: visão geral e instalação.
- `docs/architecture/ARCHITECTURE.md`: arquitetura técnica.
- `docs/architecture/FLOWS.md`: fluxos de ponta a ponta.
- `docs/security/TENANT_ISOLATION.md`: isolamento e segurança.
- `docs/operations/DEPLOY_DOCKGE.md`: operação no Dockge.
- `docs/operations/DEPLOY_CLOUDPANEL.md`: operação no CloudPanel.
- `docs/operations/DEPLOY_PORTAINER.md`: operação no Portainer.
- `docs/operations/BACKUP_RESTORE.md`: backup, Google Drive, Dropbox e restore.
- `docs/integrations/SMTP_EVOLUTION.md`: SMTP e Evolution API.
- `docs/integrations/BANKING_CNAB.md`: bancos, boleto, Pix e CNAB.
- `docs/product/COMPLETION_MATRIX.md`: classificação de cada recurso.
- `docs/ACCEPTANCE_CHECKLIST.md`: aceite técnico.
- `VALIDATION_REPORT.md`: resultado da validação local.
- `docs/release/DELIVERY_REPORT.md`: inventário, evidências e limites da entrega.

## Pull request e release

- `PR_TITLE.md`: título pronto da pull request.
- `PR_DESCRIPTION.md`: descrição completa da pull request.
- `RELEASE_NOTES.md`: notas da release candidate.
- `CHANGELOG.md`: histórico da versão.
- `VERSION`: versão canônica.
- `MANIFEST.sha256`: checksums dos arquivos do pacote.

## Condições externas

A aplicação é entregue completa no nível de código-fonte e distribuição. Emissão bancária, Pix Automático real, CNAB específico e NFS-e com validade jurídica exigem credenciais, contratos e homologações da instituição escolhida. O pacote não simula aprovação externa inexistente.

## Empacotamento local

```bash
make package
```

Os artefatos são gravados em `release-artifacts/` com ZIP, TAR.ZST, checksums e relatório JSON.
