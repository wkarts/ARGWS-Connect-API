#!/usr/bin/env python3
"""Bounded, project-scoped startup diagnosis; speech containment is opt-in."""

import argparse
import datetime as dt
import json
import os
from pathlib import Path
import re
import selectors
import signal
import subprocess
import sys
import time


PROJECT_LABEL = 'com.docker.compose.project'
SERVICE_LABEL = 'com.docker.compose.service'
LABELS = (PROJECT_LABEL, SERVICE_LABEL, 'com.docker.compose.oneoff',
          'com.docker.compose.project.working_dir', 'com.docker.compose.project.config_files',
          'org.opencontainers.image.revision')
BOOLEAN_ENV = {
    'SPEECH_ENABLED', 'TRANSCRIPTION_ENABLED', 'DICTATION_ENABLED', 'SPEECH_SYNC_MODEL_CACHE',
    'MANAGER_FEATURE_TRANSCRIPTION', 'RABBITMQ_ENABLED', 'NATS_ENABLED', 'KAFKA_ENABLED',
    'TRACCAR_ENABLED', 'OPERATIONS_ENABLED', 'MYSQL_SERVICE_ENABLED', 'RABBITMQ_USE_LONGNAME',
}
VALUE_ENV = {
    'SPEECH_WORKER_MODE', 'SPEECH_ENGINE', 'SPEECH_PROVIDER', 'TRANSCRIPTION_PROVIDER',
    'SPEECH_MODEL', 'TRANSCRIPTION_LOCAL_MODEL', 'SPEECH_DEVICE', 'TRANSCRIPTION_LOCAL_DEVICE',
    'SPEECH_DTYPE', 'TRANSCRIPTION_LOCAL_DTYPE', 'SPEECH_MODEL_REVISION',
}
NUMBER_ENV = {
    'SPEECH_GLOBAL_CONCURRENCY', 'SPEECH_WORKER_CONCURRENCY', 'TRANSCRIPTION_WORKER_CONCURRENCY',
    'SPEECH_INFERENCE_THREADS', 'SPEECH_INFERENCE_INTER_THREADS', 'SPEECH_MODEL_IDLE_TTL_SECONDS',
    'SPEECH_CHUNK_SECONDS', 'SPEECH_MODEL_WARMUP_TIMEOUT_SECONDS', 'SPEECH_POOL_PREFETCH',
}
ENV_KEYS = BOOLEAN_ENV | VALUE_ENV | NUMBER_ENV | {'SPEECH_CONFIG', 'RABBITMQ_NODENAME'}
CONFIG_KEYS = {
    'enabled': 'SPEECH_ENABLED', 'mode': 'SPEECH_WORKER_MODE', 'engine': 'SPEECH_ENGINE',
    'provider': 'SPEECH_PROVIDER', 'model': 'SPEECH_MODEL', 'device': 'SPEECH_DEVICE',
    'dtype': 'SPEECH_DTYPE', 'concurrency': 'SPEECH_WORKER_CONCURRENCY',
    'globalConcurrency': 'SPEECH_GLOBAL_CONCURRENCY', 'inferenceThreads': 'SPEECH_INFERENCE_THREADS',
    'inferenceInterThreads': 'SPEECH_INFERENCE_INTER_THREADS',
    'modelIdleTtlSeconds': 'SPEECH_MODEL_IDLE_TTL_SECONDS',
}
CONTAINER_ID = re.compile(r'^[a-f0-9]{64}$')
IMAGE_ID = re.compile(r'^sha256:[a-f0-9]{64}$')
WORKER_SERVICE = re.compile(r'^(?:(?:transcription|dictation|speech)-worker|speech-(?:dictation|transcription)-worker)(?:-[a-z0-9_.-]+)?$')
WORKER_IMAGE = re.compile(r'(?:^|/)(?:argws-connect-|connect-)?(?:(?:transcription|dictation|speech)-worker|speech-(?:dictation|transcription)-worker)(?::|@|$)')
MAX_CONTAINERS = 64


def sanitize(value, limit=4096):
    """Never publish credentials or complete URIs from diagnostic text."""
    text = str(value or '')[:limit].replace('\\/', '/')
    text = re.sub(r'\x1b\[[0-?]*[ -/]*[@-~]', '', text)
    text = re.sub(r'[a-z][a-z0-9+.-]*://[^\s<>\x00-\x20]+', '[URI omitida]', text, flags=re.I)
    text = re.sub(r'\b(?:Bearer|Basic)\s+[^\s,;]+', '[autorização omitida]', text, flags=re.I)
    sensitive = re.compile(
        r'\b(?:[\w.-]*(?:password|passwd|token|secret|cookie|credential|api[_-]?key|access[_-]?key|uri|url|connection[_-]?string)'
        r'|authorization|pwd)\b[\s\"\']*[:=]', re.I)
    text = '\n'.join('[linha omitida: possível credencial]' if sensitive.search(line) else line
                     for line in text.splitlines())
    return ''.join(c for c in text if c in '\n\t' or ord(c) >= 32)


