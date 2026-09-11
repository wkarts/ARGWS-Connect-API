#!/usr/bin/env python3
"""Synchronize the additive operations contract in active API deployment templates.

Only deployment files are generated. Runtime secrets and installed stacks are
never opened by this repository maintenance command. --check is read-only.
"""
import argparse
import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
ENV_KEYS = {
    'COMPOSE_PROFILES': 'operations',
    'OPERATIONS_ENABLED': 'true',
    'OPERATIONS_AGENT_URL': 'http://operations:8092',
    'OPERATIONS_INTERNAL_TOKEN': 'CHANGE_ME_OPERATIONS_INTERNAL_TOKEN',
    'ARGWS_CONNECT_OPERATIONS_DATA_PATH': './volumes/operations',
    'OPERATIONS_HOT_DAYS': '3',
    'OPERATIONS_RETENTION_DAYS': '90',
}
CASES = [
    ('docker-compose.yaml', 'api', 'operations', 'argws-connect-net', 'latest', True),
    ('docker-compose.dev.yaml', 'api', 'operations', 'argws-connect-dev-net', 'develop', False),
    ('deploy/develop/compose.yaml', 'api-argws-connect-develop', 'operations-argws-connect-develop', 'argws-connect-develop-net', 'develop', True),
    ('deploy/production/compose.yaml', 'api-argws-connect-production', 'operations-argws-connect-production', 'argws-connect-production-net', 'latest', True),
    ('deploy/homologation/compose.yaml', 'api', 'operations', 'argws-connect-net', 'develop', True),
    ('deploy/cloudpanel/docker-compose.yml', 'api', 'operations', 'argws-connect-net', 'latest', True),
    ('deploy/dockge/compose.yaml', 'api', 'operations', 'argws-connect-net', 'latest', True),
]


def section(text, name):
    match = re.search(r'^  ' + re.escape(name) + r':\s*\n', text, re.M)
    if not match:
        raise ValueError('Missing Compose service: ' + name)
    tail = re.search(r'^(?:  [\w.-]+:|[^\s#][^\n]*:)', text[match.end():], re.M)
    end = match.end() + tail.start() if tail else len(text)
    return match.start(), end, text[match.start():end]


def replace_service(text, name, content):
    start, end, _ = section(text, name)
    return text[:start] + content.rstrip() + '\n\n' + text[end:]


def environment(block, entries):
    for key, value in entries.items():
        line = f'      {key}: {value}'
        pattern = r'^      ' + re.escape(key) + r':[^\n]*$'
        if re.search(pattern, block, re.M):
            block = re.sub(pattern, lambda _: line, block, flags=re.M)
        elif '    environment:\n' in block:
            block = block.replace('    environment:\n', '    environment:\n' + line + '\n', 1)
        else:
            first = block.index('\n') + 1
            block = block[:first] + '    environment:\n' + line + '\n' + block[first:]
    return block


