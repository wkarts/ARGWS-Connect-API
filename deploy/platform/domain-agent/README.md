# Connect|API Platform — Domain Agent

Agente **opcional de host** para instalações em que domínios personalizados são terminados no Nginx/Certbot do próprio servidor.
Ele não cria uma nova stack Docker e não altera os project names oficiais.

- `deploy/platform-production` continua usando `argws-connect-platform-production`.
- `deploy/platform-develop` continua usando `argws-connect-platform-develop`.
- Em CloudPanel, prefira o profile Docker `cloudpanel` (`platform-acme` + `platform-cloudpanel-agent`).
- Em Nginx/Certbot de host sem CloudPanel, use este agente.

Instalação resumida:

```bash
sudo mkdir -p /opt/argws-connect-api
sudo rsync -a ./ /opt/argws-connect-api/
sudo cp deploy/platform/domain-agent/domain-agent.env.example /etc/connect-api-domain-agent.env
sudo chmod 600 /etc/connect-api-domain-agent.env
sudo cp deploy/platform/domain-agent/connect-api-domain-agent.service /etc/systemd/system/
sudo cp deploy/platform/domain-agent/connect-api-domain-agent.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now connect-api-domain-agent.timer
```

Configure `CONTROL_PLANE_URL`, `DOMAIN_RECONCILIATION_TOKEN`, `GATEWAY_UPSTREAM` e `ACME_EMAIL` antes de ativar o timer.
