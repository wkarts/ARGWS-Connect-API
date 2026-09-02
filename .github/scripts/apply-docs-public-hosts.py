from pathlib import Path
import re

PROD_URL = 'https://docs.connect.argws.com.br'
DEV_URL = 'https://d.docs.connect.argws.com.br'


def set_env_public_url(path, url):
    p = Path(path)
    s = p.read_text()
    s = re.sub(r'^ARGWS_CONNECT_DOCS_PUBLIC_BASE_PATH=.*\n', '', s, flags=re.M)
    if re.search(r'^ARGWS_CONNECT_DOCS_PUBLIC_URL=', s, flags=re.M):
        s = re.sub(r'^ARGWS_CONNECT_DOCS_PUBLIC_URL=.*$', f'ARGWS_CONNECT_DOCS_PUBLIC_URL={url}', s, flags=re.M)
    else:
        marker = re.search(r'^ARGWS_CONNECT_DOCS_HOST_PORT=.*$', s, flags=re.M)
        if not marker:
            raise RuntimeError(f'ARGWS_CONNECT_DOCS_HOST_PORT not found in {path}')
        pos = marker.end()
        s = s[:pos] + f'\nARGWS_CONNECT_DOCS_PUBLIC_URL={url}' + s[pos:]
    p.write_text(s)


prod_envs = [
    '.env.example',
    'deploy/production/env.example',
    'deploy/homologation/env.example',
    'deploy/canonical/env.example',
    'deploy/cloudpanel/env.example',
    'deploy/dockge/env.example',
]
for f in prod_envs:
    set_env_public_url(f, PROD_URL)
set_env_public_url('deploy/develop/env.example', DEV_URL)
Path('deploy/cloudpanel/.env.example').write_text(Path('deploy/cloudpanel/env.example').read_text())
Path('deploy/dockge/.env.example').write_text(Path('deploy/dockge/env.example').read_text())

# Relative contract URLs work at root, dedicated hostnames and optional /docs reverse proxy.
compose_files = [
    'docker-compose.yaml',
    'deploy/production/compose.yaml',
    'deploy/homologation/compose.yaml',
    'deploy/develop/compose.yaml',
    'deploy/canonical/compose.yaml',
    'deploy/cloudpanel/docker-compose.yml',
    'deploy/dockge/compose.yaml',
]
contracts = [
    'connect-api.openapi.json',
    'meta-compatible.openapi.json',
    'connect-api-events.asyncapi.json',
]
for f in compose_files:
    p = Path(f)
    s = p.read_text()
    for name in contracts:
        s = re.sub(r'\$\{ARGWS_CONNECT_DOCS_PUBLIC_BASE_PATH:-/docs\}/openapi/' + re.escape(name), 'openapi/' + name, s)
        s = s.replace('/openapi/' + name, 'openapi/' + name)
    p.write_text(s)

stable_compose = '''name: ${COMPOSE_PROJECT_NAME:-argws-connect-docs}

x-logging: &default-logging
  driver: json-file
  options:
    max-size: ${DOCKER_LOG_MAX_SIZE:-20m}
    max-file: "${DOCKER_LOG_MAX_FILE:-5}"

services:
  docs-argws-connect-standalone:
    image: ${ARGWS_CONNECT_DOCS_IMAGE:-ghcr.io/wkarts/argws-connect-docs:latest}
    pull_policy: always
    container_name: docs-argws-connect-standalone
    restart: unless-stopped
    environment:
      API_REFERENCE_CONFIG: >-
        {"sources":[{"url":"openapi/connect-api.openapi.json","title":"Connect|API REST API","slug":"rest","default":true},{"url":"openapi/meta-compatible.openapi.json","title":"Connect|API Meta Compatible","slug":"meta-compatible"},{"url":"openapi/connect-api-events.asyncapi.json","title":"Connect|API Events","slug":"events"}],"theme":"none","layout":"modern","darkMode":false,"showOperationId":true,"modelsSectionLabel":"Schemas","operationTitleSource":"summary","documentDownloadType":"both","showDeveloperTools":"localhost"}
    ports:
      - "${ARGWS_CONNECT_BIND_ADDRESS:-127.0.0.1}:${ARGWS_CONNECT_DOCS_HOST_PORT:-38280}:8080"
    networks: [argws-connect-docs-net]
    healthcheck:
      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:8080/health"]
      interval: 30s
      timeout: 5s
      retries: 10
      start_period: 20s
    logging: *default-logging

networks:
  argws-connect-docs-net:
    name: ${ARGWS_CONNECT_DOCS_NETWORK_NAME:-argws-connect-docs-net}
    driver: bridge
'''

