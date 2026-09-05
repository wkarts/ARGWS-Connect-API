"""Reconcile only the operator-configured Platform namespace in Cloudflare.

ACME TXT creation/removal remains owned by acme.sh's dns_cf provider. This
service reconciles public address records, always DNS-only, without a host script.
"""
from __future__ import annotations

import ipaddress
import json
import os
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, ProxyHandler, HTTPRedirectHandler, build_opener

from tls_common import hostname


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


class CloudflareDNS:
    def __init__(self, env=None):
        self.env = os.environ if env is None else env
        self.token = self.env.get('CLOUDFLARE_API_TOKEN') or self.env.get('CF_Token', '')
        self.zones: dict[str, str] = {}
        if not self.token or self.token.startswith('CHANGE_ME'):
            raise ValueError('CLOUDFLARE_TOKEN_REQUIRED')
        self.opener = build_opener(ProxyHandler({}), NoRedirect())

    def request(self, method: str, path: str, params=None, body=None):
        url = 'https://api.cloudflare.com/client/v4/' + path.lstrip('/')
        if params: url += '?' + urlencode(params)
        request = Request(url, method=method,
                          data=json.dumps(body).encode() if body is not None else None,
                          headers={'Authorization': 'Bearer ' + self.token, 'Content-Type': 'application/json'})
        try:
            with self.opener.open(request, timeout=20) as response:
                raw = response.read(2_000_001)
            if len(raw) > 2_000_000: raise ValueError('CLOUDFLARE_RESPONSE_TOO_LARGE')
            result = json.loads(raw)
        except HTTPError as exc:
            raise ValueError(f'CLOUDFLARE_HTTP_{exc.code}') from None
        except (URLError, TimeoutError):
            raise ValueError('CLOUDFLARE_UNAVAILABLE') from None
        if not isinstance(result, dict) or result.get('success') is not True:
            raise ValueError('CLOUDFLARE_OPERATION_FAILED')
        return result.get('result')

    def zone(self, name: str) -> str:
        name = name.removeprefix('*.')
        for suffix, zone in sorted(self.zones.items(), key=lambda item: len(item[0]), reverse=True):
            if name == suffix or name.endswith('.' + suffix): return zone
        configured = self.env.get('CLOUDFLARE_ZONE_ID', '')
        if configured:
            if not configured.isalnum(): raise ValueError('INVALID_CLOUDFLARE_ZONE_ID')
            row = self.request('GET', 'zones/' + configured)
            root = str(row.get('name', '')).lower()
            if root and (name == root or name.endswith('.' + root)):
                if str(row.get('status', '')).lower() != 'active': raise ValueError('CLOUDFLARE_ZONE_NOT_ACTIVE')
                self.zones[root] = configured
                return configured
        labels = name.split('.')
        for index in range(len(labels)-1):
            suffix = '.'.join(labels[index:])
            rows = self.request('GET', 'zones', {'name': suffix, 'per_page': 50}) or []
            row = next((r for r in rows if r.get('name', '').lower() == suffix and r.get('status') == 'active'), None)
            if row:
                self.zones[suffix] = row['id']
                return row['id']
        raise ValueError('CLOUDFLARE_ZONE_NOT_AUTHORIZED')

    def records(self, name: str) -> list[dict]:
        rows = self.request('GET', f'zones/{self.zone(name)}/dns_records', {'name': name, 'per_page': 100}) or []
        return [r for r in rows if str(r.get('name', '')).lower() == name.lower() and r.get('type') in {'A', 'AAAA', 'CNAME'}]

    def origin(self, root: str) -> list[tuple[str, str]]:
        configured = self.env.get('CLOUDFLARE_TENANT_RECORD_TARGET', '').strip().rstrip('.')
        if configured and configured != root:
            try:
                ip = ipaddress.ip_address(configured)
                return [('A' if ip.version == 4 else 'AAAA', str(ip))]
            except ValueError:
                target = hostname(configured)
                # An explicit external DNS origin is supported; a self-referencing alias is not.
                return [('CNAME', target)]
        rows = self.records(root)
        values = [(r['type'], r['content'].rstrip('.')) for r in rows]
        if not values: raise ValueError('PLATFORM_ORIGIN_DNS_MISSING')
        return list(dict.fromkeys(values))

    def ensure(self, name: str, desired: list[tuple[str, str]]) -> list[dict]:
        zone = self.zone(name)
        existing = self.records(name)
        if len(existing) > len(desired):
            raise ValueError("PLATFORM_DNS_RECORD_CONFLICT")
        desired_types = {kind for kind, _ in desired}
        # Multiple conflicting address records are not silently deleted. Keep the last state.
        if any(row['type'] not in desired_types for row in existing) and (len(existing) > 1 or len(desired) > 1):
            raise ValueError('PLATFORM_DNS_RECORD_CONFLICT')
        output = []
        used = set()
        for kind, content in desired:
            if kind == 'CNAME' and content == name: raise ValueError('PLATFORM_DNS_CNAME_LOOP')
            row = next((r for r in existing if r['id'] not in used and r['type'] == kind and r['content'].rstrip('.') == content), None)
            if row is None:
                row = next((r for r in existing if r['id'] not in used and r['type'] == kind), None)
            if row is None and len(existing) == 1 and len(desired) == 1: row = existing[0]
            body = {'name': name, 'type': kind, 'content': content, 'ttl': 1, 'proxied': False}
            if row:
                used.add(row['id'])
                if any(row.get(k) != v for k, v in body.items() if k != 'ttl'):
                    self.request('PUT', f'zones/{zone}/dns_records/{row["id"]}', body=body)
            else:
                self.request('POST', f'zones/{zone}/dns_records', body=body)
            output.append({'name': name, 'type': kind, 'proxied': False})
        return output


def reconcile_dns(names: list[str], env=None, client=None) -> list[dict]:
    client = client or CloudflareDNS(env)
    origin = client.origin(names[0])
    if any(kind == "CNAME" and content in names for kind, content in origin):
        raise ValueError("PLATFORM_DNS_CNAME_LOOP")
    result = []
    for name in names: result.extend(client.ensure(name, origin))
    return result
