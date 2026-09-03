#!/usr/bin/env python3
"""Cria ou atualiza uma stack Portainer usando a API oficial.

O utilitário usa apenas a biblioteca padrão para também funcionar no servidor
antes da instalação das dependências Python da aplicação.
"""
from __future__ import annotations

import argparse
import json
import ssl
import sys
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any


def parse_env(path: Path) -> list[dict[str, str]]:
    values: list[dict[str, str]] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        line = raw.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        key = key.strip()
        if key:
            values.append({"name": key, "value": value.strip()})
    return values


def request_json(
    method: str,
    url: str,
    api_key: str,
    payload: dict[str, Any] | None = None,
    insecure: bool = False,
) -> Any:
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        url,
        method=method,
        data=data,
        headers={
            "X-API-Key": api_key,
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )
    context = ssl._create_unverified_context() if insecure else ssl.create_default_context()
    try:
        with urllib.request.urlopen(request, context=context, timeout=60) as response:
            body = response.read()
            return json.loads(body.decode("utf-8")) if body else None
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"Portainer respondeu HTTP {exc.code}: {body[:1000]}") from exc
    except urllib.error.URLError as exc:
        raise RuntimeError(f"Não foi possível conectar ao Portainer: {exc.reason}") from exc


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", required=True)
    parser.add_argument("--api-key", required=True)
    parser.add_argument("--endpoint-id", required=True, type=int)
    parser.add_argument("--stack-name", required=True)
    parser.add_argument("--stack-file", required=True, type=Path)
    parser.add_argument("--env-file", required=True, type=Path)
    parser.add_argument("--insecure", action="store_true")
    args = parser.parse_args()

    base = args.url.rstrip("/")
    stack_content = args.stack_file.read_text(encoding="utf-8")
    env = parse_env(args.env_file)
    endpoint = urllib.parse.quote(str(args.endpoint_id))

    stacks = request_json(
        "GET",
        f"{base}/api/stacks?endpointId={endpoint}",
        args.api_key,
        insecure=args.insecure,
    )
    current = next((item for item in stacks or [] if item.get("Name") == args.stack_name), None)
    if current:
        stack_id = current["Id"]
        request_json(
            "PUT",
            f"{base}/api/stacks/{stack_id}?endpointId={endpoint}",
            args.api_key,
            {
                "stackFileContent": stack_content,
                "env": env,
                "prune": True,
                "pullImage": True,
            },
            insecure=args.insecure,
        )
        print(f"Stack '{args.stack_name}' atualizada (ID {stack_id}).")
    else:
        created = request_json(
            "POST",
            f"{base}/api/stacks/create/standalone/string?endpointId={endpoint}",
            args.api_key,
            {
                "name": args.stack_name,
                "stackFileContent": stack_content,
                "env": env,
                "fromAppTemplate": False,
            },
            insecure=args.insecure,
        )
        print(f"Stack '{args.stack_name}' criada (ID {created.get('Id') if created else '?'}).")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:  # noqa: BLE001
        print(f"ERRO: {exc}", file=sys.stderr)
        raise SystemExit(1)