stable_env = '''# Connect|API DOCs - standalone estável / always-on
COMPOSE_PROJECT_NAME=argws-connect-docs
ARGWS_CONNECT_DOCS_NETWORK_NAME=argws-connect-docs-net
ARGWS_CONNECT_BIND_ADDRESS=127.0.0.1
ARGWS_CONNECT_DOCS_HOST_PORT=38280
ARGWS_CONNECT_DOCS_PUBLIC_URL=https://docs.connect.argws.com.br
ARGWS_CONNECT_DOCS_IMAGE=ghcr.io/wkarts/argws-connect-docs:latest
DOCKER_LOG_MAX_SIZE=20m
DOCKER_LOG_MAX_FILE=5
'''

stable_nginx = '''# CloudPanel/Nginx vhost: docs.connect.argws.com.br
location / {
    proxy_pass http://127.0.0.1:38280;
    proxy_http_version 1.1;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_read_timeout 3600s;
    proxy_send_timeout 3600s;
    proxy_connect_timeout 60s;
}
'''

stable_readme = '''# Connect|API DOCs — Standalone Produção

Deployment independente/always-on da documentação oficial estável.

- imagem: `ghcr.io/wkarts/argws-connect-docs:latest`;
- bind local: `127.0.0.1:38280`;
- URL pública padrão: `https://docs.connect.argws.com.br`;
- healthcheck: `/health`.

O hostname público é atendido pelo CloudPanel/Nginx usando `nginx-location.conf.example`. O container continua acessível localmente pela porta 38280 sem depender da API.

```bash
cp env.example .env
./preflight.sh
./deploy.sh
```

As stacks completas mantêm seus próprios DOCs integrados nas portas `3818x`. Esta stack é a documentação pública estável e pode permanecer online durante deploys da API.
'''

deploy_sh = '''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[[ -f .env ]] || cp env.example .env
./preflight.sh
docker compose --env-file .env -f compose.yaml pull
docker compose --env-file .env -f compose.yaml up -d --remove-orphans
docker compose --env-file .env -f compose.yaml ps
public_url="$(grep '^ARGWS_CONNECT_DOCS_PUBLIC_URL=' .env | cut -d= -f2-)"
port="$(grep '^ARGWS_CONNECT_DOCS_HOST_PORT=' .env | cut -d= -f2-)"
echo "DOCs local: http://127.0.0.1:${port}"
echo "DOCs public: ${public_url}"
'''

update_sh = '''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose --env-file .env -f compose.yaml pull
docker compose --env-file .env -f compose.yaml up -d --remove-orphans
'''

status_sh = '''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
docker compose --env-file .env -f compose.yaml ps
'''

stable_preflight = '''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[[ -f .env ]] || { echo "ERRO: .env inexistente. Copie env.example para .env."; exit 1; }
get_value() { grep -E "^${1}=" .env | tail -n1 | cut -d= -f2-; }
image="$(get_value ARGWS_CONNECT_DOCS_IMAGE)"
url="$(get_value ARGWS_CONNECT_DOCS_PUBLIC_URL)"
[[ "$image" == "ghcr.io/wkarts/argws-connect-docs:latest" ]] || { echo "ERRO: DOCs produção deve usar :latest."; exit 1; }
[[ "$url" == "https://docs.connect.argws.com.br" ]] || { echo "ERRO: URL pública estável inválida: ${url}"; exit 1; }
docker manifest inspect "$image" >/dev/null 2>&1 || { echo "ERRO: imagem indisponível: ${image}"; exit 1; }
docker compose --env-file .env -f compose.yaml config >/dev/null
echo "Preflight Connect|API DOCs produção concluído."
'''

stable_dir = Path('deploy/docs')
stable_dir.mkdir(parents=True, exist_ok=True)
(stable_dir/'compose.yaml').write_text(stable_compose)
(stable_dir/'env.example').write_text(stable_env)
(stable_dir/'nginx-location.conf.example').write_text(stable_nginx)
(stable_dir/'README.md').write_text(stable_readme)
(stable_dir/'deploy.sh').write_text(deploy_sh)
(stable_dir/'update.sh').write_text(update_sh)
(stable_dir/'status.sh').write_text(status_sh)
(stable_dir/'preflight.sh').write_text(stable_preflight)

