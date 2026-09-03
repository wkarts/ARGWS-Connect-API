#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import tempfile
import urllib.error
import urllib.request
from pathlib import Path

HOSTNAME_RE = re.compile(r"^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$")
MANAGED_DOMAIN_STATUSES = {"WAITING_SSL", "ACTIVE"}


def request_json(url: str, token: str, method: str = "GET") -> dict:
    request = urllib.request.Request(url, method=method, headers={"X-Domain-Agent-Token": token, "Accept": "application/json"})
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"HTTP {exc.code} em {url}: {body[-1000:]}") from exc


def run(*args: str) -> None:
    subprocess.run(args, check=True)


def http_config(hostname: str, upstream: str, webroot: Path) -> str:
    return f'''# Gerado pelo Connect|API Domain Agent. Não editar manualmente.
server {{
    listen 80;
    listen [::]:80;
    server_name {hostname};
    client_max_body_size 100m;

    location ^~ /.well-known/acme-challenge/ {{
        root {webroot};
        default_type text/plain;
    }}

    location / {{
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header X-Request-ID $request_id;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
        proxy_pass {upstream};
    }}
}}
'''


def https_config(hostname: str, upstream: str, webroot: Path) -> str:
    cert = f"/etc/letsencrypt/live/{hostname}"
    return f'''# Gerado pelo Connect|API Domain Agent. Não editar manualmente.
server {{
    listen 80;
    listen [::]:80;
    server_name {hostname};
    location ^~ /.well-known/acme-challenge/ {{ root {webroot}; }}
    location / {{ return 301 https://$host$request_uri; }}
}}

server {{
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name {hostname};
    client_max_body_size 100m;

    ssl_certificate {cert}/fullchain.pem;
    ssl_certificate_key {cert}/privkey.pem;
    ssl_protocols TLSv1.2 TLSv1.3;
    ssl_session_cache shared:SSL:20m;
    ssl_session_timeout 1d;
    add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;

    location / {{
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto https;
        proxy_set_header X-Request-ID $request_id;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 120s;
        proxy_pass {upstream};
    }}
}}
'''


def atomic_write(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with tempfile.NamedTemporaryFile("w", encoding="utf-8", dir=path.parent, delete=False) as handle:
        handle.write(content)
        temp = Path(handle.name)
    temp.chmod(0o640)
    temp.replace(path)


def main() -> int:
    parser = argparse.ArgumentParser(description="Reconcilia domínios personalizados e certificados ACME da plataforma financeira.")
    parser.add_argument("--control-url", default=os.getenv("CONTROL_PLANE_URL", ""))
    parser.add_argument("--token", default=os.getenv("DOMAIN_RECONCILIATION_TOKEN", ""))
    parser.add_argument("--output-dir", type=Path, default=Path(os.getenv("NGINX_INCLUDE_DIR", "/etc/nginx/conf.d/multitenant-app-tenants")))
    parser.add_argument("--webroot", type=Path, default=Path(os.getenv("ACME_WEBROOT", "/var/www/letsencrypt")))
    parser.add_argument("--upstream", default=os.getenv("GATEWAY_UPSTREAM", "http://127.0.0.1:8800"))
    parser.add_argument("--email", default=os.getenv("ACME_EMAIL", ""))
    parser.add_argument("--certbot", default=os.getenv("CERTBOT_BIN", "certbot"))
    parser.add_argument("--nginx", default=os.getenv("NGINX_BIN", "nginx"))
    parser.add_argument("--reload-command", default=os.getenv("NGINX_RELOAD_COMMAND", "systemctl reload nginx"))
    parser.add_argument("--staging", action="store_true", default=os.getenv("ACME_STAGING", "false").lower() == "true")
    parser.add_argument("--no-certificates", action="store_true")
    args = parser.parse_args()
    if not args.control_url or not args.token:
        raise SystemExit("CONTROL_PLANE_URL e DOMAIN_RECONCILIATION_TOKEN são obrigatórios.")
    if not args.no_certificates and not args.email:
        raise SystemExit("ACME_EMAIL é obrigatório para emissão automática.")

    args.webroot.mkdir(parents=True, exist_ok=True)
    feed_url = args.control_url.rstrip("/") + "/api/control/v1/agent/domains"
    data = request_json(feed_url, args.token).get("data", {})
    domains = data.get("domains", [])
    active: set[str] = set()
    for item in domains:
        hostname = str(item.get("hostname", "")).lower().rstrip(".")
        if item.get("status") not in MANAGED_DOMAIN_STATUSES or not HOSTNAME_RE.fullmatch(hostname):
            continue
        active.add(hostname)
        config_path = args.output_dir / f"{hostname}.conf"
        cert_path = Path("/etc/letsencrypt/live") / hostname / "fullchain.pem"
        atomic_write(config_path, https_config(hostname, args.upstream, args.webroot) if cert_path.exists() else http_config(hostname, args.upstream, args.webroot))

    for path in args.output_dir.glob("*.conf"):
        if path.stem not in active:
            path.unlink(missing_ok=True)

    run(args.nginx, "-t")
    run(*args.reload_command.split())

    if not args.no_certificates:
        for hostname in sorted(active):
            cert_path = Path("/etc/letsencrypt/live") / hostname / "fullchain.pem"
            command = [
                args.certbot, "certonly", "--webroot", "-w", str(args.webroot),
                "-d", hostname, "--non-interactive", "--agree-tos", "--keep-until-expiring",
                "--email", args.email,
            ]
            if args.staging:
                command.append("--staging")
            run(*command)
            if cert_path.exists():
                atomic_write(args.output_dir / f"{hostname}.conf", https_config(hostname, args.upstream, args.webroot))
                mark_url = args.control_url.rstrip("/") + f"/api/control/v1/agent/domains/{hostname}/ssl-active"
                request_json(mark_url, args.token, method="POST")
        run(args.nginx, "-t")
        run(*args.reload_command.split())
    print(json.dumps({"domains_active": sorted(active), "count": len(active)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
