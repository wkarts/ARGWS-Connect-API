# Deploy Completo em CloudPanel e Dockge

## 1. Pré-requisitos

- servidor Linux 64-bit;
- CloudPanel instalado;
- Docker Engine e Docker Compose v2;
- Dockge instalado;
- portas 80/443 publicadas pelo Nginx do host;
- acesso DNS à zona;
- pelo menos 4 vCPU, 8 GB RAM e SSD para ambiente pequeno;
- SMTP/Evolution/banco configuráveis após o primeiro acesso.

## 2. DNS inicial

Para `connect.exemplo.com.br`, crie:

```text
A/CNAME  connect.exemplo.com.br
A/CNAME  control.connect.exemplo.com.br
A/CNAME  api.connect.exemplo.com.br
A/CNAME  *.connect.exemplo.com.br
```

O host `api.*` é central para saúde, OpenAPI e informações públicas da API. O Control Plane opera exclusivamente em `control.*`; rotas financeiras e webhooks usam o hostname do tenant (`<slug>.financeiro...` ou domínio personalizado), mantendo a seleção do banco isolado.

Todos devem chegar ao CloudPanel/Nginx do servidor. Com Cloudflare, mantenha o token limitado à zona e somente com permissão de DNS quando o modo automático estiver habilitado.

## 3. Diretório da stack

Exemplo:

```bash
mkdir -p /home/usuario/htdocs/connect.exemplo.com.br/dockge-stacks/connect-api-platform
```

Execute a partir do pacote extraído:

```bash
./scripts/deploy_cloudpanel_dockge.sh \
  --domain connect.exemplo.com.br \
  --cloudflare-zone exemplo.com.br \
  --admin-email admin@exemplo.com.br \
  --stack-dir /home/usuario/htdocs/connect.exemplo.com.br/dockge-stacks/connect-api-platform
```

Para apenas preparar e depois importar no Dockge:

```bash
./scripts/deploy_cloudpanel_dockge.sh \
  --domain connect.exemplo.com.br \
  --cloudflare-zone exemplo.com.br \
  --admin-email admin@exemplo.com.br \
  --stack-dir /caminho/dockge-stacks/connect-api-platform \
  --skip-up
```

## 4. O que o instalador gera

- `.env` de produção;
- segredos de aplicação;
- chave Fernet;
- senhas PostgreSQL, RabbitMQ e MinIO;
- administrador do Control Plane;
- token do Domain Agent;
- secrets de webhooks;
- arquivo `.bootstrap-credentials.txt` com modo 600.

O `.env` e o arquivo de credenciais não devem ser copiados para Git.

## 5. CloudPanel

Crie os sites/proxies abaixo:

```text
connect.exemplo.com.br
control.connect.exemplo.com.br
api.connect.exemplo.com.br
*.connect.exemplo.com.br
```

Todos apontam para:

```text
http://127.0.0.1:8800
```

O proxy precisa preservar:

```nginx
proxy_set_header Host $host;
proxy_set_header X-Real-IP $remote_addr;
proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
proxy_set_header X-Forwarded-Proto https;
proxy_set_header X-Request-ID $request_id;
```

Use o template `deployments/cloudpanel/nginx-vhost.conf.template` como referência. Ajustes manuais devem ser feitos pelo mecanismo de vhost/custom directives suportado pela sua versão do CloudPanel.

## 6. SSL

Use certificado wildcard quando possível:

```text
*.connect.exemplo.com.br
connect.exemplo.com.br
```

Domínios personalizados são tratados pelo Domain Agent. Consulte `DOMAINS_SSL.md`.

## 7. Dockge

No Dockge:

1. aponte o diretório de stacks para o diretório pai;
2. abra `connect-api-platform`;
3. confira `compose.yaml` e `.env`;
4. faça deploy;
5. acompanhe `connect-migrate` e `financial-init` até `Exited (0)`;
6. confirme os demais serviços como healthy/running.

## 8. Validação pós-deploy

```bash
cd /caminho/connect-api-platform
docker compose ps
curl -fsS http://127.0.0.1:8800/health/live
curl -fsS http://127.0.0.1:8800/health/ready
```

Acesse:

```text
https://control.connect.exemplo.com.br
```

Use as credenciais de `.bootstrap-credentials.txt` e altere a senha inicial.

## 9. Primeiro tenant

No Control Plane:

1. Tenants;
2. Novo tenant;
3. informe empresa inicial e administrador;
4. aguarde o job finalizar;
5. acesse `<slug>.connect.exemplo.com.br`;
6. autentique com o administrador informado.

## 10. Atualização

Antes de atualizar:

```bash
./scripts/backup.sh
```

Depois:

```bash
docker compose pull || true
docker compose build --pull
docker compose up -d
docker compose ps
```

`connect-migrate` executa migrations do Control Plane. Migrations de tenant são aplicadas no provisionamento e devem ser reconciliadas pelo processo de upgrade antes de ativar uma versão que altere schema de tenants existentes.

## 11. Rollback

- preserve a tag/imagem anterior;
- não faça downgrade de banco sem migration reversível validada;
- restaure backup quando a mudança de schema não for retrocompatível;
- valide `/health/ready` antes de reabrir o tráfego.

## 12. Portas

Por padrão, somente o gateway precisa de proxy externo:

```text
127.0.0.1:8800
```

Consoles administrativos ficam restritos ao host:

```text
RabbitMQ: 127.0.0.1:15672
MinIO:    127.0.0.1:9001
```
