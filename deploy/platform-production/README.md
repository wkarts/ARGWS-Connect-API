# Connect|API — platform-production

## Operação canônica

Forneça somente `compose.yaml` e `.env` ao Dockge/Compose. ACME e CloudPanel Agent iniciam normalmente, sem profile adicional.

No CloudPanel, crie/mantenha um Reverse Proxy base:

```text
Domínio: connect.argws.com.br
URL: http://127.0.0.1:38800
```

Valores personalizados prevalecem no `.env`. O agente aguarda o VHost; não exige scripts no VPS, cron de host, importação manual de certificado nem criação de VHost por cliente.

## Serviços do produto completo

Engine Node/Prisma, DOCs, Control API, Vue, gateway, workers, scheduler, migrations/bootstrap/backup, dois PostgreSQL, **dois PgBouncer**, Redis, RabbitMQ, MinIO e observabilidade. ACME DNS-01 e CloudPanel Agent são parte do produto completo.

O serviço ACME usa Cloudflare DNS-only para base/wildcard/aliases. O backend reconcilia registros legados exclusivamente de clientes cadastrados. O agente valida upstream/Host, NGINX e certificado servido e mantém journal persistente para recuperação após interrupção.

## Configuração necessária

`ACME_EMAIL`, `CLOUDFLARE_API_TOKEN` (Zone:Read + DNS:Edit) e origem pública válida. `CLOUDFLARE_TENANT_RECORD_TARGET` aceita IP ou hostname de origem gerenciado; nesse segundo caso todas as zonas da cadeia precisam ser legíveis pelo token. `CLOUDFLARE_ORIGIN_IPV4/IPv6` opcionais permitem criar o alias explicitamente escolhido. Nenhum IP é inventado.

`PLATFORM_TLS_AUTOMATION_ENABLED=true`, `ACME_STAGING=false`. Certificados staging não são instalados. Domínios externos exigem fluxo TLS próprio.

## Instalar e atualizar

Use [install-connect.py](../../install-connect.py) e o [guia do instalador](../../docs/guides/universal-installer.md), ou a ação de atualização do Dockge. O instalador apenas organiza fonte/versão/Compose: operações administrativas continuam nos serviços. Preserve nomes, portas, bancos, volumes, credenciais e chaves de criptografia.

Produção exige release estável publicada com todas as imagens correspondentes. Código em `develop` e um Compose de produção atualizado não equivalem à promoção para `latest`. Não misture imagens de aplicação de canais diferentes; imagens de infraestrutura mantêm seus versionamentos próprios.

## Segurança operacional

CloudPanel Agent: `privileged`, `pid: host`, `network_mode: host`, `/:/host:rw`, filesystem read-only, sem endpoint/portas. Trate-o como root no VPS.

A observabilidade preexistente também confia no Docker Socket Proxy: `POST=0` limita o que o proxy oferece, mas a montagem do socket bruto continua uma fronteira administrativa. Dockge, quando utilizado, também possui esse acesso. A afirmação “apenas um processo possui acesso potencial root” não se aplica a esses componentes preexistentes; nenhum privilégio foi acrescentado à API, workers ou bancos.

## Verificação

No Dockge confira separadamente ACME, CloudPanel Agent, PgBouncer, migrations e API. O recibo `/tls-status/cloudpanel.json` diferencia `last_installed_at` de `last_verified_at`; o marcador TXT registra somente instalações reais. O status READY exige upstream configurado e certificado servido, mas não substitui testes funcionais de usuários e WhatsApp.

Consulte [provisionamento e TLS](../../docs/guides/platform-ssl-instances-corrective.md) e [contrato operacional](../../OPERATIONS-CONTRACT.md). A stack clássica/API-first tem escopo diferente e não inclui essa Platform; não execute ambas disputando portas/domínios.
