"""CI only: boot Grafana using the exact inline command shared by all three stacks.

No operator credentials, persistent application volume, scripts on VPS or extra
runtime compose are required. Docker objects created here are removed in finally.
"""
from __future__ import annotations
import base64
import json
import os
from pathlib import Path
import secrets
import subprocess
import time
from urllib.request import Request, urlopen
import yaml

ROOT = Path(__file__).resolve().parents[3]


def docker(*args, timeout=180):
    return subprocess.check_output(['docker', *args], text=True, stderr=subprocess.STDOUT, timeout=timeout).strip()


def main():
    commands = []
    for deployment in ('platform', 'platform-develop', 'platform-production'):
        services = yaml.safe_load((ROOT/'deploy'/deployment/'compose.yaml').read_text())['services']
        grafana = next(v for v in services.values() if 'grafana' in str(v.get('image', '')))
        commands.append(grafana['command'][0])
    assert len(set(commands)) == 1
    name = 'connect-grafana-ci-' + secrets.token_hex(6)
    image = 'grafana/grafana:12.1.0'
    password = secrets.token_hex(24)
    try:
        docker('pull', image)
        docker('volume', 'create', name)
        docker('run', '--rm', '--user', '0', '-v', name+':/var/lib/grafana', '--entrypoint', '/bin/sh', image,
               '-ec', 'chown -R 472:0 /var/lib/grafana')
        for cycle in range(2):
            docker('run', '-d', '--name', name, '--user', '472', '-v', name+':/var/lib/grafana',
                   '-p', '127.0.0.1::3000', '-e', 'GF_SECURITY_ADMIN_USER=ci', '-e', 'GF_SECURITY_ADMIN_PASSWORD='+password,
                   '-e', 'GF_PATHS_PROVISIONING=/tmp/grafana-provisioning', '--entrypoint', '/bin/sh', image, '-ec', commands[0])
            port = docker('inspect', '--format', '{{(index (index .NetworkSettings.Ports "3000/tcp") 0).HostPort}}', name)
            url = 'http://127.0.0.1:'+port
            authorization = 'Basic ' + base64.b64encode(('ci:'+password).encode()).decode()
            for attempt in range(60):
                try:
                    with urlopen(Request(url+'/api/dashboards/uid/connect-platform-runtime', headers={'Authorization': authorization}), timeout=3) as response:
                        data = json.load(response)
                    assert data['dashboard']['uid'] == 'connect-platform-runtime'
                    break
                except Exception:
                    if attempt == 59: raise RuntimeError('Grafana CI failed to provision/authenticate its dashboard') from None
                    time.sleep(1)
            if cycle == 0:
                docker('exec', name, '/bin/sh', '-c', 'printf preserved > /var/lib/grafana/operator-sentinel')
            else:
                assert docker('exec', name, 'cat', '/var/lib/grafana/operator-sentinel') == 'preserved'
            logs = docker('logs', name)
            assert 'Cannot read directory' not in logs
            docker('rm', '-f', name)
        print('PASS: real Grafana 12.1.0, local auth, inline provisioning, dashboard and retained volume after recreation')
    finally:
        subprocess.run(['docker', 'rm', '-f', name], capture_output=True)
        subprocess.run(['docker', 'volume', 'rm', '-f', name], capture_output=True)


if __name__ == '__main__': main()
