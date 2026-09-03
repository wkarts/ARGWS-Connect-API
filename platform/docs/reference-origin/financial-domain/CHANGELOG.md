# Changelog

## 1.0.0-rc.7 — 2026-08-21

### Segurança e runtime

- todos os deployments passam a ser exclusivamente **image-only**, consumindo GHCR `:latest`;
- `compose.yaml` da raiz deixa de ser modelo de build e passa a ser o runtime canônico de deploy;
- build local fica isolado exclusivamente em `compose.local-build.yaml`, para desenvolvimento e CI;
- Dockge, Docker, CloudPanel, Production e Portainer usam o mesmo Compose canônico;
- staging e development deixam de declarar `build:` e passam a consumir GHCR;
- somente `connect-gateway` publica uma porta no host;
- PostgreSQL, Redis, RabbitMQ e MinIO deixam de publicar portas de administração/console;
- a porta do gateway permanece ligada a `127.0.0.1` por padrão;
- dados persistentes continuam em `./data-*` e arquivos auxiliares em `./secrets`.

### Preflight e diagnóstico

- adicionado `connect-preflight`, executado sem rede antes de storage/migrations;
- adicionado `backend/app/preflight.py` para detectar configuração inconsistente sem vazar segredos;
- validação cobre placeholders de produção, PostgreSQL admin, RabbitMQ, MinIO/S3, SMTP e integrações habilitadas;
- `scripts/generate_secrets.py` passa a reparar relações derivadas, sincronizar credenciais e normalizar `SMTP_SECURITY`;
- falhas de configuração passam a ocorrer antes de `connect-migrate`, com mensagem explícita;
- instalador Dockge passa a exibir logs de preflight/migration quando a subida falha.

### Operação e auditoria

- logging Docker do runtime passa a usar driver `local` com rotação;
- documentado o modelo de auditoria futura via Control Plane sem Docker socket público e sem portas administrativas permanentes;
- acesso excepcional a serviços internos deve ser temporário por `docker exec`, SSH tunnel, VPN ou agente interno autenticado;
- adicionado `scripts/validate_runtime_contract.py` para bloquear regressão de portas/builds;
- CI passa a validar que somente o gateway possui host port e usa build apenas no override local;
- `stack-build.yaml` do Portainer fica deliberadamente desabilitado;
- rollback Dockge passa a usar override temporário de imagens versionadas e `update.sh` retorna ao canal `latest`.

## 1.0.0-rc.6 — 2026-08-21

### Corrigido

- adicionado asset dedicado `ARGWS-Financial-Platform-v<VERSAO>-Dockge.zip` para instalação direta no Dockge;
- o bundle Dockge coloca o `compose.yaml` **image-only** na raiz da stack, evitando que o Dockge selecione por engano o Compose de desenvolvimento/build do pacote completo;
- o pacote dedicado inclui `.env.example`, README, manifesto e os diretórios persistentes `data-*`;
- imagens `api`, `web` e `gateway` passam a ficar fixas no Compose Dockge como `ghcr.io/wkarts/...:latest`;
- `pull_policy: always` passa a ficar fixo no Compose Dockge, impedindo que `.env` legado com `APP_PULL_POLICY=build` reative build local;
- CI passa a gerar e validar o bundle Dockge em toda Pull Request;
- workflow de Release passa a publicar e verificar o bundle Dockge como asset obrigatório;
- workflow de verificação de Release deixa de gravar diretamente na `main` e passa a publicar apenas um artefato de prova, respeitando o fluxo branch → PR → merge;
- documentação passa a tratar a presença de `[+] Building` em um deploy Dockge como indicação de Compose incorreto.

### Operação

Para Dockge, o asset recomendado da Release passa a ser:

```text
ARGWS-Financial-Platform-v<VERSAO>-Dockge.zip
```

O pacote completo de código-fonte continua disponível para desenvolvimento e auditoria, mas não deve ser extraído diretamente como stack Dockge sem substituir o `compose.yaml` da raiz pelo arquivo `deployments/dockge/compose.yaml`.

## 1.0.0-rc.5 — 2026-08-21

### Corrigido

- formalizado o fluxo de correção via branch + Pull Request antes do merge em `main`;
- stack Dockge consolidada como **image-only**, sem dependência de `backend/`, `frontend/`, Dockerfiles ou build local;
- persistência principal do Dockge padronizada em bind mounts visíveis `./data-*`;
- `FINANCIAL_DATA_ROOT=.` definido como padrão do ambiente Dockge;
- PostgreSQL, Redis, RabbitMQ, MinIO, backups, runtime e Celery passam a permanecer diretamente na pasta da stack;
- removidos volumes Docker nomeados da stack Dockge para esses dados;
- adicionado `scripts/validate_dockge_runtime.py` para impedir regressão para build local, named volumes ou caminhos fora de `data-*`;
- CI passa a executar a validação específica do runtime Dockge antes do deploy/release;
- documentação operacional corrigida para refletir o layout real da persistência.

### Estrutura operacional