dev_compose = stable_compose.replace('argws-connect-docs}', 'argws-connect-docs-develop}')
dev_compose = dev_compose.replace('docs-argws-connect-standalone:', 'docs-argws-connect-standalone-develop:')
dev_compose = dev_compose.replace('container_name: docs-argws-connect-standalone', 'container_name: docs-argws-connect-standalone-develop')
dev_compose = dev_compose.replace('argws-connect-docs:latest', 'argws-connect-docs:develop')
dev_compose = dev_compose.replace(':-38280', ':-38282')
dev_compose = dev_compose.replace('argws-connect-docs-net]', 'argws-connect-docs-develop-net]')
dev_compose = dev_compose.replace('argws-connect-docs-net:', 'argws-connect-docs-develop-net:')
dev_compose = dev_compose.replace('ARGWS_CONNECT_DOCS_NETWORK_NAME:-argws-connect-docs-net', 'ARGWS_CONNECT_DOCS_NETWORK_NAME:-argws-connect-docs-develop-net')

dev_env = stable_env.replace('standalone estável / always-on', 'standalone desenvolvimento / always-on')
dev_env = dev_env.replace('COMPOSE_PROJECT_NAME=argws-connect-docs', 'COMPOSE_PROJECT_NAME=argws-connect-docs-develop')
dev_env = dev_env.replace('ARGWS_CONNECT_DOCS_NETWORK_NAME=argws-connect-docs-net', 'ARGWS_CONNECT_DOCS_NETWORK_NAME=argws-connect-docs-develop-net')
dev_env = dev_env.replace('ARGWS_CONNECT_DOCS_HOST_PORT=38280', 'ARGWS_CONNECT_DOCS_HOST_PORT=38282')
dev_env = dev_env.replace('https://docs.connect.argws.com.br', 'https://d.docs.connect.argws.com.br')
dev_env = dev_env.replace('argws-connect-docs:latest', 'argws-connect-docs:develop')

dev_nginx = stable_nginx.replace('docs.connect.argws.com.br', 'd.docs.connect.argws.com.br').replace('38280', '38282')
dev_readme = '''# Connect|API DOCs — Standalone Develop

Deployment independente/always-on da documentação do canal de desenvolvimento.

- imagem: `ghcr.io/wkarts/argws-connect-docs:develop`;
- bind local: `127.0.0.1:38282`;
- URL pública padrão: `https://d.docs.connect.argws.com.br`;
- healthcheck: `/health`.

Esse ambiente acompanha a branch `develop` e não interfere na documentação estável em `docs.connect.argws.com.br`.

```bash
cp env.example .env
./preflight.sh
./deploy.sh
```
'''

dev_preflight = stable_preflight.replace('argws-connect-docs:latest', 'argws-connect-docs:develop')
dev_preflight = dev_preflight.replace('DOCs produção deve usar :latest.', 'DOCs develop deve usar :develop.')
dev_preflight = dev_preflight.replace('https://docs.connect.argws.com.br', 'https://d.docs.connect.argws.com.br')
dev_preflight = dev_preflight.replace('produção concluído', 'develop concluído')

dev_dir = Path('deploy/docs-develop')
dev_dir.mkdir(parents=True, exist_ok=True)
(dev_dir/'compose.yaml').write_text(dev_compose)
(dev_dir/'env.example').write_text(dev_env)
(dev_dir/'nginx-location.conf.example').write_text(dev_nginx)
(dev_dir/'README.md').write_text(dev_readme)
(dev_dir/'deploy.sh').write_text(deploy_sh)
(dev_dir/'update.sh').write_text(update_sh)
(dev_dir/'status.sh').write_text(status_sh)
(dev_dir/'preflight.sh').write_text(dev_preflight)

p = Path('deploy/README.md')
s = p.read_text()
marker = '## Connect|API DOCs — hostnames públicos'
if marker not in s:
    s += '''\n\n## Connect|API DOCs — hostnames públicos\n\n- `deploy/docs/` → `https://docs.connect.argws.com.br` → `127.0.0.1:38280` → `:latest`;\n- `deploy/docs-develop/` → `https://d.docs.connect.argws.com.br` → `127.0.0.1:38282` → `:develop`.\n\nAs stacks completas mantêm DOCs integrados nas portas `38180` a `38183`. A variável `ARGWS_CONNECT_DOCS_PUBLIC_URL` define o destino público usado pela aplicação; somente o deployment `develop` usa por padrão `d.docs.connect.argws.com.br`.\n'''
    p.write_text(s)

p = Path('docs/guides/deployment.md')
s = p.read_text()
marker = '## Hostnames oficiais do Connect|API DOCs'
if marker not in s:
    s += '''\n\n## Hostnames oficiais do Connect|API DOCs\n\n- estável/produção: `https://docs.connect.argws.com.br`;\n- desenvolvimento: `https://d.docs.connect.argws.com.br`.\n\nOs containers usam contratos com URLs relativas (`openapi/...`), portanto a mesma imagem funciona diretamente na porta local, em hostname dedicado ou opcionalmente sob `/docs/` por reverse proxy.\n'''
    p.write_text(s)

print('DOCs public hostname topology materialized')
