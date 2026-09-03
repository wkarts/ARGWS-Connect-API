# Deploy no CloudPanel

## Objetivo

Instalar a plataforma atrás do Nginx gerenciado pelo CloudPanel, com domínio principal, Control Plane, API, wildcard de tenants e domínios personalizados.

## Arquivos entregues

```text
deployments/cloudpanel/
├── .env.example
├── compose.yaml
├── install.sh
├── update.sh
├── rollback.sh
├── healthcheck.sh
├── README.md
└── vhosts/
```

## Topologia de domínios

Para o domínio-base `connect.exemplo.com.br`:

```text
connect.exemplo.com.br
control.connect.exemplo.com.br
api.connect.exemplo.com.br
*.connect.exemplo.com.br
```

Todos os hosts encaminham para o gateway Docker em `127.0.0.1:8800`, preservando o cabeçalho `Host`. O backend usa esse hostname para separar Control Plane e Tenant Plane e selecionar o banco do tenant.

## DNS

Crie registros A/AAAA ou CNAME apontando para o servidor. O wildcard é necessário para domínios provisionados no formato `<slug>.connect.exemplo.com.br`.

## Instalação automatizada

Execute como root ou usuário com acesso a `clpctl` e Docker:

```bash
sudo ./deployments/cloudpanel/install.sh \
  --domain connect.exemplo.com.br \
  --admin-email admin@exemplo.com.br \
  --stack-dir /home/connectapi/htdocs/connect.exemplo.com.br/connect-api-platform \
  --site-user financial
```

Opções adicionais:

```text
--no-create-sites      não executar comandos clpctl
--enable-acme          habilitar emissão wildcard DNS-01 pela Cloudflare
--enable-monitoring    subir Prometheus e Grafana
--skip-up              preparar e validar sem iniciar containers
```

Exemplo de preparação sem alterar o CloudPanel:

```bash
sudo ./deployments/cloudpanel/install.sh \
  --domain connect.exemplo.com.br \
  --admin-email admin@exemplo.com.br \
  --stack-dir /tmp/connect-api-platform \
  --no-create-sites \
  --skip-up
```

## Automação CloudPanel

Quando habilitada, a instalação usa `clpctl site:add:reverse-proxy` para criar os reverse proxies do domínio principal, Control Plane e API. Depois ajusta o vhost principal para aceitar o wildcard de tenants. A instalação de certificados individuais usa `clpctl lets-encrypt:install:certificate` quando o DNS já está resolvendo.

O wildcard pode ser atendido por:

- certificado wildcard emitido por DNS-01 Cloudflare;
- certificado Origin da Cloudflare;
- outro certificado válido instalado no CloudPanel.

## Cloudflare e ACME DNS-01

Para `--enable-acme`, configure no `.env`:

```env
CLOUDFLARE_API_TOKEN=
CLOUDFLARE_ZONE_ID=
ACME_EMAIL=admin@exemplo.com.br
```

Use token restrito à zona e com a menor permissão necessária para editar DNS. O serviço ACME mantém certificados e o agente CloudPanel instala/reconcilia o certificado no host.

## Domínios personalizados

O Control Plane registra o domínio, orienta o CNAME/A, verifica a resolução e mantém os estados DNS/SSL. O Domain Agent reconcilia vhost e certificado. Nunca existe fallback de um hostname desconhecido para outro tenant.

## Atualização

```bash
cd /caminho/connect-api-platform
./deployments/cloudpanel/update.sh
```

O script realiza backup, validação, rebuild, migrations e readiness.

## Rollback

```bash
./deployments/cloudpanel/rollback.sh /caminho/do/backup.tar.zst
```

## Health check

```bash
./deployments/cloudpanel/healthcheck.sh
```

Valide externamente:

```bash
curl -fsS https://api.connect.exemplo.com.br/health/live
curl -fsS https://api.connect.exemplo.com.br/health/ready
```

## Segurança operacional

- não exponha PostgreSQL, Redis, RabbitMQ ou MinIO publicamente;
- restrinja consoles administrativos ao host/VPN;
- preserve `.env`, `.bootstrap-credentials.txt` e a identidade `age` fora do Git;
- altere a senha inicial do Control Plane;
- valide backup e restore antes da entrada em produção.
