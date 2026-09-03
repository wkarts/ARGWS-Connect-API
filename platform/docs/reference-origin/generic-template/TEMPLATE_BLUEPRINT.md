# Multitenant Control Plane Template — Blueprint

Este repositório foi preparado a partir de uma plataforma SaaS real e contém um **núcleo reutilizável de multitenancy + Control Plane** e um **domínio financeiro de referência**.

## O que é núcleo e deve ser preservado
- Control Plane separado do Tenant Plane.
- Autenticação e segurança por plano.
- `tenant_context` e resolução por hostname.
- PostgreSQL: banco da plataforma + database-per-tenant.
- Alembic separado para plataforma e tenant.
- Provisionamento, suspensão, reativação e ciclo de vida.
- Domínios padrão/customizados, Cloudflare/ACME.
- Redis, RabbitMQ, Celery.
- S3/MinIO.
- Auditoria, observabilidade, runtime logs e rate limit.
- Backups/restore.
- Frontend Vue com guards `control`/`tenant`.
- Infraestrutura Docker, Dockge, Portainer e CloudPanel.

## O que NÃO é núcleo
A implementação financeira existente (banking, CNAB, Pix, cobrança, recebíveis, pagamentos, reconciliação, providers bancários etc.) é material de referência e deve ser substituída pelo domínio da nova aplicação.

## Fluxo recomendado para criar um novo produto
1. Copie `template.config.example.yaml` para `template.config.yaml`.
2. Preencha identidade, domínios, registry, banco, storage e features.
3. Coloque assets reais em `branding/`.
4. Execute `python scripts/specialize_template.py --config template.config.yaml --dry-run`.
5. Revise o plano.
6. Execute novamente sem `--dry-run`.
7. Entregue `AI_MASTER_PROMPT.md` à IA responsável pela adaptação semântica do domínio.
8. A IA remove o domínio financeiro de referência e constrói os módulos solicitados.
9. Execute `python scripts/audit_legacy_identity.py`.
10. Rode a suíte de validação/build/deploy.

## Estratégia de configuração
Toda identidade variável deve convergir para configuração. Literais de branding ou domínio em componentes são considerados débito técnico.

## Modelo de domínio
- **Platform DB**: tenants, planos, usuários/control admins, domínios, provisioning, credenciais globais, auditoria global, configurações de plataforma.
- **Tenant DB**: dados de negócio exclusivos de cada cliente, usuários/roles locais quando aplicável, configurações e auditoria do tenant.
- **Storage**: namespace por tenant.
- **Queue**: toda mensagem de negócio leva `tenant_id` e o worker restaura o contexto explicitamente.

## Critério de isolamento
O teste mínimo de segurança deve criar Tenant A e Tenant B, inserir dados equivalentes nos dois bancos e provar que nenhuma API, job, busca, exportação ou webhook consegue cruzar os dados.
