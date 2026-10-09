#!/usr/bin/env python3
"""Read-only inspection of one explicitly selected live RabbitMQ container.

Never pulls images, restarts a broker, reads credentials, rewrites Compose or
changes queues. The TCP check opens and immediately closes ONE local socket.
"""
import argparse
import json
import subprocess
from pathlib import Path

PROBE = ['timeout', '2', 'bash', '-ec', 'exec 3<>/dev/tcp/127.0.0.1/5672']


def docker(*args):
    return subprocess.run(['docker', *args], capture_output=True, text=True, timeout=15)


def checked(*args):
    result = docker(*args)
    if result.returncode:
        raise RuntimeError('Docker inspection failed; no changes were made.')
    return json.loads(result.stdout)[0]


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--container', required=True)
    parser.add_argument('--rendered-compose', type=Path, help='Optional private output of docker compose config --format json; never printed.')
    args = parser.parse_args()
    runtime = checked('inspect', '--type', 'container', args.container)
    image = checked('image', 'inspect', runtime['Image'])
    labels = runtime.get('Config', {}).get('Labels') or {}
    service = labels.get('com.docker.compose.service')
    report = {
        'container': runtime['Name'].lstrip('/'),
        'imageReference': runtime['Config']['Image'],
        'imageId': runtime['Image'],
        'hostname': runtime['Config'].get('Hostname'),
        'domainname': runtime['Config'].get('Domainname'),
        'dataMounts': [{k:m.get(k) for k in ('Type','Name','Source','Destination','RW')} for m in runtime.get('Mounts',[]) if m.get('Destination')=='/var/lib/rabbitmq'],
        'repoDigests': image.get('RepoDigests', []),
        'architecture': image.get('Architecture'),
        'composeProject': labels.get('com.docker.compose.project'),
        'composeService': service,
        'composeFiles': labels.get('com.docker.compose.project.config_files'),
        'composeWorkingDirectory': labels.get('com.docker.compose.project.working_dir'),
        'effectiveHealthcheck': runtime['Config'].get('Healthcheck'),
        'health': runtime.get('State', {}).get('Health', {}).get('Status'),
        'running': runtime.get('State', {}).get('Running', False),
        'scope': 'read_only_metadata_and_one_local_tcp_probe',
    }
    ready = False
    if report['running']:
        capabilities = docker('exec', runtime['Id'], 'sh', '-ec',
                              'command -v bash >/dev/null && command -v timeout >/dev/null && timeout 2 bash -ec "exit 0"')
        report['bashAndTimeoutAvailable'] = capabilities.returncode == 0
        if report['bashAndTimeoutAvailable']:
            ready = docker('exec', runtime['Id'], *PROBE).returncode == 0
        report['localAmqpPortOpen'] = ready
    if args.rendered_compose:
        config = json.loads(args.rendered_compose.read_text())
        wanted = config.get('services', {}).get(service)
        if not isinstance(wanted, dict):
            raise RuntimeError('Rendered Compose does not contain the selected service; no changes were made.')
        report['renderedImage'] = wanted.get('image')
        report['renderedHealthcheck'] = wanted.get('healthcheck')
        report['probeCommandMatchesRendered'] = (runtime['Config'].get('Healthcheck') or {}).get('Test') == (wanted.get('healthcheck') or {}).get('test')
    report['eligibleForBoundedTcpProbe'] = ready
    report['warning'] = 'TCP readiness is not proof of authentication, publication, consumer ACKs or absence of broker alarms.'
    print(json.dumps(report, indent=2, ensure_ascii=False))
    return 0 if ready else 2


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except (RuntimeError, ValueError, KeyError, OSError, subprocess.TimeoutExpired) as error:
        print(json.dumps({'error': type(error).__name__, 'message': 'Read-only audit could not complete; preserve the installed configuration.'}))
        raise SystemExit(2)
