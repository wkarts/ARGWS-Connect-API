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
    'NATS_ENABLED': 'false',
    'KAFKA_ENABLED': 'false',
    'MYSQL_SERVICE_ENABLED': 'false',
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
COMPOSE_ONLY_CASES = ['deploy/canonical/compose.yaml']
VOLUME_CASES = [
    ('.', 'docker-compose.yaml'),
    ('deploy/develop', 'compose.yaml'),
    ('deploy/production', 'compose.yaml'),
    ('deploy/homologation', 'compose.yaml'),
    ('deploy/canonical', 'compose.yaml'),
    ('deploy/cloudpanel', 'docker-compose.yml'),
    ('deploy/dockge', 'compose.yaml'),
]
MYSQL_CASES = [
    ('docker-compose.yaml', 'api', 'argws-connect-net'),
    ('docker-compose.dev.yaml', 'api', 'argws-connect-dev-net'),
    ('deploy/develop/compose.yaml', 'api-argws-connect-develop', 'argws-connect-develop-net'),
    ('deploy/production/compose.yaml', 'api-argws-connect-production', 'argws-connect-production-net'),
    ('deploy/canonical/compose.yaml', 'api-argws-connect-canonical', 'argws-connect-canonical-net'),
    ('deploy/homologation/compose.yaml', 'api', 'argws-connect-net'),
    ('deploy/cloudpanel/docker-compose.yml', 'api', 'argws-connect-net'),
    ('deploy/dockge/compose.yaml', 'api', 'argws-connect-net'),
]


def section(text, name):
    match = re.search(r'^  ' + re.escape(name) + r':\s*\n', text, re.M)
    if not match:
        raise ValueError('Missing Compose service: ' + name)
    tail = re.search(r'^(?:  [\w.-]+:|  # BEGIN OPTIONAL TRACCAR|[^\s#][^\n]*:)', text[match.end():], re.M)
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


def ensure_optional_mysql(text, api, network):
    """Keep the normal Compose topology complete; MySQL remains profile-gated."""
    suffix = api[4:] if api.startswith('api-') else ''
    name = 'mysql' + ('-' + suffix if suffix else '')
    if re.search(r'^  ' + re.escape(name) + r':\s*\n', text, re.M):
        _, _, existing = section(text, name)
        malformed = 'test: ["CMD-SHELL", "MYSQL_PWD="$${MYSQL_ROOT_PASSWORD}" mysqladmin ping -h 127.0.0.1 -u root --silent"]'
        corrected = "test: ['CMD-SHELL', 'MYSQL_PWD=\"$${MYSQL_ROOT_PASSWORD}\" mysqladmin ping -h 127.0.0.1 -u root --silent']"
        if malformed in existing:
            return replace_service(text, name, existing.replace(malformed, corrected))
        return text
    if suffix:
        container_name = name
        alias = name
    else:
        container_name = network.removesuffix('-net').replace('-', '_') + '_mysql'
        alias = network.removesuffix('-net') + '-mysql'
    block = f'''  {name}:
    profiles: ["mysql"]
    image: ${{ARGWS_CONNECT_MYSQL_IMAGE:-ghcr.io/wkarts/argws-connect-mysql:8.0}}
    pull_policy: always
    container_name: {container_name}
    restart: unless-stopped
    environment:
      MYSQL_DATABASE: ${{MYSQL_DATABASE:-argws_connect_api}}
      MYSQL_USER: ${{MYSQL_USERNAME:-argws_connect}}
      MYSQL_PASSWORD: ${{MYSQL_PASSWORD:-CHANGE_ME_MYSQL_PASSWORD}}
      MYSQL_ROOT_PASSWORD: ${{MYSQL_ROOT_PASSWORD:-CHANGE_ME_MYSQL_ROOT_PASSWORD}}
      TZ: ${{TZ:-America/Bahia}}
    expose: ["3306"]
    volumes:
      - ${{ARGWS_CONNECT_MYSQL_DATA_PATH:-./volumes/mysql}}:/var/lib/mysql
    networks:
      {network}:
        aliases: [{alias}]
    healthcheck:
      test: ['CMD-SHELL', 'MYSQL_PWD="$${{MYSQL_ROOT_PASSWORD}}" mysqladmin ping -h 127.0.0.1 -u root --silent']
      interval: 10s
      timeout: 5s
      retries: 20
      start_period: 40s
    logging:
      driver: json-file
      options:
        max-size: ${{DOCKER_LOG_MAX_SIZE:-20m}}
        max-file: "${{DOCKER_LOG_MAX_FILE:-5}}"
'''
    _, end, _ = section(text, api)
    return text[:end] + '\n' + block + '\n' + text[end:]


def env_text(text):
    for key, value in ENV_KEYS.items():
        line = f'{key}={value}'
        if re.search(r'^' + key + '=', text, re.M):
            text = re.sub(r'^' + key + r'=[^\n]*', lambda _: line, text, flags=re.M)
        else:
            text = text.rstrip() + '\n' + line + '\n'
    return text


def set_env_value(text, key, value):
    pattern = r'^' + re.escape(key) + r'=[^\n]*'
    line = key + '=' + value
    if re.search(pattern, text, re.M):
        return re.sub(pattern, line, text, flags=re.M)
    return text.rstrip() + '\n' + line + '\n'


def generate(root):
    """Synchronize declarative templates only.

    An installed stack is Compose + .env + its persisted volumes.  Repository
    maintenance helpers must never be copied into a deployment directory.
    """
    outputs = {}
    for path, api, agent, network, image, full in CASES:
        outputs[path] = compose_text((root / path).read_text(), api, agent, network, image, full)
    for path in COMPOSE_ONLY_CASES:
        outputs[path] = (root / path).read_text()
    for path, api, network in MYSQL_CASES:
        source = outputs.get(path, (root / path).read_text())
        outputs[path] = ensure_optional_mysql(source, api, network)
    envs = ['.env.example', 'env.example']
    directories = ['deploy/develop', 'deploy/production', 'deploy/homologation', 'deploy/cloudpanel', 'deploy/dockge']
    for directory in directories:
        envs.append(directory + '/env.example')
        if (root / directory / '.env.example').exists():
            envs.append(directory + '/.env.example')
    for path in envs:
        template = env_text((root / path).read_text())
        if path == 'deploy/develop/env.example':
            template = set_env_value(template, 'COMPOSE_PROFILES', 'operations,transcription')
            template = set_env_value(template, 'TRANSCRIPTION_ENABLED', 'true')
            template = set_env_value(template, 'TRANSCRIPTION_PROVIDER', 'local')
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
    # Preserve Find Hub in the existing operations scope only. The independent
    # Find Hub generator owns its additional canonical/docs/Swarm Compose files.
    from runpy import run_path
    findhub = run_path(str(root / 'scripts/sync-findhub-deployments.py'))
    additions = findhub['generate'](root, overrides=outputs)
    outputs.update({path: content for path, content in additions.items() if path in outputs})
    traccar = run_path(str(root / 'scripts/sync-traccar-deployments.py'))
    additions = traccar['generate'](root, overrides=outputs)
    outputs.update({path: content for path, content in additions.items() if path in outputs})

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
    if args.check and changed:
        raise SystemExit('Operations deployment templates out of sync: ' + ', '.join(changed))
    print('Operations deployment contract: ' + ('verified' if args.check else f'{len(changed)} files synchronized'))


if __name__ == '__main__':
    main()