def compose_text(text, api, agent, network, image, full):
    _, _, api_block = section(text, api)
    api_block = environment(api_block, {
        'OPERATIONS_ENABLED': '${OPERATIONS_ENABLED:-false}',
        'OPERATIONS_AGENT_URL': '${OPERATIONS_AGENT_URL:-http://operations:8092}',
        'OPERATIONS_INTERNAL_TOKEN': '${OPERATIONS_INTERNAL_TOKEN:-}',
    })
    # These flags control Manager navigation/routes, not native API permissions.
    communication = 'true' if image == 'develop' else 'false'
    api_block = environment(api_block, {
        'MANAGER_FEATURE_CONVERSATIONS': '${MANAGER_FEATURE_CONVERSATIONS:-' + communication + '}',
        'MANAGER_FEATURE_MESSAGES': '${MANAGER_FEATURE_MESSAGES:-' + communication + '}',
        'MANAGER_FEATURE_CONTACTS': '${MANAGER_FEATURE_CONTACTS:-' + communication + '}',
        'MANAGER_FEATURE_INSTANCE_TEST_MESSAGE': '${MANAGER_FEATURE_INSTANCE_TEST_MESSAGE:-true}',
        'MANAGER_FEATURE_TEST_MESSAGE_CONTACTS': '${MANAGER_FEATURE_TEST_MESSAGE_CONTACTS:-' + communication + '}',
    })
    text = replace_service(text, api, api_block)
    suffix = api[4:] if api.startswith('api-') else ''
    service = lambda name: name + ('-' + suffix if suffix else '')
    checks = [{'service': 'api', 'type': 'http', 'url': f'http://{api}:8080/health'}]
    if full:
        checks += [
            {'service': 'docs', 'type': 'http', 'url': f'http://{service("docs")}:8080/health'},
            {'service': 'database', 'type': 'tcp', 'url': f'tcp://{service("postgres")}:5432'},
            {'service': 'cache', 'type': 'tcp', 'url': f'tcp://{service("redis")}:6379'},
            {'service': 'events', 'type': 'tcp', 'url': f'tcp://{service("rabbitmq")}:5672'},
            {'service': 'storage', 'type': 'http', 'url': f'http://{service("minio")}:9000/minio/health/live'},
        ]
    container_name = f'    container_name: {agent}\n' if suffix else ''
    agent_block = f'''  {agent}:
{container_name}    profiles: ["operations"]
    image: ${{ARGWS_CONNECT_API_IMAGE:-ghcr.io/wkarts/argws-connect-api:{image}}}
    pull_policy: always
    restart: unless-stopped
    entrypoint: ["node", "/argws-connect/operations-agent/server.cjs"]
    environment:
      TZ: ${{TZ:-America/Bahia}}
      OPERATIONS_INTERNAL_TOKEN: ${{OPERATIONS_INTERNAL_TOKEN:-}}
      OPERATIONS_DATA_PATH: /data
      OPERATIONS_HOT_DAYS: ${{OPERATIONS_HOT_DAYS:-3}}
      OPERATIONS_RETENTION_DAYS: ${{OPERATIONS_RETENTION_DAYS:-90}}
      OPERATIONS_CHECKS: '{json.dumps(checks, separators=(',', ':'))}'
    expose: ["8092"]
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    mem_limit: 192m
    cpus: "0.50"
    pids_limit: 64
    volumes:
      - ${{ARGWS_CONNECT_OPERATIONS_DATA_PATH:-./volumes/operations}}:/data
    networks:
      {network}:
        aliases: [operations]
    healthcheck:
      test: ["CMD", "node", "-e", "fetch('http://127.0.0.1:8092/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"]
      interval: 30s
      timeout: 5s
      retries: 5
    logging:
      driver: json-file
      options:
        max-size: ${{DOCKER_LOG_MAX_SIZE:-20m}}
        max-file: "${{DOCKER_LOG_MAX_FILE:-5}}"
'''
    if re.search(r'^  ' + re.escape(agent) + ':', text, re.M):
        text = replace_service(text, agent, agent_block)
    else:
        _, end, _ = section(text, api)
        text = text[:end] + agent_block + '\n' + text[end:]
    return text


def env_text(text):
    for key, value in ENV_KEYS.items():
        line = f'{key}={value}'
        if re.search(r'^' + key + '=', text, re.M):
            text = re.sub(r'^' + key + r'=[^\n]*', lambda _: line, text, flags=re.M)
        else:
            text = text.rstrip() + '\n' + line + '\n'
    return text


def wrapper():
    return '''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
command -v python3 >/dev/null 2>&1 || { echo "ERRO: python3 necessario para preparar o ambiente com seguranca."; exit 1; }
python3 ./prepare-operations-env.py --env-file .env --template env.example "$@"
'''


