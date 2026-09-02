from pathlib import Path
import re

ROOT=Path('.')
changed=[]

def write(path,text):
    p=ROOT/path
    old=p.read_text() if p.exists() else None
    if old != text:
        p.parent.mkdir(parents=True,exist_ok=True)
        p.write_text(text)
        changed.append(path)

# Integrated deployment source URLs use the public /docs prefix.
compose_paths={
    'deploy/production/compose.yaml':38180,
    'deploy/homologation/compose.yaml':38181,
    'deploy/develop/compose.yaml':38182,
    'deploy/canonical/compose.yaml':38183,
    'deploy/cloudpanel/docker-compose.yml':38180,
    'deploy/dockge/compose.yaml':38180,
}
for path,port in compose_paths.items():
    text=(ROOT/path).read_text()
    text=text.replace('"url":"/openapi/connect-api.openapi.json"','"url":"${ARGWS_CONNECT_DOCS_PUBLIC_BASE_PATH:-/docs}/openapi/connect-api.openapi.json"')
    text=text.replace('"url":"/openapi/meta-compatible.openapi.json"','"url":"${ARGWS_CONNECT_DOCS_PUBLIC_BASE_PATH:-/docs}/openapi/meta-compatible.openapi.json"')
    text=text.replace('"url":"/openapi/connect-api-events.asyncapi.json"','"url":"${ARGWS_CONNECT_DOCS_PUBLIC_BASE_PATH:-/docs}/openapi/connect-api-events.asyncapi.json"')
    write(path,text)

# Every deployment env declares the public path explicitly.
env_paths=[
    'deploy/production/env.example','deploy/homologation/env.example','deploy/develop/env.example','deploy/canonical/env.example',
    'deploy/cloudpanel/env.example','deploy/cloudpanel/.env.example','deploy/dockge/env.example','deploy/dockge/.env.example',
]
for path in env_paths:
    text=(ROOT/path).read_text()
    if 'ARGWS_CONNECT_DOCS_PUBLIC_BASE_PATH=' not in text:
        text=re.sub(r'^(ARGWS_CONNECT_DOCS_HOST_PORT=.*)$',r'\1\nARGWS_CONNECT_DOCS_PUBLIC_BASE_PATH=/docs',text,count=1,flags=re.M)
    write(path,text)

# Nginx reverse proxy for same-origin /docs endpoint.
def nginx(api_port,docs_port,max_body='136m'):
    return f'''# Connect|API - API + Connect|API DOCs no mesmo hostname.\n# /docs/ -> service DOCs; demais rotas -> API.\n\nlocation = /docs {{\n    return 301 /docs/;\n}}\n\nlocation /docs/ {{\n    proxy_pass http://127.0.0.1:{docs_port}/;\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n    proxy_set_header X-Forwarded-Prefix /docs;\n    proxy_read_timeout 3600s;\n    proxy_send_timeout 3600s;\n    proxy_connect_timeout 60s;\n}}\n\nlocation / {{\n    proxy_pass http://127.0.0.1:{api_port};\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n    proxy_set_header Upgrade $http_upgrade;\n    proxy_set_header Connection "upgrade";\n    proxy_read_timeout 3600s;\n    proxy_send_timeout 3600s;\n    proxy_connect_timeout 60s;\n    client_max_body_size {max_body};\n}}\n'''

write('deploy/production/nginx-location.conf.example',nginx(38080,38180))
write('deploy/homologation/nginx-location.conf.example',nginx(38081,38181,'150m'))
write('deploy/develop/nginx-location.conf.example',nginx(38082,38182))
write('deploy/canonical/nginx-location.conf.example',nginx(38083,38183))
write('deploy/cloudpanel/nginx/api-location.conf.example',nginx(38080,38180))

