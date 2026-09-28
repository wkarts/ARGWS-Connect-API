#!/usr/bin/env python3
"""Prepare empty bind directories for non-root auxiliary services, never existing databases."""
import json
import os
from pathlib import Path
import subprocess

COMPOSE = ['docker', 'compose', '--env-file', '.env', '-f', 'compose.yaml']
TARGETS = {'mysql-': {'/var/lib/mysql'}, 'kafka-': {'/var/lib/kafka/data'},
           'zookeeper-': {'/var/lib/zookeeper/data', '/var/lib/zookeeper/log'}}
BASE = ['docker', 'run', '--rm', '--pull', 'never', '--network', 'none', '--read-only',
        '--cap-drop', 'ALL', '--security-opt', 'no-new-privileges:true']
INIT = '''set -eu
if [ -n "$(ls -A /prepared-data)" ]; then
  echo 'Recusado: diretorio contem dados; nenhuma permissao foi alterada.' >&2
  exit 23
fi
chown --no-dereference "$1:$2" /prepared-data
chmod u+rwx /prepared-data
'''


def run(args, required=True):
    result = subprocess.run(args, capture_output=True, text=True, timeout=60)
    if required and result.returncode:
        # Never print a Compose config, container environment or arbitrary command output.
        raise ValueError('Falha ao preparar/verificar volumes. Nenhum dado deve ser removido.')
    return result


def safe_directory(value):
    path = Path(os.path.abspath(value))
    if path in [Path('/'), Path('/etc'), Path('/usr'), Path('/var'), Path('/home'), Path('/tmp')]:
        raise ValueError('Diretorio de volume amplo demais; use uma pasta dedicada.')
    for part in (path, *path.parents):
        if part.is_symlink():
            raise ValueError('Volume ou diretorio pai e link simbolico; revise o caminho antes de continuar.')
    if path.exists() and not path.is_dir():
        raise ValueError('O volume deve apontar para um diretorio.')
    return path


def identity(image, user):
    override = ['--user', user] if user else []
    output = run(BASE + override + ['--entrypoint', 'sh', image, '-c', 'id -u; id -g']).stdout.split()
    if len(output) != 2 or not all(value.isdecimal() for value in output):
        raise ValueError('Usuario da imagem nao identificado; nenhuma permissao foi alterada.')
    return tuple(output)


def writable(image, path, uid, gid):
    return run(BASE + ['--user', uid+':'+gid, '--mount', 'type=bind,src='+str(path)+',dst=/prepared-data',
                      '--entrypoint', 'sh', image, '-c', 'test -w /prepared-data && test -x /prepared-data'], False).returncode == 0


def initialize(image, path, uid, gid, active_mounts):
    if writable(image, path, uid, gid):
        return 'preservado'
    if str(path) in active_mounts:
        raise ValueError('Volume em uso sem permissao para o usuario da imagem; nada foi alterado.')
    if any(path.iterdir()):
        raise ValueError('Volume com dados e permissao incompatível. Preserve os dados e revise UID/GID antes do deploy.')
    # Elevated capability exists only in this finite, offline helper on one EMPTY mount.
    # The actual database/broker retains the image default non-root user and entrypoint.
    run(BASE + ['--user', '0:0', '--cap-add', 'CHOWN', '--cap-add', 'DAC_OVERRIDE', '--cap-add', 'FOWNER',
                '--mount', 'type=bind,src='+str(path)+',dst=/prepared-data', '--entrypoint', 'sh',
                image, '-c', INIT, 'prepare-volume', uid, gid])
    if not writable(image, path, uid, gid):
        raise ValueError('Volume continua sem permissao apos preparo; interrompido sem apagar dados.')
    return 'preparado'


def main():
    config = json.loads(run(COMPOSE + ['config', '--format', 'json']).stdout)
    selected = set(run(COMPOSE + ['config', '--services']).stdout.split())
    running = run(['docker', 'ps', '--quiet']).stdout.split()
    active_mounts = set()
    if running:
        for container in json.loads(run(['docker', 'inspect', *running]).stdout):
            active_mounts.update(m['Source'] for m in container.get('Mounts', []) if m.get('Type') == 'bind')
    identities = {}
    plan = []
    owners = {}
    for name, service in config['services'].items():
        targets = next((targets for prefix, targets in TARGETS.items() if name.startswith(prefix)), None)
        if name not in selected or targets is None:
            continue
        image = service['image']
        key = (image, str(service.get('user', '')))
        if key not in identities:
            identities[key] = identity(*key)
        uid, gid = identities[key]
        if uid == '0':
            continue  # Root-starting images prepare their own data directories in the original entrypoint.
        for mount in service.get('volumes', []):
            if mount.get('type') != 'bind' or mount.get('target') not in targets:
                continue
            path = safe_directory(mount['source'])
            if str(path) in owners and owners[str(path)] != (uid, gid):
                raise ValueError('Dois servicos exigem usuarios diferentes no mesmo volume; nada foi alterado.')
            owners[str(path)] = (uid, gid)
            plan.append((name, image, path, uid, gid))
    for name, image, path, uid, gid in plan:
        path.mkdir(parents=True, exist_ok=True)
        state = initialize(image, path, uid, gid, active_mounts)
        print(f'{name}: diretorio {state} para UID={uid} GID={gid}; sem alteracao recursiva.')


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        raise SystemExit('ERRO: ' + str(error))
