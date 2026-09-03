# Matriz de Conclusão do Produto — v1.0.0-rc.2

## Legenda

- **Completo:** código, API, interface e distribuição presentes no pacote.
- **Sandbox:** fluxo executável sem validade externa; provider real depende de credencial/homologação.
- **Extensível:** motor e contrato implementados; layouts/adapters específicos são adicionados por instituição.
- **Externo:** depende de infraestrutura, contrato ou credencial que não pode ser fabricada no código-fonte.

## Plataforma e multitenancy

| Recurso | Situação | Evidência principal |
|---|---|---|
| Control Plane separado | Completo | rotas, autenticação e frontend próprios |
| Tenant Plane por hostname | Completo | TenantResolver e middleware sem fallback |
| Banco PostgreSQL por tenant | Completo | provisionamento e migrations de tenants |
| Usuário PostgreSQL por tenant | Completo | provisionamento e SecretResolver |
| Bucket/prefixo de storage por tenant | Completo | serviço de provisionamento/MinIO |
| Múltiplas empresas por tenant | Completo | modelos, API, tela e vínculo financeiro |
| Restrição de usuário por empresa | Completo | RBAC e associações usuário/empresa |
| Domínio provisório | Completo | registro automático e resolução |
| Domínios personalizados | Completo | API, tela, verificação e agente |
| Cloudflare DNS | Completo/Externo | provider pronto; exige token/zone id |
| SSL wildcard/customizado | Completo/Externo | ACME/CloudPanel agent; exige DNS válido |
| Planos, limites e feature flags | Completo | Control Plane e enforcement backend |
| Métricas de consumo | Completo | snapshots e interface do Control Plane |
| Suporte temporário auditado | Completo | sessão com motivo, expiração e auditoria |

## Domínio financeiro

| Recurso | Situação |
|---|---|
| Clientes e contatos financeiros | Completo |
| Serviços | Completo |
| Contratos | Completo |
| Recorrência e geração idempotente | Completo |
| Contas a receber | Completo |
| Cobranças | Completo |
| Pagamentos total/parcial | Completo |
| Estorno | Completo |
| Conciliação | Completo |
| Importação OFX/CSV | Completo |
| Negociações/acordos | Completo |
| Links públicos de pagamento | Completo |
| Recibos PDF | Completo |
| NFS-e Sandbox XML/PDF | Sandbox |
| NFS-e municipal/nacional real | Externo por provider e credenciais |
| Documentos imutáveis e SHA-256 | Completo |
| Importação legado XLSX/CSV/TXT | Completo |
| Exportações | Completo |
| Relatórios e dashboard | Completo |

## Bancos, boleto, Pix e CNAB

| Recurso | Situação |
|---|---|
| Provider bancário Sandbox | Completo |
| Adapter Asaas | Completo/Externo, requer credenciais |
| Boleto/linha digitável/PDF Sandbox | Sandbox |
| Pix cobrança/QR/copia e cola Sandbox | Sandbox |
| Boleto híbrido Sandbox | Sandbox |
| Pix Automático Sandbox | Completo no ciclo de mandato/instrução |
| Pix Automático real | Externo, depende do PSP e contrato |
| CNAB 240 core | Extensível |
| CNAB 400 core | Extensível |
| Remessas e retornos | Completo |
| Eventos e idempotência CNAB | Completo |
| Homologação por banco/carteira | Externo |

## Comunicações e integrações

| Recurso | Situação |
|---|---|
| SMTP por plataforma/tenant/empresa | Completo/Externo |
| Evolution API | Completo/Externo |
| Textos e documentos WhatsApp | Completo |
| Webhook Evolution idempotente | Completo |
| Régua de cobrança | Completo |
| Templates | Completo |
| Outbox/RabbitMQ/Celery | Completo |
| API keys do tenant | Completo |
| API keys da plataforma | Completo |
| Webhooks de saída assinados | Completo |
| Retry e histórico de entregas | Completo |

## Operação, segurança e backup

| Recurso | Situação |
|---|---|
| Docker Compose fonte | Completo |
| Docker Compose por imagens | Completo |
| Dockge | Completo |
| CloudPanel | Completo |
| Portainer | Completo |
| Prometheus/Grafana opcionais | Completo |
| Health/live/ready/metrics | Completo |
| Backup PostgreSQL Control Plane | Completo |
| Backup de todos os bancos de tenants | Completo |
| Backup MinIO/S3 | Completo |
| Google Drive via rclone | Completo/Externo |
| Dropbox via rclone | Completo/Externo |
| Manifest/checksum/criptografia age | Completo |
| Restore completo | Completo |
| Restore/exportação de tenant | Completo |
| Auditoria append-only | Completo |
| Segredos fora do código | Completo |
| CI, build e release | Completo no repositório |

## Critério da release candidate

O pacote é considerado completo como código-fonte e distribuição operacional porque todos os módulos estruturais, APIs, interfaces, workers, migrations, stacks e scripts previstos estão presentes. A promoção para produção requer executar o CI/build no ambiente conectado, configurar credenciais reais, homologar os layouts bancários/fiscais selecionados e comprovar backup/restore na infraestrutura de destino.