# Standalone always-on DOCs stack.
standalone_compose='''name: ${COMPOSE_PROJECT_NAME:-argws-connect-docs}\n\nx-logging: &default-logging\n  driver: json-file\n  options:\n    max-size: ${DOCKER_LOG_MAX_SIZE:-20m}\n    max-file: "${DOCKER_LOG_MAX_FILE:-5}"\n\nservices:\n  docs-argws-connect-standalone:\n    image: ${ARGWS_CONNECT_DOCS_IMAGE:-ghcr.io/wkarts/argws-connect-docs:latest}\n    pull_policy: always\n    container_name: docs-argws-connect-standalone\n    restart: unless-stopped\n    environment:\n      API_REFERENCE_CONFIG: >-\n        {"sources":[{"url":"${ARGWS_CONNECT_DOCS_PUBLIC_BASE_PATH:-/docs}/openapi/connect-api.openapi.json","title":"Connect|API REST API","slug":"rest","default":true},{"url":"${ARGWS_CONNECT_DOCS_PUBLIC_BASE_PATH:-/docs}/openapi/meta-compatible.openapi.json","title":"Connect|API Meta Compatible","slug":"meta-compatible"},{"url":"${ARGWS_CONNECT_DOCS_PUBLIC_BASE_PATH:-/docs}/openapi/connect-api-events.asyncapi.json","title":"Connect|API Events","slug":"events"}],"theme":"none","layout":"modern","darkMode":false,"showOperationId":true,"modelsSectionLabel":"Schemas","operationTitleSource":"summary","documentDownloadType":"both","showDeveloperTools":"localhost"}\n    ports:\n      - "${ARGWS_CONNECT_BIND_ADDRESS:-127.0.0.1}:${ARGWS_CONNECT_DOCS_HOST_PORT:-38280}:8080"\n    networks: [argws-connect-docs-net]\n    healthcheck:\n      test: ["CMD-SHELL", "wget -q -O /dev/null http://127.0.0.1:8080/health"]\n      interval: 30s\n      timeout: 5s\n      retries: 10\n      start_period: 20s\n    logging: *default-logging\n\nnetworks:\n  argws-connect-docs-net:\n    name: ${ARGWS_CONNECT_DOCS_NETWORK_NAME:-argws-connect-docs-net}\n    driver: bridge\n'''
write('deploy/docs/compose.yaml',standalone_compose)

standalone_env='''# Connect|API DOCs - deployment standalone / always-on\nCOMPOSE_PROJECT_NAME=argws-connect-docs\nARGWS_CONNECT_DOCS_NETWORK_NAME=argws-connect-docs-net\nARGWS_CONNECT_BIND_ADDRESS=127.0.0.1\nARGWS_CONNECT_DOCS_HOST_PORT=38280\nARGWS_CONNECT_DOCS_PUBLIC_BASE_PATH=/docs\nARGWS_CONNECT_DOCS_IMAGE=ghcr.io/wkarts/argws-connect-docs:latest\nDOCS_PUBLIC_URL=https://api.connect.argws.com.br/docs/\nDOCKER_LOG_MAX_SIZE=20m\nDOCKER_LOG_MAX_FILE=5\n'''
write('deploy/docs/env.example',standalone_env)

standalone_readme='''# Connect|API DOCs — Deployment Standalone\n\nStack independente para manter a documentação oficial **sempre online**, sem depender do ciclo de vida da API, PostgreSQL, Redis, RabbitMQ ou MinIO.\n\n## Componentes\n\n- image: `ghcr.io/wkarts/argws-connect-docs:latest`;\n- container: `docs-argws-connect-standalone`;\n- bind local padrão: `127.0.0.1:38280`;\n- URL pública recomendada: `https://api.connect.argws.com.br/docs/`;\n- healthcheck: `/health`.\n\n## Subir\n\n```bash\ncp env.example .env\n./preflight.sh\n./deploy.sh\n```\n\n## Reverse proxy\n\nUse `nginx-location.conf.example` no mesmo virtual host da API. O `proxy_pass` remove o prefixo `/docs/` antes de encaminhar ao Scalar.\n\nO frontend nunca precisa conhecer a porta `38280`: links da aplicação devem apontar para a URL relativa `/docs/`.\n\n## Convivência com as stacks completas\n\nEsta stack usa `38280`, portanto pode permanecer online enquanto `production`, `homologation`, `develop` ou `canonical` são atualizadas. As stacks completas continuam tendo seus próprios services DOCs nas portas `3818x`.\n\nSe o reverse proxy público usar o standalone, mantenha `/docs/ -> 127.0.0.1:38280`. Se preferir o DOCs integrado da produção, use `/docs/ -> 127.0.0.1:38180`.\n'''
write('deploy/docs/README.md',standalone_readme)

