"""Reconcile certificates in the existing CloudPanel reverse proxy, with rollback.

Only the explicitly configured Platform namespace and fixed aliases are
managed. The operator does not run host scripts or install certificates manually.
"""
from __future__ import annotations

import fcntl
import hashlib
import json
from datetime import datetime, timezone
import os
import re
import shutil
import sys
import time
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from tls_common import FILES, bundle, check_health, configured_names, hostname, run, served_fingerprint, state, enabled, verify_chain, covers

HOST = Path(os.environ.get('HOST_ROOT', '/host'))
CERTS = Path(os.environ.get('CERT_DIR', '/certs'))
STATE = Path(os.environ.get('STATE_DIR', '/state'))
STATUS = Path('/tls-status')


def host_run(*argv: str):
    return run(['chroot', str(HOST), '/usr/bin/env', 'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin', *argv])


def names_in(text: str) -> set[str]:
    return {token for match in re.finditer(r'^\s*server_name\s+([^;]+);', text, re.M)
            for token in match.group(1).split()}


def host_path(value: str) -> Path:
    if not value.startswith('/') or '..' in Path(value).parts: raise ValueError('INVALID_HOST_PATH')
    path = HOST / value.lstrip('/')
    for _ in range(8):
        if not path.is_symlink(): break
        link = Path(os.readlink(path))
        path = HOST / str(link).lstrip('/') if link.is_absolute() else path.parent / link
    if not path.resolve().is_relative_to(HOST.resolve()): raise ValueError('HOST_PATH_ESCAPE')
    return path


def find_vhost(site: str) -> Path | None:
    directory = HOST/'etc/nginx/sites-enabled'
    for candidate in sorted(directory.glob('*')):
        try:
            path = host_path('/etc/nginx/sites-enabled/' + candidate.name)
            if path.is_file() and site in names_in(path.read_text()): return path
        except (OSError, UnicodeError): continue
    return None


def add_aliases(text: str, site: str, aliases: list[str]) -> str:
    matched = False
    def replace(match):
        nonlocal matched
        tokens = match.group(2).split()
        if site not in tokens: return match.group(0)
        matched = True
        return match.group(1) + ' '.join(dict.fromkeys([*tokens, *aliases])) + ';'
    result = re.sub(r'^(\s*server_name\s+)([^;]+);', replace, text, flags=re.M)
    if not matched: raise ValueError('EXACT_VHOST_NOT_FOUND')
    return result


def write_atomic(path: Path, data: bytes, mode: int = 0o644) -> None:
    temporary = path.with_name(path.name + '.connect-next')
    with temporary.open('wb') as stream:
        os.chmod(temporary, mode)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)
    descriptor = os.open(path.parent, os.O_RDONLY | os.O_DIRECTORY)
    try: os.fsync(descriptor)
    finally: os.close(descriptor)


def apply_vhost(path: Path, content: str) -> None:
    before = path.read_bytes() if path.exists() else None
    if before == content.encode(): return
    write_atomic(path, content.encode())
    try:
        host_run('nginx', '-t')
        host_run('nginx', '-s', 'reload')
    except Exception:
        if before is None: path.unlink(missing_ok=True)
        else: write_atomic(path, before)
        host_run('nginx', '-t')
        host_run('nginx', '-s', 'reload')
        raise


def probe(names: list[str], expected: str) -> None:
    for name in names:
        sni = 'connect-tls-check.' + name[2:] if name.startswith('*.') else name
        for attempt in range(5):
            try:
                if served_fingerprint(sni) == expected: break
                raise ValueError('SERVED_CERTIFICATE_MISMATCH')
            except Exception:
                if attempt == 4: raise
                time.sleep(1)


def proxy_url() -> str:
    value = os.environ.get('CLOUDPANEL_REVERSE_PROXY_URL', 'http://127.0.0.1:38800')
    parsed = urlsplit(value)
    if (parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', 'localhost'} or not parsed.port
            or parsed.path not in {'', '/'} or parsed.query or parsed.fragment or parsed.username):
        raise ValueError('REVERSE_PROXY_MUST_BE_LOCAL_HTTP')
    return value.rstrip('/')


def ensure_base(site: str) -> Path:
    existing = find_vhost(site)
    if existing: return existing
    # Same operational model as Scheduler Pro: wait for the ONE manually declared proxy.
    raise ValueError('BASE_REVERSE_PROXY_MISSING')