def generate(root):
    outputs = {}
    helper = (root / 'scripts/prepare-operations-env.py').read_text()
    for path, api, agent, network, image, full in CASES:
        outputs[path] = compose_text((root / path).read_text(), api, agent, network, image, full)
    envs = ['.env.example', 'env.example']
    directories = ['deploy/develop', 'deploy/production', 'deploy/homologation', 'deploy/cloudpanel', 'deploy/dockge']
    for directory in directories:
        envs.append(directory + '/env.example')
        if (root / directory / '.env.example').exists():
            envs.append(directory + '/.env.example')
    for path in envs:
        template = env_text((root / path).read_text())
        visible = 'true' if path.startswith(('deploy/develop/', 'deploy/homologation/')) else 'false'
        settings = {
            'MANAGER_FEATURE_CONVERSATIONS': visible, 'MANAGER_FEATURE_MESSAGES': visible,
            'MANAGER_FEATURE_CONTACTS': visible, 'MANAGER_FEATURE_INSTANCE_TEST_MESSAGE': 'true',
            'MANAGER_FEATURE_TEST_MESSAGE_CONTACTS': visible,
        }
        for key, value in settings.items():
            line = key + '=' + value
            if re.search(r'^' + key + '=', template, re.M):
                template = re.sub(r'^' + key + r'=[^\n]*', lambda _: line, template, flags=re.M)
            else:
                template = template.rstrip() + '\n' + line + '\n'
        outputs[path] = template
    for directory in ['.'] + directories:
        prefix = '' if directory == '.' else directory + '/'
        outputs[prefix + 'prepare-operations-env.py'] = helper
        outputs[prefix + 'prepare-env.sh'] = wrapper()
        compose = 'docker-compose.yaml' if directory == '.' else 'docker-compose.yml' if directory.endswith('cloudpanel') else 'compose.yaml'
        for script in ('deploy.sh', 'update.sh', 'preflight.sh'):
            path = prefix + script
            if (root / path).exists():
                text = (root / path).read_text()
                if script != 'preflight.sh':
                    text = re.sub(r'^\./prepare-env\.sh\s*\n', '', text, flags=re.M)
                    hook = './prepare-env.sh\nexport COMPOSE_PROFILES="$(python3 ./prepare-operations-env.py --print-profiles)"\n'
                else:
                    hook = 'python3 ./prepare-operations-env.py --check\nexport COMPOSE_PROFILES="$(python3 ./prepare-operations-env.py --print-profiles)"\n'
                text = re.sub(r'^export COMPOSE_PROFILES="\$\(python3 \./prepare-operations-env.py --print-profiles\)"\n', '', text, flags=re.M)
                text = re.sub(r'^python3 \./prepare-operations-env.py --check\n', '', text, flags=re.M)
                needle = 'cd "$(dirname "$0")"\n'
                if needle not in text:
                    raise ValueError('Unknown installer entry point: ' + path)
                text = text.replace(needle, needle + hook, 1)
                if directory.endswith('cloudpanel'):
                    text = text.replace('-f compose.yaml', '-f docker-compose.yml')
                outputs[path] = text
            else:
                text = '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\n'
                text += 'python3 ./prepare-operations-env.py --check\n' if script == 'preflight.sh' else './prepare-env.sh\n'
                text += 'export COMPOSE_PROFILES="$(python3 ./prepare-operations-env.py --print-profiles)"\n'
                text += f'docker compose --env-file .env -f {compose} config --quiet\n'
                if script != 'preflight.sh':
                    text += f'docker compose --env-file .env -f {compose} pull\n'
                    if script == 'update.sh':
                        text += f'''if docker compose --env-file .env -f {compose} ps -q | grep -q .; then
  echo "Criando e verificando backup antes da atualizacao (aguarde janela sem chamadas)."
  BACKUP_FILE="$(bash ./backup.sh)"
  bash ./verify-backup.sh "$BACKUP_FILE"
fi
'''
                    text += f'docker compose --env-file .env -f {compose} up -d\ndocker compose --env-file .env -f {compose} ps\n'
                outputs[path] = text
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    changed = []
    for path, text in generate(args.root).items():
        target = args.root / path
        if not target.exists() or target.read_text() != text:
            changed.append(path)
            if not args.check:
                target.write_text(text)
        if not args.check and path.endswith('.sh'):
            target.chmod(0o755)
    if args.check and changed:
        raise SystemExit('Operations deployment templates out of sync: ' + ', '.join(changed))
    print('Operations deployment contract: ' + ('verified' if args.check else f'{len(changed)} files synchronized'))


if __name__ == '__main__':
    main()