class Runner:
    """Drain a pipe within fixed byte/time budgets, without shell expansion."""

    def __init__(self, timeout=8, budget=120):
        self.timeout = timeout
        self.deadline = time.monotonic() + budget

    def run(self, args, timeout=None, cap=131072):
        started = time.monotonic()
        remaining = min(timeout or self.timeout, self.deadline - started)
        result = {'ok': False, 'returncode': None, 'timed_out': False, 'truncated': False}
        if remaining <= 0:
            return dict(result, timed_out=True, output='', error='orçamento total esgotado')
        try:
            proc = subprocess.Popen(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                                    stderr=subprocess.STDOUT, start_new_session=True)
        except OSError as error:
            return dict(result, output='', error='comando indisponível: ' + type(error).__name__)
        data = bytearray()
        try:
            with selectors.DefaultSelector() as selector:
                selector.register(proc.stdout, selectors.EVENT_READ)
                while selector.get_map():
                    left = started + remaining - time.monotonic()
                    if left <= 0:
                        result['timed_out'] = True
                        break
                    for key, _ in selector.select(min(left, 0.2)):
                        block = os.read(key.fd, min(8192, cap + 1 - len(data)))
                        if not block:
                            selector.unregister(key.fileobj)
                        else:
                            data.extend(block)
                    if len(data) > cap:
                        result['truncated'] = True
                        break
                if not result['timed_out'] and not result['truncated']:
                    try:
                        proc.wait(timeout=max(0.01, started + remaining - time.monotonic()))
                    except subprocess.TimeoutExpired:
                        result['timed_out'] = True
        finally:
            if proc.poll() is None:
                # This group contains only the diagnostic CLI, never the Docker daemon.
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            proc.wait()
            proc.stdout.close()
        result.update(returncode=proc.returncode, output=bytes(data[:cap]).decode('utf-8', 'replace'),
                      elapsed_seconds=round(time.monotonic() - started, 3))
        result['ok'] = proc.returncode == 0 and not result['timed_out'] and not result['truncated']
        return result


def status(result):
    # Raw output from failed commands is intentionally not included.
    return {key: result[key] for key in ('ok', 'returncode', 'timed_out', 'truncated', 'error', 'elapsed_seconds')
            if key in result}


def env_value(key, value):
    text = str(value).strip()
    if key in BOOLEAN_ENV:
        lowered = text.lower()
        return lowered in ('true', '1', 'yes', 'on') if lowered in ('true', '1', 'yes', 'on', 'false', '0', 'no', 'off') else '[valor inválido omitido]'
    if key in NUMBER_ENV:
        return int(text) if re.fullmatch(r'\d{1,10}', text) else '[valor inválido omitido]'
    if key in VALUE_ENV:
        return text if re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._/-]{0,179}', text) else '[valor inválido omitido]'
    if key == 'RABBITMQ_NODENAME':
        return text if not text or re.fullmatch(r'[a-zA-Z0-9_.-]{1,100}@[a-zA-Z0-9_.-]{1,253}', text) else '[valor inválido omitido]'
    return None


def config_projection(value):
    try:
        parsed = json.loads(value[:16384]) if isinstance(value, str) else value
    except (ValueError, TypeError):
        return {'status': 'formato não reconhecido; conteúdo omitido'}
    if not isinstance(parsed, dict):
        return {'status': 'formato não reconhecido; conteúdo omitido'}
    selected = {key: env_value(CONFIG_KEYS[key], val) for key, val in parsed.items() if key in CONFIG_KEYS}
    if isinstance(parsed.get('local'), dict):
        selected['local'] = {key: env_value(CONFIG_KEYS[key], val)
                             for key, val in parsed['local'].items() if key in ('model', 'device', 'dtype')}
    return selected


def selected_environment(values):
    selected = {}
    for item in values or []:
        key, sep, value = str(item).partition('=')
        if sep and key in ENV_KEYS:
            selected[key] = config_projection(value) if key == 'SPEECH_CONFIG' else env_value(key, value)
    return selected


