#!/usr/bin/env python3
import importlib.util
import json
import os
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('sync_ops', ROOT / 'scripts/sync-operations-deployments.py')
sync = importlib.util.module_from_spec(spec)
spec.loader.exec_module(sync)

for relative, api, agent, network, image, full in sync.CASES:
    compose = ROOT / relative
    directory = compose.parent
    subprocess.run([sys.executable, str(directory / 'prepare-operations-env.py'), '--env-file', str(directory / '.env'), '--template', str(directory / 'env.example')], check=True, stdout=subprocess.DEVNULL)
    def model(enabled):
        env = {**os.environ, 'OPERATIONS_ENABLED': str(enabled).lower(), 'COMPOSE_PROFILES': 'operations' if enabled else ''}
        env.pop('COMPOSE_FILE', None)
        command = ['docker', 'compose', '--project-directory', str(directory), '--env-file', str(directory / '.env'), '-f', str(compose), 'config', '--format', 'json']
        return json.loads(subprocess.check_output(command, env=env, text=True))
    enabled, disabled = model(True), model(False)
    assert agent in enabled['services'] and agent not in disabled['services'], relative
    assert set(enabled['services']) == set(disabled['services']) | {agent}, relative
    cfg, app = enabled['services'][agent], enabled['services'][api]
    assert cfg['image'] == app['image'], relative
    assert not cfg.get('ports') and not cfg.get('privileged') and not cfg.get('network_mode'), relative
    assert cfg['read_only'] and 'ALL' in cfg['cap_drop'], relative
    assert 'no-new-privileges:true' in cfg['security_opt'], relative
    assert 0 < int(cfg['mem_limit']) <= 201326592 and 0 < float(cfg['cpus']) <= .5, relative
    assert cfg['pids_limit'] <= 64, relative
    assert len(cfg['volumes']) == 1 and cfg['volumes'][0]['target'] == '/data', relative
    assert 'operations' in cfg['networks'][network]['aliases'], relative
    assert agent not in app.get('depends_on', {}), relative
    assert app['environment']['OPERATIONS_AGENT_URL'] == 'http://operations:8092', relative
    assert app['environment']['OPERATIONS_ENABLED'] == 'true', relative
    assert cfg['environment']['OPERATIONS_INTERNAL_TOKEN'] == app['environment']['OPERATIONS_INTERNAL_TOKEN'], relative
    assert len(cfg['environment']['OPERATIONS_INTERNAL_TOKEN']) >= 32, relative
    assert cfg['environment']['OPERATIONS_INTERNAL_TOKEN'] != app['environment'].get('AUTHENTICATION_API_KEY'), relative
    checks = json.loads(cfg['environment']['OPERATIONS_CHECKS'])
    assert len(checks) == (6 if full else 1), relative
    for check in checks:
        from urllib.parse import urlparse
        assert urlparse(check['url']).hostname in enabled['services'], (relative, check['service'])
    print(relative + ': activation, parameters, token parity and isolation OK')
