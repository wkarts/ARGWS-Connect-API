#!/usr/bin/env python3
"""Generate the Fersoft deployment contract: Compose, environment and volumes only.

An installed Fersoft stack never needs a helper executable. Service selection is
declared in .env and every runtime bootstrap lives in its image or Compose
entrypoint.
"""
import argparse
import importlib.util
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
CHANNELS = ('develop', 'production')
FULL_STACK_DEFAULTS = {
    'COMPOSE_PROFILES': 'operations,nats,kafka,mysql,traccar',
    'OPERATIONS_ENABLED': 'true',
    'NATS_ENABLED': 'true',
    'KAFKA_ENABLED': 'true',
    'KAFKA_AUTO_CREATE_TOPICS': 'true',
    'MYSQL_SERVICE_ENABLED': 'true',
    'TRACCAR_ENABLED': 'true',
    'TRACCAR_MODE': 'internal',
    'TRACCAR_REPLICAS': '1',
    'FINDHUB_MIN_TRACKING_INTERVAL_SECONDS': '0',
    'FINDHUB_STORE_POSITION_HISTORY': 'true',
    'SERVER_DISABLE_DOCS': 'false',
    'SERVER_DISABLE_MANAGER': 'false',
}

spec = importlib.util.spec_from_file_location('ops', ROOT / 'scripts/prepare-operations-env.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class LiteralBlock(str):
    """Keep the in-Compose Node bootstrap readable after the YAML round trip."""


def literal_block(dumper, value):
    return dumper.represent_scalar('tag:yaml.org,2002:str', value, style='|')


yaml.SafeDumper.add_representer(LiteralBlock, literal_block)


def suffix(channel):
    return f'fersoft-connect-{channel}'


def source_suffix(channel):
    return f'argws-connect-{channel}'


def replace_identity(value, channel):
    source = source_suffix(channel)
    target = suffix(channel)
    if isinstance(value, str):
        return value.replace(source, target)
    if isinstance(value, list):
        return [replace_identity(item, channel) for item in value]
    if isinstance(value, dict):
        return {replace_identity(key, channel): replace_identity(item, channel) for key, item in value.items()}
    return value


def overrides(channel):
    stack = suffix(channel)
    server = 'https://d.api.connect.fersofterp.com.br' if channel == 'develop' else 'https://api.connect.fersofterp.com.br'
    host = server.split('://', 1)[1]
    database = 'fersoft_connect_develop' if channel == 'develop' else 'fersoft_connect_api'
    values = {
        'COMPOSE_PROJECT_NAME': stack,
        'ARGWS_CONNECT_NETWORK_NAME': f'{stack}-net',
        'ARGWS_CONNECT_API_HOST_PORT': '38082' if channel == 'develop' else '38080',
        'ARGWS_CONNECT_DOCS_PUBLIC_URL': f'{server}/manager/docs',
        'SERVER_NAME': 'fersoft-connect-api-develop' if channel == 'develop' else 'fersoft-connect-api',
        'SERVER_URL': server,
        'WEBSOCKET_ALLOWED_HOSTS': f'127.0.0.1,::1,{host}',
        'DATABASE_CONNECTION_URI': f'postgresql://fersoft_connect:CHANGE_ME_POSTGRES_PASSWORD@postgres-{stack}:5432/{database}?schema=public',
        'DATABASE_CONNECTION_CLIENT_NAME': stack,
        'POSTGRES_DATABASE': database,
        'POSTGRES_USERNAME': 'fersoft_connect',
        'MYSQL_DATABASE': database,
        'MYSQL_USERNAME': 'fersoft_connect',
        'TRACCAR_ADMIN_EMAIL': 'suporte@fersofterp.com.br',
        'KAFKA_BROKERS': f'kafka-{stack}:9092',
    }
    values.update(FULL_STACK_DEFAULTS)
    return values


def compose_for(channel):
    compose = replace_identity(
        yaml.safe_load((ROOT / f'deploy/{channel}/compose.yaml').read_text(encoding='utf-8')),
        channel,
    )
    services = compose['services']
    services[f'docs-{suffix(channel)}'].pop('ports', None)
    for name, service in services.items():
        if name.startswith(('traccar-bootstrap-', 'volume-init-', 'mysql-volume-init-', 'traccar-postgres-')):
            command = service.get('command')
            if isinstance(command, list) and len(command) == 1 and isinstance(command[0], str):
                service['command'] = LiteralBlock(command[0].rstrip())
            elif isinstance(command, str):
                service['command'] = LiteralBlock(command.rstrip())
    return yaml.safe_dump(compose, sort_keys=False, allow_unicode=True, width=120)


def environment_for(channel):
    text = (ROOT / f'deploy/{channel}/env.example').read_text(encoding='utf-8')
    text = text.replace(source_suffix(channel), suffix(channel))
    for key, value in overrides(channel).items():
        text = ops.set_value(text, key, value)
    header = (
        '# FERSOFT FULL STACK: um compose, um .env e os volumes existentes.\n'
        '# Todos os services opcionais sao selecionados aqui; nao use arquivos auxiliares.\n'
    )
    return header + text.replace(
        '# Duas portas locais publicadas: API e Connect|API DOCs. Manager permanece em /manager.',
        '# Uma porta local publicada: API. Manager e DOCs permanecem na API.',
    )


def readme():
    return '''# Deployments Fersoft

Cada diretório (`develop/` e `production/`) contém somente `compose.yaml` e
`env.example`. Em uma instalação existente, mantenha o `.env` atual e os
diretórios `./volumes/*`; não copie nem execute auxiliares externos.

A full stack é selecionada pelo próprio `.env`:

```dotenv
COMPOSE_PROFILES=operations,nats,kafka,mysql,traccar
OPERATIONS_ENABLED=true
NATS_ENABLED=true
KAFKA_ENABLED=true
MYSQL_SERVICE_ENABLED=true
TRACCAR_ENABLED=true
```

Suba ou atualize diretamente pelo Dockge/Compose usando esses dois arquivos.
O bootstrap do Traccar é incorporado no `compose.yaml`; os demais comportamentos
de runtime já pertencem às imagens dos services.
'''


def generate():
    files = {Path('deploy/fersoft/README.md'): readme()}
    for channel in CHANNELS:
        folder = Path('deploy/fersoft') / channel
        files[folder / 'compose.yaml'] = '# Generated Fersoft Compose deployment. Do not edit by hand.\n' + compose_for(channel)
        files[folder / 'env.example'] = environment_for(channel)
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    changed = []
    for relative, text in generate().items():
        path = ROOT / relative
        if not path.exists() or path.read_text(encoding='utf-8') != text:
            changed.append(str(relative))
            if not args.check:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding='utf-8')
    if args.check and changed:
        raise SystemExit('Deploys Fersoft desatualizados: ' + ', '.join(changed))
    print('Deploys Fersoft sincronizados: ' + str(len(changed)))


if __name__ == '__main__':
    main()
