"""Read public TLS receipts; private certificate keys are never mounted in the API."""
from __future__ import annotations

import json
from datetime import UTC, datetime
from pathlib import Path

from app.core.config import settings
from app.core.tls_diagnostics import error_code, error_details


def covers(pattern: str, name: str) -> bool:
    return pattern == name or (pattern.startswith('*.') and name.endswith(pattern[1:]) and name.count('.') == pattern.count('.'))


def receipt(filename: str) -> dict:
    if filename not in {'dns.json', 'acme.json', 'cloudpanel.json'}:
        return {}
    path = settings.platform_tls_status_dir / filename
    try:
        with path.open('rb') as handle:
            raw = handle.read(131073)
        if len(raw) > 131072: return {}
        data = json.loads(raw)
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



def dns_blocking_reason(proof: dict | None = None) -> str:
    """Preserve the service's safe cause, including receipts from earlier images."""
    proof = receipt('dns.json') if proof is None else proof
    acme = receipt('acme.json')
    age = settings.platform_dns_receipt_max_age
    if proof.get('status') == 'READY' and not fresh(proof, age):
        return 'TLS_STATUS_STALE'
    for item in (proof, acme):
        if not fresh(item, age): continue
        if item.get('status') == 'DISABLED': return 'TLS_AUTOMATION_DISABLED'
        code = error_code(item.get('error', ''))
        if code != 'TLS_UNEXPECTED_ERROR': return code
    if not proof and not acme: return 'TLS_STATUS_MISSING'
    if not any(fresh(item, age) for item in (proof, acme)):
        return 'TLS_STATUS_STALE'
    return 'WILDCARD_DNS_PROOF_PENDING'


def diagnostic_summary() -> dict:
    """Control-plane presentation/export only. Never return env, PEMs, full receipts or raw messages."""
    states = {'READY', 'ISSUING', 'DISABLED', 'STAGING', 'WAITING_CERTIFICATE', 'RECONCILIATION_FAILED'}
    stages = {'configuration', 'dns', 'account', 'issuance', 'host', 'installation'}
    reports = {}
    for filename in ('dns.json', 'acme.json', 'cloudpanel.json'):
        data = receipt(filename)
        limit = settings.platform_tls_receipt_max_age if filename == 'cloudpanel.json' else settings.platform_dns_receipt_max_age
        status = data.get('status') if isinstance(data.get('status'), str) and data['status'] in states else 'UNKNOWN'
        item = {'present': bool(data), 'status': status, 'fresh': fresh(data, limit),
                'stage': data.get('stage') if isinstance(data.get('stage'), str) and data['stage'] in stages else None}
        if data.get('error'): item.update(error_details(data['error']))
        if not data: item.update(error_details('TLS_STATUS_MISSING'))
        for field in ('checked_at', 'expires_at', 'last_installed_at', 'last_verified_at'):
            try:
                value = datetime.fromisoformat(data[field])
                if value.tzinfo is not None: item[field] = value.isoformat()
            except (KeyError, ValueError, TypeError): pass
        reports[filename.removesuffix('.json')] = item
    return {'operator_files': ['compose.yaml', '.env'], 'generated_by_services': True,
            'requires_manual_proof': False, 'services': reports}


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
    if not dns_ready:
        blocker = dns_blocking_reason(dns)
    elif not tls_ready:
        blocker = next((error_code(item.get('error')) for item in (acme, installed)
                        if item.get('error') and error_code(item.get('error')) != 'TLS_UNEXPECTED_ERROR'), 'CERTIFICATE_NOT_READY')
    else:
        blocker = None
    return {'hostname': name, 'dns_ready': bool(dns_ready), 'tls_ready': tls_ready,
            'acme_status': acme.get('status', 'WAITING_SERVICE'),
            'cloudpanel_status': installed.get('status', 'WAITING_SERVICE'),
            'expires_at': installed.get('expires_at'), 'fingerprint': installed.get('fingerprint'),
            'last_error': blocker}


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
    proof = dict(getattr(domain, 'provider_metadata', None) or {}).get('managed_dns', {})
    if getattr(domain, 'management_mode', None) == 'PLATFORM_SUBDOMAIN':
        status['dns_ready'] = bool(status['dns_ready'] and proof.get('status') == 'READY'
            and proof.get('hostname') == domain.hostname and fresh(proof, 600)
            and proof.get('origin_fingerprint') == receipt('dns.json').get('origin_fingerprint'))
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
    contradiction = proof.get('error') in {'LEGACY_DNS_RECORD_CONFLICT', 'LEGACY_DNS_READBACK_MISMATCH',
        'EXACT_DNS_NODE_SHADOWS_WILDCARD', 'DNS_SCOPE_MISMATCH', 'DOMAIN_OUTSIDE_MANAGED_CUSTOMER_SCOPE',
        'DOMAIN_NOT_COVERED_BY_DNS_PROOF'}
    if not ready and domain.status == 'ACTIVE' and still_valid and not contradiction:
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
        reason = error_details(proof.get('error') or status.get('last_error') or 'WILDCARD_DNS_PROOF_PENDING')
        domain.last_error = reason['message'] + ' (' + reason['error'] + ')'