def inspect_format():
    # Docker projects only these fields. The complete environment, command, health
    # command, network configuration and arbitrary labels never leave the daemon.
    fields = {'Id': '.Id', 'Image': '.Image', 'ImageReference': '.Config.Image',
              'Hostname': '.Config.Hostname', 'State': '.State', 'RestartCount': '.RestartCount'}
    pieces = [json.dumps(key) + ':{{json ' + value + '}}' for key, value in fields.items()]
    labels = [json.dumps(key) + ':{{json (index .Config.Labels ' + json.dumps(key) + ')}}' for key in LABELS]
    pieces.append('"Labels":{' + ','.join(labels) + '}')
    allowed = ' '.join('(eq $key ' + json.dumps(key) + ')' for key in sorted(ENV_KEYS))
    pieces.append('"Env":[""{{range .Config.Env}}{{$key := index (split . "=") 0}}{{if or '
                  + allowed + '}},{{json .}}{{end}}{{end}}]')
    quota = ('Memory', 'MemoryReservation', 'MemorySwap', 'MemorySwappiness', 'NanoCpus', 'CpuQuota',
             'CpuPeriod', 'CpuShares', 'CpusetCpus', 'PidsLimit', 'CgroupParent', 'RestartPolicy')
    pieces.append('"Quotas":{' + ','.join(json.dumps(key) + ':{{json .HostConfig.' + key + '}}' for key in quota) + '}')
    pieces.append('"RabbitMounts":[{}{{range .Mounts}}{{if or (eq .Destination "/var/lib/rabbitmq") '
                  '(eq .Destination "/var/lib/rabbitmq/mnesia")}},{{json .}}{{end}}{{end}}]')
    return '{' + ','.join(pieces) + '}'


def role(service):
    if WORKER_SERVICE.fullmatch(service):
        return 'speech'
    if re.fullmatch(r'rabbitmq(?:-[a-z0-9_.-]+)?', service):
        return 'rabbitmq'
    if re.fullmatch(r'api(?:-[a-z0-9_.-]+)?', service):
        return 'api'
    return 'other'


def inspect_container(runner, identifier, project):
    result = runner.run(['docker', 'inspect', '--type', 'container', '--format', inspect_format(), identifier])
    if not result['ok']:
        return None, status(result)
    try:
        raw = json.loads(result['output'])
        labels = raw.get('Labels') or {}
        if raw.get('Id') != identifier or labels.get(PROJECT_LABEL) != project:
            return None, {'ok': False, 'error': 'ID/projeto não corresponde; container ignorado'}
        service = labels.get(SERVICE_LABEL) or ''
        if not re.fullmatch(r'[a-zA-Z0-9_.-]{1,160}', service):
            return None, {'ok': False, 'error': 'label de serviço ausente/inválido'}
        state = raw.get('State') or {}
        health = state.get('Health') or {}
        record = {
            'id': identifier, 'service': service, 'role': role(service),
            'labels': {key: sanitize(labels.get(key), 1024) for key in LABELS},
            'image_id': raw.get('Image'), 'image_reference': sanitize(raw.get('ImageReference'), 256),
            'hostname': sanitize(raw.get('Hostname'), 256), 'restart_count': raw.get('RestartCount'),
            'state': {key: sanitize(state.get(key), 1024) if key == 'Error' else state.get(key)
                      for key in ('Status', 'Running', 'Restarting', 'Paused', 'OOMKilled', 'ExitCode', 'Error', 'StartedAt', 'FinishedAt')},
            'health': {'status': health.get('Status'), 'failing_streak': health.get('FailingStreak'),
                       'last_checks': [{key: sanitize(check.get(key), 1536) if key == 'Output' else check.get(key)
                                        for key in ('Start', 'End', 'ExitCode', 'Output')}
                                       for check in (health.get('Log') or [])[-5:]]},
            'quotas': raw.get('Quotas') or {}, 'environment': selected_environment(raw.get('Env')),
        }
        record['pause_eligible'] = (record['role'] == 'speech'
                                    and bool(WORKER_IMAGE.search(record['image_reference']))
                                    and (labels.get('com.docker.compose.oneoff') or '').lower() != 'true')
        record['rabbit_mounts'] = [
            {key: sanitize(mount.get(key), 2048) for key in ('Type', 'Source', 'Destination')}
            for mount in raw.get('RabbitMounts', [])
            if record['role'] == 'rabbitmq' and mount.get('Destination') in ('/var/lib/rabbitmq', '/var/lib/rabbitmq/mnesia')
        ]
        return record, status(result)
    except (ValueError, TypeError, AttributeError, KeyError):
        return None, {'ok': False, 'error': 'inspect inválido/incompleto; conteúdo omitido'}