standalone_nginx='''# Connect|API DOCs standalone no mesmo hostname da API.\nlocation = /docs {\n    return 301 /docs/;\n}\n\nlocation /docs/ {\n    proxy_pass http://127.0.0.1:38280/;\n    proxy_http_version 1.1;\n    proxy_set_header Host $host;\n    proxy_set_header X-Real-IP $remote_addr;\n    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;\n    proxy_set_header X-Forwarded-Proto $scheme;\n    proxy_set_header X-Forwarded-Prefix /docs;\n    proxy_read_timeout 3600s;\n    proxy_send_timeout 3600s;\n    proxy_connect_timeout 60s;\n}\n'''
write('deploy/docs/nginx-location.conf.example',standalone_nginx)

write('deploy/docs/deploy.sh','''#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\n[[ -f .env ]] || cp env.example .env\n./preflight.sh\ndocker compose --env-file .env -f compose.yaml pull\ndocker compose --env-file .env -f compose.yaml up -d --remove-orphans\ndocker compose --env-file .env -f compose.yaml ps\necho "DOCs local: http://127.0.0.1:${ARGWS_CONNECT_DOCS_HOST_PORT:-38280}"\necho "DOCs public: ${DOCS_PUBLIC_URL:-https://api.connect.argws.com.br/docs/}"\n''')
write('deploy/docs/update.sh','''#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\ndocker compose --env-file .env -f compose.yaml pull\ndocker compose --env-file .env -f compose.yaml up -d --remove-orphans\n''')
write('deploy/docs/status.sh','''#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\ndocker compose --env-file .env -f compose.yaml ps\n''')
write('deploy/docs/preflight.sh','''#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\n[[ -f .env ]] || { echo "ERRO: .env inexistente. Copie env.example para .env."; exit 1; }\nget_value() { grep -E "^${1}=" .env | tail -n1 | cut -d= -f2-; }\nimage="$(get_value ARGWS_CONNECT_DOCS_IMAGE)"\n[[ -n "$image" ]] || { echo "ERRO: ARGWS_CONNECT_DOCS_IMAGE não definido."; exit 1; }\necho "Verificando ${image}..."\ndocker manifest inspect "$image" >/dev/null 2>&1 || { echo "ERRO: imagem indisponível: ${image}"; exit 1; }\ndocker compose --env-file .env -f compose.yaml config >/dev/null\necho "Preflight Connect|API DOCs concluído."\n''')

# Operator docs
path='deploy/README.md'; text=(ROOT/path).read_text()
if 'deploy/docs' not in text:
    text += '''\n\n## DOCs standalone / always-on\n\n`deploy/docs/` mantém o Connect|API DOCs online de forma independente na porta local `38280`. O reverse proxy recomendado publica a documentação em `/docs/` no mesmo hostname da API.\n'''
write(path,text)

path='docs/guides/deployment.md'; text=(ROOT/path).read_text()
if '### Endpoint público `/docs/`' not in text:
    text += '''\n\n### Endpoint público `/docs/`\n\nOs deployments oficiais definem `ARGWS_CONNECT_DOCS_PUBLIC_BASE_PATH=/docs`. O reverse proxy recebe `/docs/...`, remove o prefixo ao encaminhar para o Scalar e mantém a documentação no mesmo origin da API. Assim o frontend pode usar simplesmente `/docs/`, sem conhecer porta ou nome de container.\n\n### Deployment standalone\n\n`deploy/docs/` usa `127.0.0.1:38280` por padrão e pode ficar continuamente online mesmo durante deploy/restart das stacks da API.\n'''
write(path,text)

path='docs/README.md'; text=(ROOT/path).read_text()
if '## Endpoint público' not in text:
    text += '''\n\n## Endpoint público\n\nEm deployments com reverse proxy, a URL canônica é `/docs/`. Existe também `deploy/docs/` para operação standalone/always-on.\n'''
write(path,text)

# README root documents stable link; no compiled Manager bundle is modified.
path='README.md'; text=(ROOT/path).read_text()
if 'Documentação pública: `/docs/`' not in text:
    marker='## Manager\n'
    text=text.replace(marker,'Documentação pública: `/docs/` (reverse proxy para o service Connect|API DOCs).\n\n'+marker,1)
write(path,text)

print('\n'.join(changed))
print('COUNT',len(changed))
