"""Read public TLS receipts; private certificate keys are never mounted in the API."""
from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import settings


def covers(pattern: str, name: str) -> bool:
    return pattern == name or (pattern.startswith('*.') and name.endswith(pattern[1:]) and name.count('.') == pattern.count('.'))


def receipt(filename: str) -> dict:
    path = settings.platform_tls_status_dir / filename
    try:
        if path.stat().st_size > 131072: return {}
        data = json.loads(path.read_text())
        return data if isinstance(data, dict) else {}
    except (OSError, ValueError):
        return {}


def fresh(data: dict, seconds: int) -> bool:
    try:
        checked = datetime.fromisoformat(data['checked_at'])
        age = (datetime.now(UTC) - checked).total_seconds()
        return -60 <= age <= seconds
    except (KeyError, ValueError, TypeError):
        return False


def snapshot(name: str) -> dict:
    dns = receipt('dns.json')
    acme = receipt('acme.json')
    installed = receipt('cloudpanel.json')
    dns_ready = (dns.get('status') == 'READY' and fresh(dns, settings.platform_dns_receipt_max_age)
                 and any(covers(pattern, name) for pattern in dns.get('domains', []) if isinstance(pattern, str)))
    tls_ready = False
    try:
        tls_ready = bool(installed.get('status') == 'READY'
                         and fresh(installed, settings.platform_tls_receipt_max_age)
                         and datetime.fromisoformat(installed['expires_at']) > datetime.now(UTC)
                         and any(covers(pattern, name) for pattern in installed.get('sans', []) if isinstance(pattern, str)))
    except (KeyError, ValueError, TypeError):
        pass
    return {'hostname': name, 'dns_ready': bool(dns_ready), 'tls_ready': tls_ready,
            'acme_status': acme.get('status', 'WAITING_SERVICE'),
            'cloudpanel_status': installed.get('status', 'WAITING_SERVICE'),
            'expires_at': installed.get('expires_at'), 'fingerprint': installed.get('fingerprint'),
            'last_error': installed.get('error') or acme.get('error')}


def apply_receipt(domain) -> None:
    """Converge managed subdomains without issuing network requests or inventing ACTIVE."""
    status = snapshot(domain.hostname)
    now = datetime.now(UTC)
    domain.last_checked_at = now
    domain.last_reconciled_at = now
    if settings.public_scheme == 'http':
        domain.status, domain.ssl_status = 'ACTIVE', 'NOT_REQUIRED'
        domain.last_error = None
        return
    if status['dns_ready']:
        domain.dns_verified_at = now
        domain.ownership_verified_at = now
    ready = status['dns_ready'] and status['tls_ready']
    metadata = dict(getattr(domain, 'provider_metadata', None) or {})
    previous = metadata.get('verified_tls', {})
    # Control-plane polling failures must not switch off an already verified site.
    # Never extend the validity of its last actually served certificate.
    try:
        still_valid = datetime.fromisoformat(previous['expires_at']) > now
    except (KeyError, ValueError, TypeError):
        still_valid = False
    if not ready and domain.status == 'ACTIVE' and still_valid:
        domain.ssl_status = 'RECHECK_PENDING'
        domain.last_error = 'Revalidação DNS/SSL pendente; último certificado verificado ainda está válido.'
        return
    domain.ssl_status = 'ACTIVE' if ready else 'PENDING'
    domain.status = 'ACTIVE' if ready else 'WAITING_SSL' if status['dns_ready'] else 'WAITING_DNS'
    if ready:
        metadata['verified_tls'] = {'expires_at': status['expires_at'], 'fingerprint': status['fingerprint'], 'checked_at': now.isoformat()}
        domain.provider_metadata = metadata
        if domain.ssl_issued_at is None: domain.ssl_issued_at = now
        domain.last_error = None
    else:
        domain.last_error = 'Aguardando DNS e certificado verificado pelos serviços ACME/CloudPanel.'
