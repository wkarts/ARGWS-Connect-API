"""Reconcile certificates in the existing CloudPanel reverse proxy, with rollback.

Only the explicitly configured Platform namespace and fixed aliases are
managed. The operator does not run host scripts or install certificates manually.
"""
from __future__ import annotations

import fcntl
import hashlib
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
    temporary.write_bytes(data)
    temporary.chmod(mode)
    os.replace(temporary, path)


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
    value = add_aliases(text, site, aliases)
    if not re.search(r'^\s*proxy_pass\s+', value, flags=re.M):
        raise ValueError('BASE_SITE_IS_NOT_A_REVERSE_PROXY')
    # Do not allow a hardcoded upstream Host to collapse all customers into one.
    value = re.sub(r'^[ \t]*proxy_set_header[ \t]+Host[ \t]+[^;\n]+;[ \t]*\n?', '', value, flags=re.M)
    value = re.sub(r'^(?P<indent>[ \t]*)proxy_pass\s+',
                   lambda m: m['indent'] + 'proxy_set_header Host $host;\n' + m['indent'] + 'proxy_pass ',
                   value, flags=re.M)
    return value


def check_alias_conflicts(vhost: Path, aliases: list[str]) -> None:
    for alias in aliases:
        other = find_vhost(alias)
        if other is not None and other != vhost:
            raise ValueError('PLATFORM_ALIAS_OWNED_BY_ANOTHER_VHOST')


def reconcile_base(names: list[str], namespace: str) -> None:
    site = hostname(os.environ.get('CLOUDPANEL_SITE_DOMAIN', names[0]))
    if site != names[0]: raise ValueError('SITE_AND_ACME_ROOT_MUST_MATCH')
    vhost = ensure_base(site)
    # Enable aliases even before issuance; only the known base proxy is modified.
    check_alias_conflicts(vhost, names)
    apply_vhost(vhost, reconcile_proxy(vhost.read_text(), site, names))
    source = (CERTS/'current').resolve(strict=True)
    info = bundle(source, names)
    verify_chain(source)  # Never install untrusted/staging material, even briefly.
    try:
        probe(names, info['fingerprint'])
        state(STATUS/'cloudpanel.json', status='READY', **info)
        return
    except Exception:
        pass
    # Backup the exact existing vhost and referenced certificates before clpctl.
    original = vhost.read_bytes()
    snapshots = {vhost: (original, vhost.stat().st_mode & 0o777)}
    for value in re.findall(r'^\s*ssl_certificate(?:_key)?\s+([^;\s]+);', original.decode(), flags=re.M):
        if value.startswith('/etc/nginx/'):
            path = host_path(value)
            if path.is_file(): snapshots[path] = (path.read_bytes(), path.stat().st_mode & 0o777)
    backup = STATE/('rollback-' + uuid4().hex)
    backup.mkdir(mode=0o700, parents=True)
    for index, (_, (data, _)) in enumerate(snapshots.items()):
        (backup/str(index)).write_bytes(data)
        (backup/str(index)).chmod(0o600)
    relative = '/run/connect-api-cloudpanel-' + namespace
    temporary = HOST/relative.lstrip('/')
    temporary.mkdir(mode=0o700, exist_ok=True)
    try:
        for name in FILES:
            shutil.copyfile(source/name, temporary/name)
            (temporary/name).chmod(0o600)
        host_run('clpctl', 'site:install:certificate', '--domainName=' + site,
                 '--privateKey=' + relative + '/privkey.pem', '--certificate=' + relative + '/cert.pem',
                 '--certificateChain=' + relative + '/ca.pem')
        regenerated = find_vhost(site)
        if not regenerated: raise ValueError('VHOST_DISAPPEARED')
        apply_vhost(regenerated, reconcile_proxy(regenerated.read_text(), site, names))
        host_run('nginx', '-t')
        host_run('nginx', '-s', 'reload')
        probe(names, info['fingerprint'])
        state(STATUS/'cloudpanel.json', status='READY', **info)
    except Exception:
        for path, (data, mode) in snapshots.items(): write_atomic(path, data, mode)
        host_run('nginx', '-t')
        host_run('nginx', '-s', 'reload')
        raise
    finally:
        shutil.rmtree(temporary, ignore_errors=True)
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
                host_run('nginx', '-t')
                reconcile_base(names, namespace)
        except Exception as exc:
            state(STATUS/'cloudpanel.json', status='RECONCILIATION_FAILED', error=str(exc) if isinstance(exc, ValueError) else type(exc).__name__)
            print(f'cloudpanel_reconciliation_failed type={type(exc).__name__}', flush=True)
        time.sleep(interval)


if __name__ == '__main__':
    raise SystemExit(main())
