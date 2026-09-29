#!/usr/bin/env python3
"""Validate Compose profiles from `.env` only; never needs a helper beside a stack."""
import json
import os
import re
import shutil
import subprocess
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
files = json.loads((ROOT / 'docs/deployment/traccar-inventory.json').read_text())['apiComposeFiles']


def set_value(text, key, value):
    pattern = rf'^{re.escape(key)}=.*$'
    line = f'{key}={value}'
    return re.sub(pattern, line, text, flags=re.M) if re.search(pattern, text, flags=re.M) else text.rstrip() + '\n' + line + '\n'


with tempfile.TemporaryDirectory(prefix='connect-compose-') as tmp:
    root = Path(tmp) / 'source'
    shutil.copytree(ROOT, root, ignore=shutil.ignore_patterns('.git', 'node_modules', 'dist', 'volumes', '__pycache__'))
    for name in files:
        file = root / name
        directory = file.parent
        template = next((path for path in [directory / 'env.example', directory / '.env.example', root / '.env.example'] if path.exists()), None)
        if not template:
            raise RuntimeError('Environment template missing: ' + name)
        source = template.read_text()
        for mode in ['disabled', 'internal', 'external']:
            envtext = set_value(source, 'TRACCAR_ENABLED', 'false' if mode == 'disabled' else 'true')
            envtext = set_value(envtext, 'TRACCAR_MODE', mode)
            envtext = set_value(envtext, 'COMPOSE_PROFILES', 'traccar' if mode == 'internal' else '')
            envtext = set_value(envtext, 'TRACCAR_ADMIN_PASSWORD', 'a' * 64)
            envtext = set_value(envtext, 'TRACCAR_DATABASE_PASSWORD', 'b' * 64)
            (directory / '.env').write_text(envtext)
            env = os.environ.copy()
            env.pop('COMPOSE_PROFILES', None)
            subprocess.run(
                ['docker', 'compose', '--env-file', '.env', '-f', file.name, 'config', '--quiet'],
                cwd=directory,
                env=env,
                check=True,
                stdout=subprocess.DEVNULL,
            )
            print(name + ': ' + mode + ' valid')