```text
connect-api-platform/
├── compose.yaml
├── .env
├── data-postgres/
├── data-redis/
├── data-rabbitmq/
├── data-minio/
├── data-backups/
├── data-runtime/
└── data-celery/
```

## 1.0.0-rc.4 — 2026-08-21

### Corrigido

- `deployments/dockge/compose.yaml` convertido para stack **image-only**;
- removidas dependências de `backend/`, `frontend/`, Dockerfiles e arquivos locais da infraestrutura no deploy Dockge;
- Dockge passa a usar `ghcr.io/YOUR_ORG/YOUR_APP-{api,web,gateway}:latest` com `APP_PULL_POLICY=always`;
- removido `APP_VERSION` do ambiente do Compose Dockge para preservar a versão canônica embutida nas imagens;
- `install.sh` e `update.sh` do Dockge deixam de executar build local e passam a usar `docker compose pull`;
- `rollback.sh` passa a usar aliases imutáveis das imagens da release informada;
- `healthcheck.sh` passa a usar explicitamente o Compose image-only;
- documentação Dockge corrigida para refletir o fluxo real de produção;
- validador estrutural passa a impedir regressão para `build:` local no Dockge.

### Operação

- pasta da stack pode conter apenas `compose.yaml` e `.env`;
- CloudPanel continua externo à stack e aponta para `127.0.0.1:GATEWAY_PORT`;
- runtime normal permanece em `:latest`; tags versionadas ficam reservadas para rollback/auditoria.

## 1.0.0-rc.3 — 2026-08-21

### Corrigido

- `VERSION` definido como única fonte canônica da versão da aplicação;
- `APP_VERSION` e `VITE_APP_VERSION` sincronizadas automaticamente;
- remoção da versão fixa de backend, frontend, Dockerfiles, Compose e exemplos de ambiente;
- imagens operacionais do produto padronizadas em `:latest`;
- publicação GHCR corrigida para atualizar `:latest` em toda release, inclusive prerelease;
- workflow único de publicação com CI, imagens, artefatos, tag e GitHub Release;
- deploys Docker, Dockge, CloudPanel e Portainer alinhados ao mesmo contrato de versão/imagens;
- Dependabot agrupado e sem atualizações major automáticas;
- Tailwind 4 bloqueado até migração explícita.

### Distribuição

- imagens GHCR `api`, `web`, `gateway`, `acme` e `cloudpanel-agent`;
- ZIP, TAR.ZST e TAR.GZ;
- checksums SHA-256;
- inventário/relatório da distribuição;
- artefatos do GitHub Actions;
- GitHub Release versionada.

## 1.0.0-rc.2 — 2026-08-20

### Validado e corrigido

- suíte backend executada com 41 testes aprovados;
- contrato estático entre 171 chamadas HTTP do frontend e 161 rotas FastAPI validado sem divergências;
- caminhos Alembic tornados independentes do diretório atual por meio de `%(here)s`;
- empacotamento de release refeito para excluir `.git`, caches, bytecode, credenciais e dados de runtime;
- geração de `MANIFEST.sha256`, inventário do pacote e verificação automática da integridade dos arquivos;
- workflow de release preparado para usar o empacotador canônico;
- relatório de validação atualizado para a versão efetivamente entregue.

### Condição

- código-fonte e distribuição operacional completos em release candidate;
- build Docker integral e homologações bancárias/fiscais continuam dependentes do ambiente conectado e das credenciais reais.

## 1.0.0-rc.1 — 2026-08-20

### Adicionado

- Control Plane completo para tenants, planos, limites, domínios, configurações, usuários, integrações, API keys, suporte auditado, consumo, provisionamento, backup e restore;
- Tenant Plane ampliado com contatos, serviços, contratos, recebíveis, pagamentos, estornos, negociações, links públicos, importações, exportações, API keys e webhooks;
- Pix Automático com mandatos e instruções;
- CNAB 400 extensível;
- importação OFX e CSV;
- adapter Asaas;
- enforce de capacidades e limites dos planos;
- papéis e permissões padrão;
- migrations adicionais do Control Plane e Tenant Plane;
- workers especializados e migration de todos os tenants existentes;
- portal público de pagamento;
- pacotes Docker, Dockge, CloudPanel e Portainer;
- ACME DNS-01, agente CloudPanel e monitoramento opcional;
- documentação completa de deploy, produto e PR.

### Alterado

- Compose reorganizado para serviços especializados, health checks e profiles;
- contrato `.env.example` ampliado;
- frontend do Control Plane e Tenant Plane ampliado;
- Outbox e filas expandidos;
- scripts de instalação, backup, restore, atualização e rollback revisados;
- validador estrutural ampliado para código, frontend, Compose e deploys.

### Corrigido

- ausência de stack Portainer;
- pacote Dockge incompleto;
- automação CloudPanel insuficiente;
- falta de ambientes específicos;
- Control Plane demonstrativo;
- ausência de título e descrição de PR;
- nomenclatura e contratos inconsistentes da entrega Alpha.

## 0.1.0-alpha.1 — 2026-08-20

- fundação inicial da plataforma;
- fluxo financeiro Sandbox;
- primeira estrutura multitenant;
- Compose e interface parciais;
