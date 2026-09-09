#!/usr/bin/env python3
"""Prepare only operational settings; never rotate existing application secrets."""
import argparse
import os
import re
import secrets
import stat
import sys
import tempfile
from pathlib import Path
from urllib.parse import urlsplit

DEFAULTS = {
    'OPERATIONS_ENABLED': 'true',
    'OPERATIONS_AGENT_URL': 'http://operations:8092',
    'OPERATIONS_INTERNAL_TOKEN': '',
    'ARGWS_CONNECT_OPERATIONS_DATA_PATH': './volumes/operations',
    'OPERATIONS_HOT_DAYS': '3',
    'OPERATIONS_RETENTION_DAYS': '90',
}
OWN_KEYS = set(DEFAULTS) | {'COMPOSE_PROFILES'}
ASSIGNMENT = re.compile(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$')


def values(text):
    result = {}
    for line in text.splitlines():
        match = ASSIGNMENT.match(line)
        if not match:
            continue
        key, value = match.groups()
        if key in OWN_KEYS and key in result:
            raise ValueError('Variavel operacional duplicada: ' + key)
        value = value.strip()
        if value.startswith(("'", '"')):
            quote = value[0]
            end = value.find(quote, 1)
            if end < 0 or (value[end + 1:].strip() and not value[end + 1:].strip().startswith('#')):
                if key in OWN_KEYS:
                    raise ValueError('Valor operacional invalido: ' + key)
            else:
                value = value[1:end]
        else:
            value = re.split(r'\s+#', value, maxsplit=1)[0].rstrip()
        result[key] = value
    return result


def set_value(text, key, value):
    lines = text.splitlines(keepends=True)
    for i, line in enumerate(lines):
        match = ASSIGNMENT.match(line.rstrip('\r\n'))
        if match and match.group(1) == key:
            if values(line).get(key) == value:
                return text
            lines[i] = key + '=' + value + ('\r\n' if line.endswith('\r\n') else '\n')
            return ''.join(lines)
    return text + ('' if not text or text.endswith('\n') else '\n') + key + '=' + value + '\n'


def profiles(env):
    # Shell profiles are additive, not a replacement for saved profiles.
    selected = []
    for item in (env.get('COMPOSE_PROFILES', '') + ',' + os.environ.get('COMPOSE_PROFILES', '')).split(','):
        item = item.strip()
        if not item:
            continue
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9_.-]*', item):
            raise ValueError('COMPOSE_PROFILES invalido; selecione perfis explicitamente.')
        if item not in selected:
            selected.append(item)
    if env.get('OPERATIONS_ENABLED') == 'true':
        if 'operations' not in selected:
            selected.append('operations')
    else:
        selected = [item for item in selected if item != 'operations']
    return ','.join(selected)


def validate(env, effective=False):
    if effective:
        env = {**env, **{k: os.environ[k] for k in DEFAULTS if k in os.environ}}
    missing = OWN_KEYS - set(env)
    if missing:
        raise ValueError('Faltam parametros operacionais; execute prepare-env.sh: ' + ', '.join(sorted(missing)))
    if env['OPERATIONS_ENABLED'] not in ('true', 'false'):
        raise ValueError('OPERATIONS_ENABLED deve ser true ou false.')
    for name, low, high in [('OPERATIONS_HOT_DAYS', 1, 30), ('OPERATIONS_RETENTION_DAYS', 1, 3650)]:
        value = env[name]
        if not value.isdigit() or not low <= int(value) <= high:
            raise ValueError('Valor fora do intervalo permitido: ' + name)
    if int(env['OPERATIONS_RETENTION_DAYS']) <= int(env['OPERATIONS_HOT_DAYS']):
        raise ValueError('OPERATIONS_RETENTION_DAYS deve ser maior que OPERATIONS_HOT_DAYS.')
    path = env['ARGWS_CONNECT_OPERATIONS_DATA_PATH']
    if not path or any(c in path for c in ('\x00', '\n', '\r', ':')) or path == '/' or 'docker.sock' in path:
        raise ValueError('Configure um diretorio exclusivo em ARGWS_CONNECT_OPERATIONS_DATA_PATH.')
    url = urlsplit(env['OPERATIONS_AGENT_URL'])
    if url.scheme != 'http' or not url.hostname or url.username or url.password or url.query or url.fragment or url.path not in ('', '/'):
        raise ValueError('OPERATIONS_AGENT_URL deve ser um endereco HTTP interno sem credenciais.')
    if env['OPERATIONS_ENABLED'] == 'true':
        token = env['OPERATIONS_INTERNAL_TOKEN']
        if not re.fullmatch(r'[A-Za-z0-9_+.~=/\-]{32,512}', token) or token.startswith(('CHANGE_ME', 'GERAR_')):
            raise ValueError('OPERATIONS_INTERNAL_TOKEN invalido; configure um segredo dedicado de 32+ caracteres.')
        global_key = os.environ.get('AUTHENTICATION_API_KEY', env.get('AUTHENTICATION_API_KEY', '')) if effective else env.get('AUTHENTICATION_API_KEY', '')
        if token == global_key:
            raise ValueError('OPERATIONS_INTERNAL_TOKEN nao pode reutilizar AUTHENTICATION_API_KEY.')
    profiles(env)
    return env


