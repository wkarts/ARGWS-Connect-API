#!/usr/bin/env python3
"""Prepare an alternative full stack without rotating existing credentials or moving data."""
import argparse
import importlib.util
import os
import re
import secrets
import sys
from pathlib import Path

LINE = re.compile(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$')
FLAGS = ('OPERATIONS_ENABLED', 'NATS_ENABLED', 'KAFKA_ENABLED', 'MYSQL_SERVICE_ENABLED')
SECRET_KEYS = ('AUTHENTICATION_API_KEY', 'POSTGRES_PASSWORD', 'REDIS_PASSWORD', 'RABBITMQ_DEFAULT_PASS',
               'MINIO_ROOT_PASSWORD', 'MYSQL_PASSWORD', 'MYSQL_ROOT_PASSWORD', 'METRICS_PASSWORD',
               'WA_BUSINESS_TOKEN_WEBHOOK', 'OPERATIONS_INTERNAL_TOKEN', 'FINDHUB_CREDENTIALS_KEY',
               'TRACCAR_ADMIN_PASSWORD', 'TRACCAR_DATABASE_PASSWORD')

def helper(name):
    path = Path(__file__).with_name(name + '.py')
    spec = importlib.util.spec_from_file_location(name.replace('-', '_'), path)
    module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
    return module

ops = helper('prepare-operations-env')
findhub = helper('prepare-findhub-env')
traccar = helper('prepare-traccar-env')

def parse(text):
    seen = set()
    for line in text.splitlines():
        match = LINE.match(line)
        if match:
            if match[1] in seen: raise ValueError('Variavel duplicada: ' + match[1])
            seen.add(match[1])
    return ops.values(text)

def quoted(value):
    if '\n' in value or '\r' in value or "'" in value: raise ValueError('Caminho de volume invalido.')
    return "'" + value + "'"

def build(text, template, initial=False, source=None, target=None):
    original = parse(text)
    for line in template.splitlines():
        match = LINE.match(line)
        if match and match[1] not in original:
            text += ('\n' if text and not text.endswith('\n') else '') + line + '\n'
    # Resolve imported relative mounts against their ORIGINAL .env, not the new subdirectory.
    if source and target and source.parent != target.parent:
        for key, value in original.items():
            if key.startswith('ARGWS_CONNECT_') and key.endswith(('_DATA_PATH', '_LOG_PATH', '_DB_PATH')) and value:
                if '${' in value: raise ValueError('Expanda manualmente o caminho antes da importacao: ' + key)
                path = Path(value)
                if not path.is_absolute():
                    path = (source.parent / path).resolve()
                    text = ops.set_value(text, key, quoted(os.path.relpath(path, target.parent)))
    if initial:
        for key in FLAGS: text = ops.set_value(text, key, 'true')
        text = ops.set_value(text, 'TRACCAR_ENABLED', 'true')
        text = ops.set_value(text, 'TRACCAR_MODE', 'external' if original.get('TRACCAR_MODE') == 'external' else 'internal')
        text = ops.set_value(text, 'KAFKA_AUTO_CREATE_TOPICS', 'true')
    env = parse(text)
    # Placeholder replacement is consistent across passwords and their connection URIs.
    aliases = {'API_KEY': 'AUTHENTICATION_API_KEY', 'S3_SECRET_KEY': 'MINIO_ROOT_PASSWORD'}
    for placeholder in sorted(set(re.findall(r'CHANGE_ME_[A-Z0-9_]+', text))):
        name = aliases.get(placeholder[10:], placeholder[10:])
        value = env.get(name, '')
        if not value or value.startswith('CHANGE_ME_'): value = secrets.token_hex(32)
        text = text.replace(placeholder, value)
    env = parse(text)
    for key in SECRET_KEYS:
        if not env.get(key): text = ops.set_value(text, key, secrets.token_hex(32))
    env = parse(text)
    # A Connect API key is not a Traccar bearer token. Internal bootstrap supports Basic authentication.
    if env.get('TRACCAR_MODE') == 'internal' and env.get('TRACCAR_TOKEN') == env.get('AUTHENTICATION_API_KEY'):
        text = ops.set_value(text, 'TRACCAR_TOKEN', '')
    text = ops.prepare(text)
    text = findhub.prepare(text)
    text = traccar.prepare(text)
    env = parse(text)
    profiles = [name for key, name in [('OPERATIONS_ENABLED', 'operations'), ('NATS_ENABLED', 'nats'),
                ('KAFKA_ENABLED', 'kafka'), ('MYSQL_SERVICE_ENABLED', 'mysql')] if env.get(key) == 'true']
    if env.get('TRACCAR_ENABLED') == 'true' and env.get('TRACCAR_MODE') == 'internal': profiles.append('traccar')
    text = ops.set_value(text, 'COMPOSE_PROFILES', ','.join(profiles))
    validate(text)
    for key in SECRET_KEYS:
        if original.get(key) and not original[key].startswith('CHANGE_ME_') and parse(text).get(key) != original[key]:
            raise ValueError('A preparacao recusou alterar credencial existente: ' + key)
    return text

def validate(text):
    env = parse(text)
    for key in FLAGS + ('TRACCAR_ENABLED',):
        if env.get(key) not in ('true', 'false'): raise ValueError(key + ' deve ser true ou false.')
    if env.get('TRACCAR_MODE') not in ('internal', 'external', 'disabled'): raise ValueError('TRACCAR_MODE invalido.')
    expected_profiles = [name for key, name in [('OPERATIONS_ENABLED', 'operations'), ('NATS_ENABLED', 'nats'), ('KAFKA_ENABLED', 'kafka'), ('MYSQL_SERVICE_ENABLED', 'mysql')] if env.get(key) == 'true']
    if env.get('TRACCAR_ENABLED') == 'true' and env.get('TRACCAR_MODE') == 'internal': expected_profiles.append('traccar')
    if env.get('COMPOSE_PROFILES', '') != ','.join(expected_profiles):
        raise ValueError('Profiles divergentes das flags. Execute prepare-env.sh antes do deploy.')
    ops.validate(env)
    findhub.validate(findhub.values(text), require_key=True)
    traccar.validate(env)
    if env.get('DATABASE_PROVIDER') != 'postgresql': raise ValueError('Este perfil usa PostgreSQL como banco principal; MySQL e auxiliar.')
    for key in SECRET_KEYS:
        if not env.get(key) or env[key].startswith('CHANGE_ME_'): raise ValueError('Credencial nao preparada: ' + key)
    if env.get('SQS_GLOBAL_ENABLED') == 'true' and not all(env.get(k) for k in ('SQS_ACCESS_KEY_ID', 'SQS_SECRET_ACCESS_KEY', 'SQS_ACCOUNT_ID', 'SQS_REGION')):
        raise ValueError('SQS global precisa de credenciais AWS; nao e um servico local desta stack.')
    if env.get('PUSHER_GLOBAL_ENABLED') == 'true' and not all(env.get(k) for k in ('PUSHER_GLOBAL_APP_ID', 'PUSHER_GLOBAL_KEY', 'PUSHER_GLOBAL_SECRET', 'PUSHER_GLOBAL_CLUSTER')):
        raise ValueError('Pusher global precisa das credenciais da integracao externa.')
    return env

def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', default='.env'); parser.add_argument('--template', default='env.example')
    parser.add_argument('--from-env'); parser.add_argument('--check', action='store_true')
    parser.add_argument('--all-services', action='store_true', help='Habilita explicitamente os servicos locais opcionais.')
    args = parser.parse_args(); path = Path(args.env_file).absolute()
    if path.is_symlink(): raise ValueError('O destino nao pode ser um link simbolico.')
    if args.check:
        env = validate(path.read_text(encoding='utf-8')); print('Validado. Profiles: ' + env['COMPOSE_PROFILES']); return
    if args.from_env and path.exists(): raise ValueError('Destino ja existe. Nao foi sobrescrito; revise o .env existente.')
    source = Path(args.from_env).resolve() if args.from_env else None
    if not path.exists() and not source and path.parent.parent.joinpath('.env').exists():
        raise ValueError('Existe .env no deploy anterior. Importe com --from-env ../.env para preservar credenciais.')
    if not path.exists() and not source:
        volumes = path.parent.parent / 'volumes'
        if volumes.exists() and any(volumes.iterdir()): raise ValueError('Dados anteriores encontrados. Importe o .env correspondente; nao gere credenciais novas.')
    lock = path.with_name(path.name + '.full-stack.lock')
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600); os.close(fd)
    try:
        before = path.read_text(encoding='utf-8') if path.exists() else None
        template = Path(args.template).read_text(encoding='utf-8')
        text = before if before is not None else source.read_text(encoding='utf-8') if source else template
        result = build(text, template, before is None or args.all_services, source, path)
        if before is not None and path.read_text(encoding='utf-8') != before: raise ValueError('Ambiente alterado simultaneamente; repita a preparacao.')
        if before != result: ops.write_private(path, result)
        else: os.chmod(path, 0o600)
    finally: lock.unlink(missing_ok=True)
    print('Full stack preparada. Credenciais ocultas; arquivos e chaves existentes preservados.')

if __name__ == '__main__':
    try: main()
    except (ValueError, OSError) as error: raise SystemExit('ERRO: ' + str(error))
