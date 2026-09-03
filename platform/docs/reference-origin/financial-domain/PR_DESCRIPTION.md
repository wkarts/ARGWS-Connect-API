# Descrição da Pull Request

## Objetivo

Entregar a Connect|API Platform como uma plataforma SaaS financeira multitenant, web/PWA e totalmente conteinerizada, com Control Plane independente, isolamento forte por tenant, múltiplas empresas por tenant, cobrança recorrente, integrações de comunicação e pacotes operacionais para Docker, Dockge, CloudPanel e Portainer.

## Arquitetura

- Python 3.13, FastAPI, SQLAlchemy 2 assíncrono, Alembic e Pydantic 2;
- Vue 3, TypeScript, Vite, Pinia, Vue Router e Tailwind CSS;
- PostgreSQL com banco e usuário exclusivos por tenant;
- Redis para cache, locks, rate limit e resolução de domínios;
- RabbitMQ e Celery com filas especializadas;
- MinIO/S3 para documentos financeiros imutáveis;
- Control Plane e Tenant Plane com autenticação, rotas e contextos separados;
- domínio provisionado e domínios personalizados por tenant;
- resolução de tenant por hostname sem fallback entre tenants;
- Outbox transacional, idempotência e auditoria append-only.

## Control Plane

- dashboard global;
- gestão completa do ciclo de vida dos tenants;
- provisionamento de banco, usuário, storage, domínio e administrador;
- domínios provisionados e personalizados;
- reconciliação DNS/SSL e integração Cloudflare;
- planos, capacidades, limites e métricas de consumo;
- usuários e papéis da plataforma;
- configurações e integrações globais;
- API keys da plataforma;
- sessões temporárias de suporte auditadas;
- auditoria global;
- jobs de provisionamento;
- backup, restore e exportação de tenant;
- saúde operacional da plataforma.

## Tenant Plane

- múltiplas empresas/CNPJs por tenant;
- usuários, papéis, permissões e restrições por empresa;
- clientes e múltiplos contatos financeiros;
- serviços e contratos;
- recorrência, competência, pró-rata e reajustes;
- contas a receber, cobranças e pagamentos;
- pagamento parcial, estorno e conciliação;
- boleto, Pix, boleto híbrido e provider Sandbox;
- provider Asaas preparado para credenciais reais;
- Pix Automático com mandato, instruções, sincronização e cancelamento;
- CNAB 240 e CNAB 400 extensíveis;
- remessas, retornos, eventos e idempotência;
- importação OFX/CSV e transações bancárias;
- negociações e acordos;
- links públicos de pagamento;
- recibos e documentos fiscais em modo Sandbox;
- documentos imutáveis com SHA-256;
- SMTP e Evolution API;
- régua de cobrança e templates;
- API keys do tenant;
- webhooks de saída assinados, com retry e histórico;
- importações, exportações, relatórios e auditoria.

## Deploy e operação

- Compose de desenvolvimento/build a partir do fonte;
- Compose de produção baseado em imagens versionadas;
- pacote Dockge com compose, ambiente, instalação, atualização, rollback e health check;
- pacote CloudPanel com automação `clpctl`, vhosts, wildcard, ACME DNS-01 opcional, atualização e rollback;
- pacote Portainer com stack por imagens, stack Git/source, automação pela API e webhook de atualização;
- scripts genéricos Docker;
- migrations do Control Plane e de todos os tenants existentes;
- bootstrap idempotente;
- health/readiness/liveness;
- Prometheus e Grafana opcionais;
- backup local, MinIO/S3, Google Drive e Dropbox;
- restore com manifest, checksum e modo de manutenção.

## Validação

- testes automatizados backend;
- configuração dos mapeamentos SQLAlchemy;
- compilação sintática Python;
- validação TypeScript/Vue;
- validação de rotas FastAPI;
- validação de scripts Shell;
- validação de YAML e contratos Compose;
- validação dos pacotes Dockge, CloudPanel e Portainer;
- verificação de arquivos sensíveis e manifest SHA-256.
- contrato de 171 chamadas frontend (123 contratos únicos) contra 161 rotas FastAPI;
- heads Alembic e caminhos portáveis;
- empacotamento canônico com ZIP/TAR, manifest e checksums.

## Limites externos declarados

A plataforma inclui providers Sandbox para validar o fluxo ponta a ponta e um adapter Asaas preparado para integração real. Emissão bancária, Pix, CNAB e NFS-e com validade jurídica dependem de credenciais, contratos, certificados, layouts e homologação da instituição escolhida. Esta PR não inventa credenciais nem declara homologação externa não executada.

## Classificação

`v1.0.0-rc.2` — release candidate completa no nível de código-fonte e distribuição operacional, pendente apenas das homologações e credenciais externas específicas do ambiente de produção.
