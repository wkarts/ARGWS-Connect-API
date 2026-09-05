"""Shared contract used inside ACME and CloudPanel service images (no host setup)."""
from __future__ import annotations

import hashlib
import json
import os
import re
import ssl
import subprocess
import time
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

from cryptography import x509
from cryptography.hazmat.primitives import serialization

FILES = ("privkey.pem", "cert.pem", "ca.pem", "fullchain.pem")


def hostname(value: str, wildcard: bool = False) -> str:
    name = value.strip().rstrip('.').lower()
    raw = name[2:] if wildcard and name.startswith('*.') else name
    if len(name) > 253 or '.' not in raw or any(not re.fullmatch(r'[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?', label) for label in raw.split('.')):
        raise ValueError('INVALID_DOMAIN')
    return name


def covers(pattern: str, name: str) -> bool:
    return pattern == name or (pattern.startswith('*.') and name.endswith(pattern[1:]) and name.count('.') == pattern.count('.'))


def configured_names(env=None) -> list[str]:
    env = os.environ if env is None else env
    root = hostname(env.get('ACME_DOMAIN') or env.get('CLOUDPANEL_SITE_DOMAIN', ''))
    names = [root, '*.' + root]
    tenant_root = env.get('TENANT_DOMAIN_ROOT')
    if tenant_root:
        names += [hostname(tenant_root), '*.' + hostname(tenant_root)]
    for key in ('PLATFORM_DOMAIN', 'CONTROL_PLANE_HOST', 'ADMIN_HOST', 'PARTNER_PLANE_HOST', 'API_HOST', 'DOCS_HOST', 'DEMO_HOST'):
        if env.get(key): names.append(hostname(env[key]))
    names += [hostname(name, wildcard=True) for name in env.get('ACME_ADDITIONAL_DOMAINS', '').split(',') if name.strip()]
    result = list(dict.fromkeys(names))
    if len(result) > 100: raise ValueError('CERTIFICATE_SAN_LIMIT')
    return result


def state(path: Path, **values) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + '.tmp')
    temporary.write_text(json.dumps({'checked_at': datetime.now(timezone.utc).isoformat(), **values}), encoding='utf-8')
    temporary.chmod(0o644)
    os.replace(temporary, path)


def run(argv: list[str], timeout: int = 120) -> subprocess.CompletedProcess:
    # CA/CLI output may contain sensitive data. Never dump it into central logs.
    result = subprocess.run(argv, stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=timeout, check=False)
    if result.returncode:
        raise RuntimeError(f'{Path(argv[0]).name}_EXIT_{result.returncode}')
    return result


def bundle(path: Path, required: list[str], check_key: bool = True) -> dict:
    cert = x509.load_pem_x509_certificate((path / 'fullchain.pem').read_bytes())
    leaf = x509.load_pem_x509_certificate((path / 'cert.pem').read_bytes())
    if cert.public_bytes(serialization.Encoding.DER) != leaf.public_bytes(serialization.Encoding.DER):
        raise ValueError('CERTIFICATE_CHAIN_LEAF_MISMATCH')
    try:
        sans = cert.extensions.get_extension_for_class(x509.SubjectAlternativeName).value.get_values_for_type(x509.DNSName)
    except x509.ExtensionNotFound as exc:
        raise ValueError('CERTIFICATE_SAN_MISSING') from exc
    now = datetime.now(timezone.utc)
    if cert.not_valid_before_utc > now or cert.not_valid_after_utc <= now: raise ValueError('CERTIFICATE_EXPIRED_OR_NOT_YET_VALID')
    if not all(any(covers(pattern, name) for pattern in sans) for name in required): raise ValueError('CERTIFICATE_SAN_MISMATCH')
    if check_key:
        key = serialization.load_pem_private_key((path / 'privkey.pem').read_bytes(), password=None)
        def public(obj): return obj.public_key().public_bytes(serialization.Encoding.DER, serialization.PublicFormat.SubjectPublicKeyInfo)
        if public(cert) != public(key): raise ValueError('CERTIFICATE_KEY_MISMATCH')
    return {'sans': sans, 'expires_at': cert.not_valid_after_utc.isoformat(),
            'days_remaining': int((cert.not_valid_after_utc - now).total_seconds() // 86400),
            'fingerprint': hashlib.sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest()}


def served_fingerprint(name: str, address: str = '127.0.0.1', port: int = 443) -> str:
    import socket
    context = ssl.create_default_context(cafile=os.environ.get('TLS_CA_FILE') or None)
    with socket.create_connection((address, port), timeout=5) as raw:
        with context.wrap_socket(raw, server_hostname=name) as connection:
            return hashlib.sha256(connection.getpeercert(binary_form=True)).hexdigest()


def check_health(status: Path, max_age: int) -> None:
    payload = json.loads(status.read_text())
    if payload.get('status') == 'DISABLED': return
    if payload.get('status') != 'READY' or time.time() - status.stat().st_mtime > max_age:
        raise ValueError('TLS_SERVICE_NOT_READY')
    if datetime.fromisoformat(payload['expires_at']) <= datetime.now(timezone.utc):
        raise ValueError('CERTIFICATE_EXPIRED')


def enabled() -> bool:
    return os.environ.get('PLATFORM_TLS_AUTOMATION_ENABLED', 'true').strip().lower() in {'true', '1', 'yes'}


def verify_chain(directory: Path) -> None:
    run(['openssl', 'verify', '-CAfile', os.environ.get('TLS_CA_FILE', '/etc/ssl/certs/ca-certificates.crt'),
         '-untrusted', str(directory/'ca.pem'), str(directory/'cert.pem')])