def inventory(runner, project):
    result = runner.run(['docker', 'ps', '--all', '--no-trunc', '--filter', 'label=' + PROJECT_LABEL + '=' + project,
                         '--format', '{{.ID}}'], cap=8192)
    records, issues = [], []
    if not result['ok']:
        return records, [{'operation': 'docker ps', **status(result)}]
    identifiers = list(dict.fromkeys(line.strip() for line in result['output'].splitlines() if line.strip()))
    if len(identifiers) > MAX_CONTAINERS or any(not CONTAINER_ID.fullmatch(item) for item in identifiers):
        return records, [{'operation': 'docker ps', 'ok': False, 'error': 'inventário inválido ou acima de 64 containers; nenhuma ação'}]
    for identifier in identifiers:
        record, check = inspect_container(runner, identifier, project)
        if record:
            records.append(record)
        else:
            issues.append({'operation': 'inspect', 'id': identifier, **check})
    if not identifiers:
        issues.append({'operation': 'docker ps', 'ok': False, 'error': 'nenhum container desse projeto foi encontrado'})
    return records, issues


def text_result(result, limit=16384):
    return {**status(result), 'text': sanitize(result.get('output', ''), limit)}


def read_proc(path, cap=8192):
    try:
        with open(path, encoding='utf-8') as handle:
            return handle.read(cap)
    except OSError:
        return None


def host_snapshot(runner, vmstat=False):
    memory = read_proc('/proc/meminfo') or ''
    keys = {'MemTotal', 'MemAvailable', 'MemFree', 'Buffers', 'Cached', 'SwapTotal', 'SwapFree', 'Dirty', 'Writeback'}
    selected = {line.split(':', 1)[0]: line.split(':', 1)[1].strip()
                for line in memory.splitlines() if ':' in line and line.split(':', 1)[0] in keys}
    host = {'sampled_at': dt.datetime.now(dt.timezone.utc).isoformat(), 'cpu_count': os.cpu_count(),
            'meminfo': selected, 'loadavg': read_proc('/proc/loadavg', 256),
            'pressure': {kind: read_proc('/proc/pressure/' + kind, 2048) for kind in ('cpu', 'memory', 'io')},
            'execution_cgroup': read_proc('/proc/self/cgroup', 2048),
            'cgroup_root': {name: read_proc('/sys/fs/cgroup/' + name, 2048)
                            for name in ('memory.current', 'memory.max', 'memory.swap.current', 'memory.swap.max', 'memory.events', 'cpu.max', 'pids.current', 'pids.max')},
            'disk_root': text_result(runner.run(['df', '-P', '-k', '/'], cap=8192))}
    processes = runner.run(['ps', '-eo', 'pid,ppid,comm,pcpu,pmem,rss,nlwp', '--sort=-rss'], cap=65536)
    host['largest_processes'] = {**status(processes), 'text': sanitize('\n'.join(processes.get('output', '').splitlines()[:21]))}
    if vmstat:
        host['vmstat'] = text_result(runner.run(['vmstat', '-w', '1', '3'], timeout=5, cap=8192))
    return host


def stats_snapshot(runner, records):
    identifiers = [record['id'] for record in records if record['state'].get('Running')]
    if not identifiers:
        return {'ok': True, 'containers': [], 'note': 'nenhum container em execução nessa amostra'}
    result = runner.run(['docker', 'stats', '--no-stream', '--no-trunc', '--format', '{{json .}}', *identifiers], cap=65536)
    output = []
    for line in result.get('output', '').splitlines():
        try:
            parsed = json.loads(line)
            if parsed.get('ID') not in identifiers:
                continue
            output.append({key: sanitize(parsed.get(key), 256)
                           for key in ('ID', 'Name', 'CPUPerc', 'MemUsage', 'MemPerc', 'NetIO', 'BlockIO', 'PIDs')})
        except (ValueError, AttributeError):
            continue
    return {**status(result), 'containers': output}


