#!/usr/bin/env python3
"""Prepare Find Hub settings without rotating existing credentials or changing other settings."""
import argparse
import base64
import binascii
import os
import re
import secrets
import stat
import sys
import tempfile
from pathlib import Path

DEFAULTS = {
    'FINDHUB_CREDENTIALS_KEY': '',
    'FINDHUB_DEFAULT_TRACKING_INTERVAL_SECONDS': '60',
    'FINDHUB_MIN_TRACKING_INTERVAL_SECONDS': '30',
    'FINDHUB_LOCATION_TIMEOUT_MS': '30000',
    'FINDHUB_STORE_POSITION_HISTORY': 'false',
    'FINDHUB_TRACCAR_TIMEOUT_MS': '10000',
}
KEY = 'FINDHUB_CREDENTIALS_KEY'
ASSIGNMENT = re.compile(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=(.*)$')


def values(text):
    result = {}
    for line in text.splitlines():
        match = ASSIGNMENT.match(line)
        if not match or match.group(1) not in DEFAULTS:
            continue
        name, value = match.groups()
        if name in result:
            raise ValueError('Variavel Find Hub duplicada: ' + name)
        value = value.strip()
        if value.startswith(("'", '"')):
            quote = value[0]
            end = value.find(quote, 1)
            if end < 0 or (value[end + 1:].strip() and not value[end + 1:].strip().startswith('#')):
                raise ValueError('Valor Find Hub invalido: ' + name)
            value = value[1:end]
        else:
            value = re.split(r'\s+#', value, maxsplit=1)[0].rstrip()
        result[name] = value
    return result


def decode_key(value):
    if re.fullmatch(r'[0-9a-fA-F]{64}', value):
        return bytes.fromhex(value)
    try:
        normalized = value.replace('-', '+').replace('_', '/')
        if not re.fullmatch(r'[A-Za-z0-9+/]{43}=?', normalized):
            raise ValueError('Invalid base64 key')
        decoded = base64.b64decode(normalized.rstrip('=') + '=', validate=True)
        if len(decoded) == 32 and base64.b64encode(decoded).decode('ascii').rstrip('=') == normalized.rstrip('='):
            return decoded
    except (ValueError, binascii.Error):
        pass
    raise ValueError(KEY + ' deve conter 32 bytes: 64 caracteres hex ou base64 canonico. O valor foi ocultado.')


def validate(env, require_key=False):
    raw = env.get(KEY, '')
    if raw:
        decode_key(raw)
    elif require_key:
        raise ValueError(KEY + ' ausente. Execute prepare-findhub-env.py antes de usar o canal.')
    ranges = {
        'FINDHUB_DEFAULT_TRACKING_INTERVAL_SECONDS': (0, 86400),
        'FINDHUB_MIN_TRACKING_INTERVAL_SECONDS': (0, 86400),
        'FINDHUB_LOCATION_TIMEOUT_MS': (1, 2147483647),
        'FINDHUB_TRACCAR_TIMEOUT_MS': (1000, 300000),
    }
    for name, (low, high) in ranges.items():
        value = env.get(name) or DEFAULTS[name]
        if not value.isdigit() or not low <= int(value) <= high:
            raise ValueError(name + ' fora do intervalo permitido: ' + str(low) + '..' + str(high))
    history = env.get('FINDHUB_STORE_POSITION_HISTORY') or 'false'
    if history.lower() not in ('true', 'false'):
        raise ValueError('FINDHUB_STORE_POSITION_HISTORY deve ser true ou false.')


def set_value(text, name, value):
    lines = text.splitlines(keepends=True)
    newline = '\r\n' if '\r\n' in text else '\n'
    for index, line in enumerate(lines):
        match = ASSIGNMENT.match(line.rstrip('\r\n'))
        if match and match.group(1) == name:
            if values(line).get(name) == value:
                return text
            lines[index] = name + '=' + value + newline
            return ''.join(lines)
    return text + ('' if not text or text.endswith('\n') else newline) + name + '=' + value + newline


def effective(env):
    return {**env, **{name: os.environ[name].strip() for name in DEFAULTS if name in os.environ}}


def prepare(text):
    current = values(text)
    raw = current.get(KEY, '')
    # A nonempty invalid key is never silently replaced: existing encrypted data may depend on it.
    if raw and not raw.startswith(('CHANGE_ME_', 'GERAR_')):
        decode_key(raw)
    result = text
    for name, default in DEFAULTS.items():
        if name not in current or not current[name]:
            result = set_value(result, name, default)
    if not raw or raw.startswith(('CHANGE_ME_', 'GERAR_')):
        # Preserve an explicitly supplied shell key instead of generating a conflicting saved key.
        supplied = os.environ.get(KEY, '').strip()
        if supplied:
            decode_key(supplied)
        result = set_value(result, KEY, supplied or secrets.token_hex(32))
    final = values(result)
    validate(final, require_key=True)
    validate(effective(final), require_key=True)
    shell_key = os.environ.get(KEY, '').strip()
    if shell_key and decode_key(shell_key) != decode_key(final[KEY]):
        raise ValueError(KEY + ' do shell difere do .env. Remova o override; a chave salva nao foi alterada.')
    return result


def write_private(path, text):
    fd, temporary = tempfile.mkstemp(prefix='.findhub-env-', dir=path.parent)
    try:
        os.fchmod(fd, stat.S_IRUSR | stat.S_IWUSR)
        with os.fdopen(fd, 'w', encoding='utf-8', newline='') as stream:
            stream.write(text)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temporary, path)
    finally:
        if os.path.exists(temporary):
            os.unlink(temporary)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--env-file', default='.env')
    parser.add_argument('--template', help='Usado somente se o destino nao existir.')
    parser.add_argument('--check', action='store_true', help='Somente validar. Ausencia de chave nao bloqueia WhatsApp.')
    parser.add_argument('--require-key', action='store_true', help='No check, exigir configuracao do Find Hub.')
    # Compatibility with prepare-env.sh arguments used by the existing operations preparer.
    parser.add_argument('--print-profiles', action='store_true', help=argparse.SUPPRESS)
    parser.add_argument('--enable', action='store_true', help=argparse.SUPPRESS)
    args = parser.parse_args()
    path = Path(args.env_file).absolute()
    if path.is_symlink():
        raise ValueError('O .env nao pode ser um link simbolico.')
    if args.check or args.print_profiles:
        env = effective(values(path.read_text(encoding='utf-8')))
        validate(env, require_key=args.require_key)
        if not args.print_profiles:
            if env.get(KEY):
                print('Find Hub: configuracao validada; segredos ocultos.')
            else:
                print('AVISO: Find Hub sem chave. Execute prepare-findhub-env.py para habilitar o canal; WhatsApp nao foi bloqueado.', file=sys.stderr)
        return
    lock = path.with_name(path.name + '.findhub.lock')
    fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    os.close(fd)
    try:
        exists = path.exists()
        if exists:
            with path.open(encoding='utf-8', newline='') as stream:
                before = stream.read()
        elif args.template:
            before = Path(args.template).read_text(encoding='utf-8')
        else:
            raise ValueError('.env inexistente; prepare o ambiente ou informe --template.')
        after = prepare(before)
        if not exists or after != before:
            write_private(path, after)
        else:
            os.chmod(path, 0o600)
        print('Find Hub preparado; chave existente preservada, historico opt-in e segredos ocultos.')
    finally:
        lock.unlink(missing_ok=True)


if __name__ == '__main__':
    try:
        main()
    except (OSError, ValueError) as error:
        print('ERRO: ' + str(error), file=sys.stderr)
        sys.exit(1)