def prepare(text, enable=False):
    original = values(text)
    changed = text
    for key, default in DEFAULTS.items():
        if key not in original or not original[key]:
            changed = set_value(changed, key, default)
    if enable:
        changed = set_value(changed, 'OPERATIONS_ENABLED', 'true')
    current = values(changed)
    token = current['OPERATIONS_INTERNAL_TOKEN']
    if not token or token.startswith(('CHANGE_ME', 'GERAR_')):
        changed = set_value(changed, 'OPERATIONS_INTERNAL_TOKEN', secrets.token_hex(32))
    current = values(changed)
    # Shell overrides apply to the invocation, never silently to the saved file.
    shell_profiles = os.environ.pop('COMPOSE_PROFILES', None)
    try:
        changed = set_value(changed, 'COMPOSE_PROFILES', profiles(current))
    finally:
        if shell_profiles is not None:
            os.environ['COMPOSE_PROFILES'] = shell_profiles
    validate(values(changed))
    validate(values(changed), effective=True)
    return changed


def write_private(path, text):
    fd, temp = tempfile.mkstemp(prefix='.operations-env-', dir=path.parent)
    try:
        os.fchmod(fd, stat.S_IRUSR | stat.S_IWUSR)
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', default='.env')
    parser.add_argument('--template', help='Usado somente quando o destino nao existe.')
    parser.add_argument('--check', action='store_true', help='Validar sem alterar arquivos.')
    parser.add_argument('--print-profiles', action='store_true', help='Somente perfis efetivos; nunca imprime segredos.')
    parser.add_argument('--enable', action='store_true', help='Habilitar explicitamente uma instalacao que definiu false.')
    args = parser.parse_args()
    path = Path(args.env_file).absolute()
    if path.is_symlink():
        raise ValueError('O arquivo de ambiente nao pode ser um link simbolico.')
    if args.check or args.print_profiles:
        text = path.read_text(encoding='utf-8')
        env = validate(values(text), effective=True)
        if args.print_profiles:
            print(profiles(env))
        else:
            print('Configuracao operacional validada (segredos ocultos).')
        return
    lock = path.with_name(path.name + '.operations.lock')
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    try:
        os.close(fd)
        exists = path.exists()
        if exists:
            with path.open(encoding='utf-8', newline='') as stream:
                before = stream.read()
        elif args.template:
            before = Path(args.template).read_text(encoding='utf-8')
            for placeholder in sorted(set(re.findall(r'CHANGE_ME_[A-Z0-9_]+', before))):
                before = before.replace(placeholder, secrets.token_hex(48 if 'API_KEY' in placeholder else 32))
        else:
            raise ValueError('Arquivo .env inexistente; informe --template para uma nova instalacao.')
        after = prepare(before, enable=args.enable)
        if not exists or after != before:
            write_private(path, after)
        else:
            os.chmod(path, 0o600)
        print('Parametros operacionais preparados; credenciais existentes preservadas.')
    finally:
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        print('ERRO: ' + str(error), file=sys.stderr)
        sys.exit(1)