# A short-lived subprocess bounds slow storage operations. It reads directory
# names and filesystem counters only, never files or descendants of rabbit@*.
MNESIA_PROBE = r'''
import json, os, sys
source, destination = sys.argv[1:]
result = {"names": []}
try:
    if not os.path.isabs(source) or os.path.islink(source):
        raise ValueError("mount inválido ou simbólico")
    path = source if destination == "/var/lib/rabbitmq/mnesia" else os.path.join(source, "mnesia")
    if os.path.islink(path):
        raise ValueError("mnesia simbólico: coleta recusada")
    disk = os.statvfs(source)
    result["disk"] = {"bytes_total": disk.f_blocks * disk.f_frsize, "bytes_available": disk.f_bavail * disk.f_frsize,
                      "inodes_total": disk.f_files, "inodes_available": disk.f_favail}
    with os.scandir(path) as entries:
        for count, entry in enumerate(entries):
            if count >= 256:
                result["truncated"] = True
                break
            if entry.name.startswith("rabbit@") and entry.is_dir(follow_symlinks=False):
                result["names"].append(entry.name[:256])
    result["names"].sort()
except (OSError, ValueError) as error:
    result["error"] = type(error).__name__
print(json.dumps(result))
'''


def connection_scope(runner):
    endpoint = os.environ.get('DOCKER_HOST', '') if not os.environ.get('DOCKER_CONTEXT') else ''
    if not endpoint:
        result = runner.run(['docker', 'context', 'inspect', '--format', '{{json .Endpoints.docker.Host}}'], cap=4096)
        try:
            endpoint = json.loads(result['output']) if result['ok'] else ''
        except (ValueError, KeyError):
            endpoint = ''
    return 'local_unix_socket' if isinstance(endpoint, str) and endpoint.startswith('unix://') else 'remote_or_unknown'


def details(runner, records, scope):
    images = {}
    for record in records:
        image_id = record['image_id']
        if record['role'] not in ('api', 'speech', 'rabbitmq') or not IMAGE_ID.fullmatch(image_id or ''):
            continue
        if image_id not in images:
            fmt = '{"id":{{json .Id}},"repo_digests":{{json .RepoDigests}},"revision":{{json (index .Config.Labels "org.opencontainers.image.revision")}}}'
            result = runner.run(['docker', 'image', 'inspect', '--format', fmt, image_id], cap=16384)
            try:
                parsed = json.loads(result['output']) if result['ok'] else {}
                images[image_id] = {**status(result), 'repo_digests': [sanitize(item, 256) for item in (parsed.get('repo_digests') or [])[:10]],
                                    'revision': sanitize(parsed.get('revision'), 160)}
            except (ValueError, AttributeError):
                images[image_id] = {'ok': False, 'error': 'metadata da imagem inválida'}
        record['image_metadata'] = images[image_id]
        if record['role'] == 'rabbitmq':
            result = runner.run(['docker', 'logs', '--timestamps', '--tail', '150', record['id']], cap=98304)
            record['rabbit_logs'] = text_result(result, 98304)
            record['mnesia'] = []
            for mount in record['rabbit_mounts']:
                if scope != 'local_unix_socket':
                    record['mnesia'].append({'status': 'não coletado: daemon remoto ou não identificado'})
                    continue
                result = runner.run([sys.executable, '-c', MNESIA_PROBE, mount['Source'], mount['Destination']], timeout=3, cap=16384)
                try:
                    probe = json.loads(result['output']) if result['ok'] else {}
                    record['mnesia'].append({**status(result), 'names': [sanitize(name, 256) for name in probe.get('names', [])],
                                             'disk': probe.get('disk'), 'error': probe.get('error'), 'truncated': probe.get('truncated', False)})
                    if probe.get('error') or probe.get('truncated'):
                        record['mnesia'][-1]['ok'] = False
                except (ValueError, AttributeError):
                    record['mnesia'].append({'ok': False, 'error': 'leitura limitada de mnesia incompleta'})
        elif record['role'] == 'speech':
            result = runner.run(['docker', 'logs', '--timestamps', '--tail', '80', record['id']], cap=32768)
            configs = []
            for line in result.get('output', '').splitlines():
                if 'SPEECH_CONFIG' in line:
                    start = line.find('{')
                    configs.append(config_projection(line[start:]) if start >= 0 else {'status': 'marcador presente; conteúdo omitido'})
            record['speech_config_logs'] = {**status(result), 'selected': configs[-5:]}


def pause_workers(runner, records, project):
    actions = []
    for record in records:
        if record['role'] != 'speech' or not record['state'].get('Running'):
            continue
        identifier = record['id']
        latest, check = inspect_container(runner, identifier, project)
        if not latest or not latest['pause_eligible'] or latest['service'] != record['service']:
            actions.append({'id': identifier, 'service': record['service'], 'stopped': False,
                            'error': 'parada recusada: identidade/labels/imagem não confirmados', 'validation': check})
            continue
        result = runner.run(['docker', 'stop', '--time', '15', identifier], timeout=20, cap=4096)
        final, check = inspect_container(runner, identifier, project)
        stopped = bool(final and final['state'].get('Running') is False and not final['state'].get('Restarting'))
        actions.append({'id': identifier, 'service': latest['service'], 'stopped': stopped,
                        'command': status(result), 'verification': check,
                        'final_status': final['state'].get('Status') if final else 'não confirmado'})
    return actions


