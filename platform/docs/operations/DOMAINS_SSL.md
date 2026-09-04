# Domínios, Cloudflare e SSL

## Domínios da plataforma

```text
PLATFORM_DOMAIN=connect.exemplo.com.br
CONTROL_PLANE_HOST=control.connect.exemplo.com.br
API_HOST=api.connect.exemplo.com.br
TENANT_DOMAIN_ROOT=connect.exemplo.com.br
```

`API_HOST` atende saúde, documentação e informações públicas da API. O Control Plane utiliza exclusivamente `CONTROL_PLANE_HOST`. APIs, eventos, webhooks e recursos do tenant são publicados no domínio de cada tenant, pois o hostname participa da resolução do banco isolado.

Tenant `acme`:

```text
acme.connect.exemplo.com.br
```

## Modos Cloudflare

### Wildcard

`CLOUDFLARE_PROVISIONING_MODE=wildcard`

Um registro wildcard atende domínios provisionados. O provisionamento apenas registra o hostname no Control Plane.

### Records

`CLOUDFLARE_PROVISIONING_MODE=records`

Cada tenant recebe um CNAME pela API Cloudflare. Exige:

```text
CLOUDFLARE_ENABLED=true
CLOUDFLARE_API_TOKEN=...
CLOUDFLARE_ZONE_ID=...
CLOUDFLARE_ZONE_NAME=exemplo.com.br
CLOUDFLARE_TENANT_RECORD_TARGET=connect.exemplo.com.br
```

Use token com menor privilégio possível.

## Domínio personalizado

Exemplo:

```text
app.cliente.com.br CNAME connect.exemplo.com.br
```

O domínio é inserido no Control Plane e fica `PENDING/VERIFYING` até a verificação. Após a verificação DNS, o domínio entra em `WAITING_SSL`; o Domain Agent cria o vhost HTTP, emite o certificado e só então o marca como `ACTIVE`.

## Instalação do Domain Agent

Copie:

```bash
sudo cp deploy/platform/domain-agent/connect-api-domain-agent.service /etc/systemd/system/
sudo cp deploy/platform/domain-agent/connect-api-domain-agent.timer /etc/systemd/system/
sudo cp deploy/platform/domain-agent/domain-agent.env.example /etc/connect-api-domain-agent.env
sudo chmod 600 /etc/connect-api-domain-agent.env
```

Edite o env com o token do `.env` da stack.

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now connect-api-domain-agent.timer
sudo systemctl start connect-api-domain-agent.service
sudo journalctl -u connect-api-domain-agent.service -n 100 --no-pager
```

O agente:

1. consulta o feed autenticado do Control Plane e considera domínios `WAITING_SSL`/`ACTIVE`;
2. valida cada hostname;
3. grava arquivos Nginx atomicamente;
4. executa `nginx -t`;
5. recarrega o Nginx;
6. emite/renova certificado pelo Certbot;
7. marca SSL ativo no Control Plane;
8. remove vhosts que deixaram de estar ativos.

## Segurança

- o token do agente deve ser aleatório e exclusivo;
- a API do agente não aceita JWT de tenant;
- hostnames passam por regex restritiva;
- arquivos são escritos com permissão 0640;
- `nginx -t` precisa passar antes do reload;
- não use `shell=True` no agente;
- preserve o cabeçalho Host no proxy.