def reconcile_proxy(text: str, site: str, aliases: list[str]) -> str:
    if any(not any(covers(pattern, name) for pattern in aliases) for name in names_in(text)):
        raise ValueError('BASE_VHOST_CONTAINS_UNMANAGED_NAMES')
    expected = proxy_url()
    routes = re.findall(r'^\s*proxy_pass\s+([^;]+);', text, flags=re.M)
    if not routes: raise ValueError('BASE_SITE_IS_NOT_A_REVERSE_PROXY')
    origins = set()
    for value in routes:
        parsed = urlsplit(value.strip())
        if (parsed.scheme != 'http' or parsed.hostname not in {'127.0.0.1', 'localhost'}
                or not parsed.port or parsed.path not in {'', '/'} or parsed.query or parsed.fragment
                or parsed.username or '$' in value or any(c.isspace() for c in value.strip())):
            raise ValueError('UNMANAGED_REVERSE_PROXY_UPSTREAM')
        origins.add(parsed.port)
    if len(origins) != 1: raise ValueError('AMBIGUOUS_REVERSE_PROXY_UPSTREAM')
    value = add_aliases(text, site, aliases)
    value = re.sub(r'^(?P<indent>[ \t]*)proxy_pass\s+[^;]+;',
                   lambda m: m['indent'] + 'proxy_pass ' + expected + ';', value, flags=re.M)
    value = re.sub(r'^[ \t]*proxy_set_header[ \t]+Host[ \t]+[^;\n]+;[ \t]*\n?', '', value, flags=re.M)
    return re.sub(r'^(?P<indent>[ \t]*)proxy_pass\s+',
                  lambda m: m['indent'] + 'proxy_set_header Host $host;\n' + m['indent'] + 'proxy_pass ',
                  value, flags=re.M)


def begin_transaction(vhost: Path) -> Path:
    """Persist the pre-mutation state before NGINX or clpctl can change any file."""
    if (STATE/'pending.json').exists(): raise ValueError('RECOVERY_REQUIRED')
    targets = {vhost}
    for value in re.findall(r'^\s*ssl_certificate(?:_key)?\s+([^;\s]+);', vhost.read_text(), flags=re.M):
        if not value.startswith('/etc/nginx/'):
            raise ValueError('CERTIFICATE_PATH_OUTSIDE_MANAGED_NGINX')
        target = host_path(value)
        if target.is_file(): targets.add(target)
    backup = STATE/('rollback-' + uuid4().hex)
    backup.mkdir(mode=0o700, parents=True)
    entries = []
    for i, target in enumerate(sorted(targets)):
        relative = str(target.relative_to(HOST))
        if not relative.startswith('etc/nginx/'): raise ValueError('SNAPSHOT_SCOPE_INVALID')
        stat = target.stat()
        data = target.read_bytes()
        write_atomic(backup/str(i), data, 0o600)
        entries.append({'path': '/' + relative, 'file': str(i), 'mode': stat.st_mode & 0o777,
                        'uid': stat.st_uid, 'gid': stat.st_gid, 'sha256': hashlib.sha256(data).hexdigest()})
    write_atomic(backup/'manifest.json', json.dumps(entries).encode(), 0o600)
    write_atomic(STATE/'pending.json', json.dumps({'directory': backup.name}).encode(), 0o600)
    return backup


def recover_pending() -> bool:
    pending = STATE/'pending.json'
    if not pending.exists(): return False
    name = json.loads(pending.read_text())['directory']
    if not re.fullmatch(r'rollback-[a-f0-9]{32}', name): raise ValueError('JOURNAL_INVALID')
    directory = STATE/name
    entries = json.loads((directory/'manifest.json').read_text())
    verified = []
    for item in entries:
        if not item['path'].startswith('/etc/nginx/') or not item['file'].isdigit(): raise ValueError('JOURNAL_SCOPE_INVALID')
        data = (directory/item['file']).read_bytes()
        if hashlib.sha256(data).hexdigest() != item['sha256']: raise ValueError('JOURNAL_CORRUPTED')
        verified.append((host_path(item['path']), data, item))
    for target, data, item in verified:
        write_atomic(target, data, item['mode'])
        if os.geteuid() == 0: os.chown(target, item['uid'], item['gid'])
    host_run('nginx', '-t')
    host_run('nginx', '-s', 'reload')
    pending.unlink()
    return True


