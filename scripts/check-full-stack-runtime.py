#!/usr/bin/env python3
"""Wait for every selected local service; read-only, bounded and secret-safe."""
import argparse
import json
import re
import subprocess
import time
from pathlib import Path

COMPOSE = ['docker', 'compose', '--env-file', '.env', '-f', 'compose.yaml']


def command(args, timeout=15):
    result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    if result.returncode:
        raise RuntimeError('Comando de verificacao falhou: ' + args[0])
    return result.stdout


def assess(containers, expected):
    states = {}
    for item in containers:
        service = item.get('Config', {}).get('Labels', {}).get('com.docker.compose.service', '')
        state = item.get('State', {})
        status = state.get('Status', 'unknown')
        health = state.get('Health', {}).get('Status', 'not-configured')
        oneshot = service.startswith('traccar-bootstrap-')
        ready = (status == 'exited' and state.get('ExitCode') == 0) if oneshot else (
            status == 'running' and state.get('Running') and not state.get('Restarting')
            and health in ('healthy', 'not-configured'))
        states[service] = {'status': status, 'health': health, 'exitCode': state.get('ExitCode'),
                           'restarts': item.get('RestartCount', 0), 'oomKilled': bool(state.get('OOMKilled')),
                           'ready': bool(ready)}
    for name in expected:
        states.setdefault(name, {'status': 'missing', 'ready': False})
    return set(states) == set(expected) and all(s['ready'] for s in states.values()), states


def redactor(env_text):
    values = []
    for line in env_text.splitlines():
        match = re.match(r'^\s*(?:export\s+)?([A-Z][A-Z0-9_]*)\s*=(.*)$', line)
        if match and re.search(r'PASSWORD|SECRET|TOKEN|KEY|CONNECTION_URI|REDIS_URI|RABBITMQ_URI', match[1]):
            value = match[2].strip().strip('\"\'')
            if value:
                values.append(value)
    def clean(text):
        for value in sorted(set(values), key=len, reverse=True):
            text = text.replace(value, '[REDACTED]')
        text = re.sub(r'(\w+://)[^\s/@:]+:[^\s/@]+@', r'\1[REDACTED]@', text)
        text = re.sub(r'(?i)((?:password|token|secret|api[_-]?key)\s*[=:]\s*)[^\s,;]+', r'\1[REDACTED]', text)
        # Do not allow output from a failed service to inject Actions workflow commands.
        return '\n'.join('  ' + line if line.startswith('::') else line for line in text.splitlines())
    return clean


def diagnose(expected, states, output):
    clean = redactor(Path('.env').read_text())
    report = {'services': states, 'logs': {}}
    for name in expected:
        try:
            report['logs'][name] = clean(command(COMPOSE + ['logs', '--no-color', '--tail', '60', name])[-24000:])
        except (RuntimeError, subprocess.TimeoutExpired):
            report['logs'][name] = 'Log indisponivel; valores de configuracao nao foram exportados.'
    Path(output).write_text(json.dumps(report, indent=2, ensure_ascii=False))
    for name, log in report['logs'].items():
        if not states.get(name, {}).get('ready', False):
            print(name + '\n' + log, flush=True)


def probe(expected, port, deadline):
    checks = [['curl', '--fail', '--silent', '--show-error', '--max-time', '3', f'http://127.0.0.1:{port}/health']]
    for name in expected:
        if name.startswith('mysql-'):
            checks.append(['docker', 'exec', name, 'sh', '-c',
                'MYSQL_PWD="$MYSQL_PASSWORD" mysql --connect-timeout=3 --protocol=TCP -h127.0.0.1 -u"$MYSQL_USER" --database="$MYSQL_DATABASE" -Nse "SELECT 1"'])
        elif name.startswith('nats-'):
            checks.append(['docker', 'exec', name, 'wget', '-q', '-T', '3', '-O', '/dev/null', 'http://127.0.0.1:8222/healthz'])
        elif name.startswith('kafka-'):
            checks.append(['docker', 'exec', name, 'kafka-topics', '--bootstrap-server', 'localhost:9092', '--list'])
    for check in checks:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        try:
            command(check, min(15, remaining))
        except (RuntimeError, subprocess.TimeoutExpired):
            return False
    return True


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--timeout', type=int, default=300)
    parser.add_argument('--expected', type=int)
    parser.add_argument('--port', type=int, default=38082)
    parser.add_argument('--report', default='full-stack-diagnostics.json')
    args = parser.parse_args()
    if not 1 <= args.timeout <= 3600 or not 1 <= args.port <= 65535:
        parser.error('Timeout ou porta fora do intervalo permitido.')
    expected = command(COMPOSE + ['config', '--services']).split()
    if args.expected is not None and len(expected) != args.expected:
        raise SystemExit(f'Esperados {args.expected} servicos selecionados, encontrados {len(expected)}.')
    deadline = time.monotonic() + args.timeout
    previous = None
    stable = 0
    states = {}
    while time.monotonic() < deadline:
        ids = command(COMPOSE + ['ps', '--all', '--quiet']).split()
        ready, states = assess(json.loads(command(['docker', 'inspect', *ids])) if ids else [], expected)
        summary = json.dumps(states, sort_keys=True)
        if summary != previous:
            print(summary, flush=True)
            previous = summary
        if any(s.get('oomKilled') or s.get('restarts', 0) >= 3 for s in states.values()):
            break
        stable = stable + 1 if ready else 0
        if stable >= 2 and probe(expected, args.port, deadline):
            Path(args.report).write_text(json.dumps({'services': states, 'probes': 'passed'}, indent=2))
            print(f'{len(expected)} servicos validados; bootstrap concluido e probes autenticados aprovados.')
            return
        time.sleep(min(3, max(0, deadline - time.monotonic())))
    diagnose(expected, states, args.report)
    raise SystemExit('Full stack nao ficou pronta dentro do prazo; consulte o diagnostico sanitizado.')


if __name__ == '__main__':
    main()