def prepare_rabbit_override(runner, records, project):
    rabbits = [record for record in records if record['role'] == 'rabbitmq']
    if len(rabbits) != 1:
        return {'ok': False, 'error': 'é necessário exatamente um serviço RabbitMQ verificado nesse projeto'}
    original = rabbits[0]
    latest, check = inspect_container(runner, original['id'], project)
    if not latest or latest['service'] != original['service'] or latest['role'] != 'rabbitmq':
        return {'ok': False, 'error': 'identidade atual do RabbitMQ não confirmada', 'validation': check}
    hostname, image_id = latest['hostname'], latest['image_id']
    if not re.fullmatch(r'[a-zA-Z0-9][a-zA-Z0-9._-]{0,252}', hostname or '') or not IMAGE_ID.fullmatch(image_id or ''):
        return {'ok': False, 'error': 'hostname ou ID local da imagem inválido; override não gerado'}
    environment = latest['environment']
    nodename = environment.get('RABBITMQ_NODENAME')
    longname = environment.get('RABBITMQ_USE_LONGNAME')
    if nodename and not re.fullmatch(r'[a-zA-Z0-9_.-]{1,100}@[a-zA-Z0-9_.-]{1,253}', nodename):
        return {'ok': False, 'error': 'RABBITMQ_NODENAME observado não é válido; override não gerado'}
    if longname is not None and not isinstance(longname, bool):
        return {'ok': False, 'error': 'RABBITMQ_USE_LONGNAME observado não é válido; override não gerado'}
    service = {'hostname': hostname, 'image': image_id, 'pull_policy': 'never'}
    custom = {}
    if nodename:
        custom['RABBITMQ_NODENAME'] = nodename
    if longname is not None:
        custom['RABBITMQ_USE_LONGNAME'] = str(longname).lower()
    if custom:
        service['environment'] = custom
    return {'ok': True, 'filename': 'compose.rabbitmq-preserve.json', 'container_id': latest['id'],
            'compose': {'services': {latest['service']: service}},
            'note': 'Somente arquivo gerado. Preserva nó e imagem ATUAIS; não seleciona/restaura outro diretório Mnesia nem aplica Compose.'}


def findings(report):
    result = []
    records = report['before']['containers']
    for record in records:
        state, service = record['state'], record['service']
        if state.get('OOMKilled'):
            result.append({'kind': 'fact', 'message': service + ': Docker registrou OOMKilled na execução inspecionada; isso não identifica sozinho a causa do travamento do host.'})
        if record['restart_count']:
            result.append({'kind': 'fact', 'message': service + ': RestartCount=' + str(record['restart_count']) + '.'})
        if state.get('Status') in ('created', 'restarting', 'exited'):
            result.append({'kind': 'fact', 'message': service + ': estado=' + state['Status'] + ', ExitCode=' + str(state.get('ExitCode')) + '.'})
        if record['role'] == 'speech' and record['quotas'].get('Memory') == 0:
            result.append({'kind': 'fact', 'message': service + ': sem limite individual de memória no HostConfig observado.'})
        if record['role'] == 'rabbitmq':
            log = record.get('rabbit_logs', {}).get('text', '')
            if re.search(r'BOOT FAILED|BOOT FAILURE|failed to start', log, re.I):
                result.append({'kind': 'fact', 'message': service + ': recorte do log contém marcador explícito de falha de inicialização; consultar o trecho sanitizado.'})
            elif log and not re.search(r'Server startup complete|completed with \d+ plugins', log, re.I):
                result.append({'kind': 'indication', 'message': service + ': as últimas 150 linhas não mostram conclusão do boot; esse recorte não comprova travamento.'})
            if re.fullmatch(r'[a-f0-9]{12}', record['hostname'] or ''):
                result.append({'kind': 'indication', 'message': service + ': hostname no formato de ID de container. Compare a identidade com os nomes de Mnesia antes de qualquer recriação; nenhum nodename foi alterado.'})
            names = {name for probe in record.get('mnesia', []) for name in probe.get('names', [])}
            if len(names) > 1:
                result.append({'kind': 'fact', 'message': service + ': vistos ' + str(len(names)) + ' diretórios imediatos rabbit@* no mount observado. Isso não comprova perda de dados. O override preserva o nó atual e não seleciona/restaura outro diretório.'})
    workers = [record for record in records if record['role'] == 'speech']
    if any(record['environment'].get('SPEECH_WORKER_MODE') != 'pool' for record in workers):
        result.append({'kind': 'indication', 'message': 'Há worker sem SPEECH_WORKER_MODE=pool no ambiente observado. Pode haver Compose legado ou configuração diferente; conferir revisão/digest e arquivo efetivo.'})
    if len(workers) > 1:
        result.append({'kind': 'fact', 'message': str(len(workers)) + ' containers de speech encontrados nesse projeto, incluindo parados. Verificar os estados para identificar execução simultânea.'})
    revisions = {kind: {record.get('image_metadata', {}).get('revision') for record in records if record['role'] == kind}
                 for kind in ('api', 'speech')}
    if revisions['api'] and revisions['speech']:
        if '' in revisions['api'] | revisions['speech'] or None in revisions['api'] | revisions['speech']:
            result.append({'kind': 'limitation', 'message': 'Revisão OCI ausente em API/worker: uma tag igual não comprova que as imagens foram construídas do mesmo commit.'})
        elif revisions['api'] != revisions['speech']:
            result.append({'kind': 'indication', 'message': 'Revisões OCI de API e worker diferem. Conferir compatibilidade de protocolo e publicação antes de atualizar.'})
    result.append({'kind': 'limitation', 'message': 'Máximos anunciados por NATS/JetStream são limites configurados; não equivalem ao consumo real. Use as amostras de docker stats/host.'})
    result.append({'kind': 'limitation', 'message': 'As amostras são pontuais. A causa efetiva do travamento da VPS e a recuperação do RabbitMQ dependem da correlação dos estados, recursos e logs; pausar speech não garante que RabbitMQ inicialize.'})
    if report['connection_scope'] != 'local_unix_socket':
        result.append({'kind': 'limitation', 'message': 'Daemon remoto ou desconhecido: métricas /proc são da máquina que executou o script; Mnesia local não foi acessado.'})
    return result


