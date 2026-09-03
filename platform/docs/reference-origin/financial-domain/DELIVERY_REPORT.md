# Relatório de Entrega — Connect|API Platform v1.0.0-rc.2

**Data de referência:** 20 de agosto de 2026 — America/Bahia.

## Situação da entrega

A distribuição contém a aplicação SaaS financeira multitenant em código-fonte, com Control Plane, Tenant Plane, portal público, workers assíncronos, migrations, infraestrutura Docker e documentação operacional.

A classificação correta é **release candidate completa no nível de código-fonte e distribuição operacional**. O pacote não declara como concluídas homologações bancárias, fiscais ou de provedores que exigem contratos e credenciais reais.

## Evidências executadas no ambiente de empacotamento

```text
Backend pytest:                     41 aprovados
Validação estrutural:               PASS
Rotas FastAPI:                      161
Chamadas HTTP do frontend:          171 (123 contratos únicos)
Divergências frontend/backend:      0
Telas/componentes Vue:              57 páginas Vue validadas
Migrations Control Plane:           2 — head 0002_control_complete
Migrations Tenant Plane:            3 — head 0003_pix_automatic
Scripts shell:                      23
Arquivos YAML/Compose/workflows:    16
Alembic executável fora de backend: PASS
Manifest/checksum do pacote:        gerado e verificado
```

## Módulos entregues

### Control Plane

- autenticação e autorização próprias;
- dashboard global;
- tenants, planos, capacidades, limites e consumo;
- provisionamento de banco, usuário, storage e domínio;
- domínios provisórios e personalizados;
- integração Cloudflare e reconciliação DNS/SSL;
- usuários e papéis da plataforma;
- configurações e integrações globais;
- API keys e suporte temporário auditado;
- auditoria global, backups, restore, exportação e saúde operacional.

### Tenant Plane

- múltiplas empresas/CNPJs por tenant;
- usuários, papéis, permissões e restrições por empresa;
- clientes, contatos, serviços e contratos;
- recorrência, contas a receber, cobranças e pagamentos;
- pagamento parcial, baixa, estorno e conciliação;
- boleto, Pix e boleto híbrido em provider Sandbox;
- adapter Asaas configurável;
- Pix Automático com mandatos e instruções;
- CNAB 240 e 400 extensíveis, remessa, retorno e eventos;
- importação OFX/CSV e financeiro legado;
- negociações, links públicos, recibos, documentos e NFS-e Sandbox;
- SMTP, Evolution API, templates, régua de cobrança e Outbox;
- API keys, webhooks assinados, exportações, relatórios e auditoria.

## Distribuições operacionais

- `compose.yaml`: stack canônica com build pelo fonte;
- `deployments/docker/`: Docker genérico por fonte ou imagens;
- `deployments/dockge/`: compose, ambiente, instalação, atualização, rollback e healthcheck;
- `deployments/cloudpanel/`: compose, automação `clpctl`, vhosts, SSL/ACME, atualização e rollback;
- `deployments/portainer/`: stack por imagens, stack com build e automação por API;
- `deployments/development`, `staging` e `production`;
- GitHub Actions para testes, build, smoke test, imagens GHCR e release.

## Instalação inicial

```bash
cp .env.example .env
python3 scripts/generate_secrets.py --env .env
./scripts/install_local.sh
```

Deploy Docker genérico:

```bash
./deployments/docker/install.sh \
  --domain connect.exemplo.com.br \
  --admin-email admin@exemplo.com.br \
  --mode source
```

O arquivo `.bootstrap-credentials.txt` é criado localmente com permissão `0600` e não faz parte do pacote.

## Empacotamento reproduzível

```bash
make package
```

ou:

```bash
python3 scripts/package_release.py --output-dir release-artifacts
```

O empacotador:

- exclui `.git`, caches, bytecode, `.env`, credenciais e dados de runtime;
- cria ZIP e TAR.ZST;
- gera `PACKAGE_CONTENTS.txt` e `MANIFEST.sha256` dentro da distribuição;
- testa a integridade do ZIP e do TAR;
- gera checksums SHA-256 externos e relatório JSON do pacote.

## Pendências externas para produção real

- credenciais e homologação do banco/PSP, convênio e carteira;
- layout CNAB específico da instituição escolhida;
- Pix Automático real;
- NFS-e municipal/nacional e certificado correspondente;
- credenciais SMTP, Evolution API, Cloudflare, Google Drive e Dropbox;
- smoke test Docker no servidor de destino;
- ensaio real de backup e restore;
- revisão de segurança, observabilidade e capacidade de acordo com a carga real.
