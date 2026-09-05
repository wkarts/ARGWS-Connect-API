"""Verify only persisted platform subdomains; no zone sweep and no per-client DNS creation."""
from __future__ import annotations

from datetime import UTC, datetime

from app.core.config import settings
from app.core.errors import APIError
from app.providers.cloudflare import CloudflareDNSProvider
from app.services.tls_status import covers, fresh, receipt


async def reconcile_known_subdomain(domain, *, provider=None, force: bool = False) -> bool:
    name = domain.hostname.lower().rstrip('.')
    root = settings.tenant_domain_root.lower().rstrip('.')
    metadata = dict(domain.provider_metadata or {})
    proof = receipt('dns.json')
    fingerprint = proof.get('origin_fingerprint')
    previous = metadata.get('managed_dns', {})
    if not force and (previous.get('status') == 'READY' and previous.get('hostname') == name
                      and previous.get('origin_fingerprint') == fingerprint and fingerprint
                      and fresh(previous, 300)):
        return True
    try:
        if (domain.management_mode != 'PLATFORM_SUBDOMAIN' or not covers('*.' + root, name)
                or name in {settings.control_plane_host, settings.api_host, settings.platform_domain}):
            raise ValueError('DOMAIN_OUTSIDE_MANAGED_CUSTOMER_SCOPE')
        if proof.get('status') != 'READY' or not fresh(proof, settings.platform_dns_receipt_max_age):
            raise ValueError('WILDCARD_DNS_PROOF_PENDING')
        if not fingerprint or not proof.get('origin'):
            raise ValueError('WILDCARD_DNS_PROOF_REQUIRES_SERVICE_UPDATE')
        if not any(covers(p, name) for p in proof.get('domains', [])):
            raise ValueError('DOMAIN_NOT_COVERED_BY_DNS_PROOF')
        desired = [(str(kind), str(value)) for kind, value in proof['origin']]
        if any(kind not in {'A', 'AAAA', 'CNAME'} or value == name for kind, value in desired):
            raise ValueError('INVALID_MANAGED_DNS_ORIGIN')
        provider = provider or CloudflareDNSProvider()
        # TLS automation has its own opt-in; the legacy financial provider flag is not required.
        if settings.platform_tls_automation_enabled:
            provider.enabled = True
        zone_id = None
        if settings.cloudflare_zone_id:
            zone = await provider.zone_details(settings.cloudflare_zone_id)
            if name == zone['name'] or name.endswith('.' + zone['name']):
                if zone['status'] != 'ACTIVE': raise ValueError('DNS_ZONE_NOT_ACTIVE')
                zone_id = zone['id']
        if not zone_id:
            labels = name.split('.')
            for i in range(len(labels) - 1):
                suffix = '.'.join(labels[i:])
                zones = await provider.list_zones(suffix)
                zone = next((z for z in zones if z.get('name') == suffix and z.get('status') == 'active'), None)
                if zone:
                    zone_id = zone['id']
                    break
        if not zone_id: raise ValueError('DNS_ZONE_NOT_AUTHORIZED')
        rows = await provider.list_records(name, zone_id=zone_id)
        if len(rows) >= 100: raise ValueError('LEGACY_DNS_TOO_MANY_RECORDS')
        if any(str(r.get('name', '')).lower() != name for r in rows): raise ValueError('DNS_SCOPE_MISMATCH')
        addresses = [r for r in rows if r['type'] in {'A', 'AAAA', 'CNAME'}]
        if rows and not addresses:
            raise ValueError('EXACT_DNS_NODE_SHADOWS_WILDCARD')
        if addresses:
            if len(addresses) != len(desired): raise ValueError('LEGACY_DNS_RECORD_CONFLICT')
            unused = list(addresses)
            for kind, content in desired:
                row = next((r for r in unused if r['type'] == kind), None)
                if row is None and len(unused) == 1 and len(desired) == 1: row = unused[0]
                if row is None: raise ValueError('LEGACY_DNS_RECORD_CONFLICT')
                unused.remove(row)
                if row.get('proxied') is not False or row['type'] != kind or row['content'].rstrip('.') != content:
                    await provider._request('PUT', f'/zones/{zone_id}/dns_records/{row["id"]}', payload={
                        'type': kind, 'name': name, 'content': content, 'proxied': False, 'ttl': 1})
            confirmed = [r for r in await provider.list_records(name, zone_id=zone_id) if r['type'] in {'A','AAAA','CNAME'}]
            if (sorted((r['type'], r['content'].rstrip('.')) for r in confirmed) != sorted(desired)
                    or any(r.get('proxied') is not False for r in confirmed)):
                raise ValueError('LEGACY_DNS_READBACK_MISMATCH')
        metadata['managed_dns'] = {'status': 'READY', 'hostname': name, 'zone_id': zone_id,
            'origin_fingerprint': fingerprint, 'mode': 'EXACT_RECONCILED' if addresses else 'WILDCARD',
            'checked_at': datetime.now(UTC).isoformat()}
        domain.dns_proxied = False
        domain.provider_metadata = metadata
        return True
    except Exception as exc:
        code = exc.code if isinstance(exc, APIError) else str(exc) if isinstance(exc, ValueError) else type(exc).__name__
        metadata['managed_dns'] = {'status': 'PENDING', 'hostname': name, 'error': code[:120],
                                   'checked_at': datetime.now(UTC).isoformat()}
        domain.provider_metadata = metadata
        return False