def publish_ready(info: dict, installed: bool) -> None:
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    STATUS.mkdir(parents=True, exist_ok=True)
    now = datetime.now(timezone.utc).isoformat()
    record = STATE/'installation.json'
    previous = json.loads(record.read_text()) if record.exists() else {}
    if installed:
        previous = {'installed_at': now, 'fingerprint': info['fingerprint']}
        write_atomic(record, json.dumps(previous).encode(), 0o600)
        write_atomic(STATUS/'last-cloudpanel-installed-at.txt', (now + '\n').encode())
    state(STATUS/'cloudpanel.json', status='READY', last_verified_at=now,
          last_installed_at=previous.get('installed_at'), upstream=proxy_url(), **info)


def check_alias_conflicts(vhost: Path, aliases: list[str]) -> None:
    for alias in aliases:
        other = find_vhost(alias)
        if other is not None and other != vhost:
            raise ValueError('PLATFORM_ALIAS_OWNED_BY_ANOTHER_VHOST')


def reconcile_base(names: list[str], namespace: str) -> None:
    recover_pending()
    site = hostname(os.environ.get('CLOUDPANEL_SITE_DOMAIN', names[0]))
    if site != names[0]: raise ValueError('SITE_AND_ACME_ROOT_MUST_MATCH')
    vhost = ensure_base(site)
    check_alias_conflicts(vhost, names)
    new_config = reconcile_proxy(vhost.read_text(), site, names)
    source = (CERTS/'current').resolve(strict=True)
    if not source.is_relative_to(CERTS.resolve()): raise ValueError('CERTIFICATE_PATH_ESCAPE')
    info = bundle(source, names)
    verify_chain(source)
    must_install = False
    try: probe(names, info['fingerprint'])
    except Exception: must_install = True
    if not must_install and new_config == vhost.read_text():
        publish_ready(info, installed=False)
        return
    begin_transaction(vhost)
    relative = '/run/connect-api-cloudpanel-' + namespace
    temporary = HOST/relative.lstrip('/')
    try:
        apply_vhost(vhost, new_config)
        if must_install:
            temporary.mkdir(mode=0o700, exist_ok=True)
            for name in FILES:
                write_atomic(temporary/name, (source/name).read_bytes(), 0o600)
            host_run('clpctl', 'site:install:certificate', '--domainName=' + site,
                     '--privateKey=' + relative + '/privkey.pem', '--certificate=' + relative + '/cert.pem',
                     '--certificateChain=' + relative + '/ca.pem')
            regenerated = find_vhost(site)
            if not regenerated or regenerated != vhost: raise ValueError('VHOST_CHANGED_PATH')
            apply_vhost(regenerated, reconcile_proxy(regenerated.read_text(), site, names))
        host_run('nginx', '-t')
        host_run('nginx', '-s', 'reload')
        probe(names, info['fingerprint'])
        publish_ready(info, installed=must_install)
        (STATE/'pending.json').unlink()
    except Exception:
        recover_pending()
        raise
    finally:
        shutil.rmtree(temporary, ignore_errors=True)
        if not (STATE/'pending.json').exists():
            for old in sorted(STATE.glob('rollback-*'), key=lambda p: p.stat().st_mtime, reverse=True)[5:]:
                shutil.rmtree(old)


def main() -> int:
    interval = max(15, min(3600, int(os.environ.get('CLOUDPANEL_SYNC_INTERVAL_SECONDS', '60'))))
    if len(sys.argv) > 1 and sys.argv[1] == 'health':
        try: check_health(STATUS/'cloudpanel.json', interval*3 + 120); return 0
        except Exception: return 1
    STATE.mkdir(mode=0o700, parents=True, exist_ok=True)
    STATE.chmod(0o700)
    STATUS.mkdir(parents=True, exist_ok=True)
    while True:
        try:
            if not enabled():
                state(STATUS/'cloudpanel.json', status='DISABLED')
                time.sleep(interval)
                continue
            names = configured_names()
            namespace = hashlib.sha256(names[0].encode()).hexdigest()[:16]
            # Serialize NGINX validation/reload across all Connect|API stacks on this VPS.
            lock = HOST/'run'/'connect-api-cloudpanel-nginx.lock'
            with lock.open('w') as stream:
                fcntl.flock(stream, fcntl.LOCK_EX | fcntl.LOCK_NB)
                recover_pending()
                host_run('nginx', '-t')
                reconcile_base(names, namespace)
        except Exception as exc:
            state(STATUS/'cloudpanel.json', status='RECONCILIATION_FAILED', error=str(exc) if isinstance(exc, ValueError) else type(exc).__name__)
            print(f'cloudpanel_reconciliation_failed type={type(exc).__name__}', flush=True)
        time.sleep(interval)


if __name__ == '__main__':
    raise SystemExit(main())
