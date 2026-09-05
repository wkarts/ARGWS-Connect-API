"""Reconcile DNS-01 certificates for the operator-configured Platform namespace."""
from __future__ import annotations

import os
import shutil
import sys
import time
from pathlib import Path
from uuid import uuid4

from tls_common import FILES, bundle, check_health, configured_names, run, state, enabled, verify_chain

ROOT = Path('/certs')
STATUS = Path('/tls-status')
DATA = Path(os.environ.get('ACME_CONFIG_HOME', '/acme.sh'))
from cloudflare_dns import reconcile_dns


def issue(target: Path, names: list[str], dns: bool, staging: bool) -> None:
    status = STATUS / ('staging-acme.json' if staging else 'acme.json')
    current = target / 'current'
    previous = None
    try: previous = bundle(current, names)
    except (OSError, ValueError): pass
    if previous and not staging:
        try: verify_chain(current)
        except RuntimeError: previous = None
    if previous and previous['days_remaining'] > 30:
        state(status, status='STAGING' if staging else 'READY', **previous)
        return
    state(status, status='ISSUING', domains=names)
    server = 'letsencrypt_test' if staging else 'letsencrypt'
    # Keep dnsapi scripts in the image; ONLY configuration/certificates live in the volume.
    home = str(DATA/'staging' if staging else DATA)
    base = ['acme.sh', '--config-home', home, '--cert-home', home, '--server', server]
    store = Path(home) / (names[0] + '_ecc')
    conf = store / (names[0] + '.conf')
    if conf.exists():
        # Remove legacy automatic installation callbacks. Publication is atomic below.
        keys = ('Le_RealCertPath=', 'Le_RealCACertPath=', 'Le_RealKeyPath=', 'Le_RealFullChainPath=', 'Le_ReloadCmd=')
        conf.write_text('\n'.join(line for line in conf.read_text().splitlines() if not line.startswith(keys)) + '\n')
    challenge = ['--dns', 'dns_cf'] if dns else ['--webroot', '/challenges']
    command = base + ['--issue', '--keylength', 'ec-256', *challenge]
    for name in names: command += ['-d', name]
    if dns and int(os.environ.get('ACME_DNS_SLEEP', '0')) > 0:
        command += ['--dnssleep', os.environ['ACME_DNS_SLEEP']]
    source_files = {'privkey.pem': names[0] + '.key', 'cert.pem': names[0] + '.cer',
                    'ca.pem': 'ca.cer', 'fullchain.pem': 'fullchain.cer'}
    # Recover a successfully issued order after a crash, without another CA order.
    import tempfile
    issued = None
    try:
        with tempfile.TemporaryDirectory() as temporary:
            for output, source in source_files.items(): shutil.copyfile(store/source, Path(temporary)/output)
            issued = bundle(Path(temporary), names)
            if not staging: verify_chain(Path(temporary))
    except (OSError, ValueError, RuntimeError): issued = None
    if not issued or issued['days_remaining'] <= 30:
        # The service calls the CA only for a missing/changed/expiring bundle.
        run(command + ['--force'], timeout=900)
    target.mkdir(parents=True, exist_ok=True)
    staging_dir = target / ('bundle-' + uuid4().hex)
    staging_dir.mkdir(mode=0o700)
    try:
        for output, source in source_files.items(): shutil.copyfile(store/source, staging_dir/output)
        info = bundle(staging_dir, names)
        if not staging:
            verify_chain(staging_dir)
        for name in FILES: (staging_dir/name).chmod(0o600 if name == 'privkey.pem' else 0o644)
        staging_dir.chmod(0o755)
        link = target / '.current-next'
        link.unlink(missing_ok=True)
        link.symlink_to(staging_dir.name)
        os.replace(link, current)
        # Legacy readers remain compatible. New readers resolve current once per cycle.
        for name in FILES:
            legacy = target / name
            temporary = target / ('.' + name + '.next')
            temporary.unlink(missing_ok=True)
            temporary.symlink_to('current/' + name)
            os.replace(temporary, legacy)
        state(status, status='STAGING' if staging else 'READY', **info)
        for old in sorted(target.glob('bundle-*'), key=lambda value: value.stat().st_mtime, reverse=True)[3:]:
            if old != staging_dir: shutil.rmtree(old)
    except Exception:
        if not current.exists() or current.resolve() != staging_dir.resolve(): shutil.rmtree(staging_dir, ignore_errors=True)
        raise


def main() -> int:
    interval = max(60, min(43200, int(os.environ.get('ACME_CHECK_INTERVAL_SECONDS', '3600'))))
    if len(sys.argv) > 1 and sys.argv[1] == 'health':
        try: check_health(STATUS/'acme.json', interval*2 + 900); return 0
        except Exception: return 1
    STATUS.mkdir(parents=True, exist_ok=True)
    os.environ['AUTO_UPGRADE'] = '0'
    os.environ['LOG_LEVEL'] = '1'
    os.environ.pop('CF_Zone_ID', None)  # each SAN may belong to a different authorized zone
    DATA.mkdir(parents=True, exist_ok=True)
    DATA.chmod(0o700)
    Path('/challenges').mkdir(exist_ok=True)
    retry = 60
    registered = False
    while True:
        try:
            if not enabled():
                state(STATUS/'acme.json', status='DISABLED')
                time.sleep(interval)
                continue
            names = configured_names()
            try:
                dns = reconcile_dns(names)
            except Exception as exc:
                state(STATUS/'dns.json', status='RECONCILIATION_FAILED', domains=names, error=type(exc).__name__)
                raise
            state(STATUS/'dns.json', status='READY', domains=names, records=dns)
            email = os.environ.get('ACME_EMAIL', '').strip()
            token = os.environ.get('CF_Token', '')
            if not email or '@' not in email or not token or token.startswith('CHANGE_ME'):
                raise ValueError('ACME_EMAIL_AND_CLOUDFLARE_TOKEN_REQUIRED')
            staging = os.environ.get('ACME_STAGING', 'false').lower() in {'true', '1'}
            if not registered:
                (DATA/'staging' if staging else DATA).mkdir(mode=0o700, parents=True, exist_ok=True)
                run(['acme.sh', '--config-home', str(DATA/'staging' if staging else DATA), '--register-account', '-m', email,
                     '--server', 'letsencrypt_test' if staging else 'letsencrypt'], timeout=120)
                registered = True
            issue(ROOT/'staging' if staging else ROOT, names, True, staging)
            if staging: state(STATUS/'acme.json', status='STAGING', message='Certificado de teste não é instalado no CloudPanel.')
            retry = 60
            time.sleep(interval)
        except Exception as exc:
            # Preserve the last usable certificate on ALL renewal/issuance failures.
            state(STATUS/'acme.json', status='RECONCILIATION_FAILED', error=str(exc) if isinstance(exc, ValueError) else type(exc).__name__)
            print(f'acme_reconciliation_failed type={type(exc).__name__} retry_seconds={retry}', flush=True)
            time.sleep(retry)
            retry = min(retry * 2, 3600)


if __name__ == '__main__':
    raise SystemExit(main())