def diagnose(project, runner, pause=False, vmstat=False, sample_host=host_snapshot, prepare_override=False):
    scope = connection_scope(runner)
    records, issues = inventory(runner, project)
    report = {'schema_version': 1, 'project': project, 'mode': 'pause_speech' if pause else 'read_only',
              'connection_scope': scope, 'before': {'containers': records, 'host': sample_host(runner, vmstat),
                                                   'stats': stats_snapshot(runner, records)}, 'issues': issues, 'actions': []}
    if pause:
        report['actions'] = pause_workers(runner, records, project)
        after, after_issues = inventory(runner, project)
        report['after'] = {'containers': after, 'host': sample_host(runner, vmstat), 'stats': stats_snapshot(runner, after)}
        report['issues'].extend(after_issues)
    details(runner, records, scope)
    if prepare_override:
        report['rabbitmq_override'] = prepare_rabbit_override(runner, records, project)
        if not report['rabbitmq_override']['ok']:
            report['issues'].append({'operation': 'prepare-rabbitmq-override', **report['rabbitmq_override']})
    for stage in ('before', 'after'):
        if stage not in report:
            continue
        snapshot = report[stage]
        for operation, result in [('docker stats', snapshot['stats']),
                                  *[(key, value) for key, value in snapshot['host'].items()
                                    if isinstance(value, dict) and 'ok' in value]]:
            if not result.get('ok'):
                report['issues'].append({'stage': stage, 'operation': operation, **status(result)})
    for record in records:
        for operation in ('image_metadata', 'rabbit_logs', 'speech_config_logs'):
            if operation in record and not record[operation].get('ok'):
                report['issues'].append({'id': record['id'], 'operation': operation, **status(record[operation])})
        for probe in record.get('mnesia', []):
            if 'ok' in probe and not probe['ok']:
                report['issues'].append({'id': record['id'], 'operation': 'mnesia_names', **status(probe)})
    report['findings'] = findings(report)
    report['finished_at'] = dt.datetime.now(dt.timezone.utc).isoformat()
    return report


def summary(report):
    lines = ['Connect|API — diagnóstico de inicialização', 'Projeto: ' + report['project'],
             'Modo: ' + ('contenção explícita de speech' if report['mode'] == 'pause_speech' else 'somente leitura'), '',
             'Estados observados antes da contenção:' if report['mode'] == 'pause_speech' else 'Estados observados:']
    for record in report['before']['containers']:
        lines.append('- {service}: {state}; health={health}; reinícios={restarts}; OOMKilled={oom}.'.format(
            service=record['service'], state=record['state'].get('Status'), health=record['health'].get('status') or 'sem healthcheck',
            restarts=record['restart_count'], oom=record['state'].get('OOMKilled')))
    for action in report['actions']:
        lines.append('- Contenção de ' + action['service'] + ': ' + ('parado e verificado' if action['stopped'] else 'parada não confirmada; consultar JSON') + '.')
    override = report.get('rabbitmq_override')
    if override:
        lines.append('- Override RabbitMQ: ' + ('arquivo gerado para revisão, sem aplicação; preserva nó e imagem atuais.'
                                               if override['ok'] else 'não gerado; ' + override['error'] + '.'))
    for key, title in (('before', 'Amostra inicial'), ('after', 'Amostra após contenção')):
        if key not in report:
            continue
        snapshot = report[key]
        lines.extend(['', title + ': MemAvailable=' + str(snapshot['host'].get('meminfo', {}).get('MemAvailable', 'indisponível'))])
        for row in snapshot['stats']['containers']:
            lines.append('- ' + row.get('Name', row.get('ID', '')) + ': CPU=' + row.get('CPUPerc', '') + ', memória=' + row.get('MemUsage', '') + ', PIDs=' + row.get('PIDs', '') + '.')
    lines.append('')
    for kind, title in (('fact', 'Fatos observados'), ('indication', 'Indícios a verificar'), ('limitation', 'Limites da conclusão')):
        lines.append(title + ':')
        lines.extend('- ' + item['message'] for item in report['findings'] if item['kind'] == kind)
    if report['issues']:
        lines.extend(['', 'Há coletas incompletas/recusadas; consulte issues no JSON. Nenhum erro foi tratado como confirmação de estado saudável.'])
    return '\n'.join(lines) + '\n'


def main(argv=None):
    parser = argparse.ArgumentParser(description='Diagnóstico limitado de um projeto Compose; somente leitura por padrão.')
    parser.add_argument('--project', required=True, help='Nome exato do projeto Compose (label com.docker.compose.project).')
    parser.add_argument('--pause-speech', action='store_true', help='Parar somente workers speech reconhecidos desse projeto e medir novamente.')
    parser.add_argument('--prepare-rabbitmq-override', action='store_true',
                        help='Gerar um override que preserva hostname/nodename e imagem local do único RabbitMQ; não aplicar.')
    parser.add_argument('--output-dir', help='Novo diretório privado de saída; não pode existir previamente.')
    parser.add_argument('--vmstat', action='store_true', help='Adicionar vmstat 1 3 em cada amostra.')
    parser.add_argument('--command-timeout', type=int, choices=range(2, 21), metavar='2..20', default=8)
    parser.add_argument('--max-seconds', type=int, choices=range(30, 301), metavar='30..300', default=120)
    args = parser.parse_args(argv)
    if not re.fullmatch(r'[a-z0-9][a-z0-9_-]{0,99}', args.project):
        parser.error('--project deve ser o nome exato do projeto, sem espaços ou caracteres especiais.')
    os.umask(0o077)
    stamp = dt.datetime.now(dt.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    destination = Path(args.output_dir or ('connect-startup-' + args.project + '-' + stamp + '-' + str(os.getpid()))).absolute()
    try:
        destination.mkdir(mode=0o700, parents=True, exist_ok=False)
    except OSError:
        parser.error('não foi possível criar um novo diretório privado de saída; use outro --output-dir.')
    report = diagnose(args.project, Runner(args.command_timeout, args.max_seconds), args.pause_speech, args.vmstat,
                      prepare_override=args.prepare_rabbitmq_override)
    rendered = summary(report)
    try:
        outputs = [('diagnostico.json', json.dumps(report, ensure_ascii=False, indent=2) + '\n'), ('resumo.txt', rendered)]
        override = report.get('rabbitmq_override')
        if override and override['ok']:
            outputs.append((override['filename'], json.dumps(override['compose'], ensure_ascii=False, indent=2) + '\n'))
        for name, contents in outputs:
            with open(destination / name, 'x', encoding='utf-8') as handle:
                handle.write(contents)
    except OSError:
        print('Não foi possível concluir os arquivos de diagnóstico.', file=sys.stderr)
        return 2
    print(rendered)
    print('Arquivos: ' + str(destination / 'diagnostico.json') + ' e ' + str(destination / 'resumo.txt'))
    if override and override['ok']:
        print('Override gerado, sem aplicação: ' + str(destination / override['filename']))
    if any(not action['stopped'] for action in report['actions']):
        return 3
    return 2 if report['issues'] else 0


if __name__ == '__main__':
    sys.exit(main())
