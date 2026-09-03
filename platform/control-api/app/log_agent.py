from __future__ import annotations

import hmac
import json
import os
from typing import Any

import httpx
from fastapi import FastAPI, Header, HTTPException, Query

DOCKER_SOCKET = os.getenv("DOCKER_SOCKET", "/var/run/docker.sock")
DOCKER_API_URL = os.getenv("DOCKER_API_URL", "").rstrip("/")
INTERNAL_TOKEN = os.getenv("INTERNAL_SERVICES_PASSWORD", "")
COMPOSE_PROJECT_NAME = os.getenv("COMPOSE_PROJECT_NAME", "connect-api-platform")
DOCKER_API_VERSION = os.getenv("DOCKER_API_VERSION", "v1.41")
LOG_AGENT_PORT = int(os.getenv("LOG_AGENT_PORT", "8091"))

app = FastAPI(title="Connect|API Log Agent", docs_url=None, redoc_url=None, openapi_url=None)


def _authorize(value: str | None) -> None:
    if not INTERNAL_TOKEN or not value or not hmac.compare_digest(value, INTERNAL_TOKEN):
        raise HTTPException(status_code=401, detail="Acesso negado.")


def _client() -> httpx.AsyncClient:
    if DOCKER_API_URL:
        return httpx.AsyncClient(base_url=DOCKER_API_URL, timeout=90.0)
    transport = httpx.AsyncHTTPTransport(uds=DOCKER_SOCKET)
    return httpx.AsyncClient(transport=transport, base_url="http://docker", timeout=90.0)


def _project_filter() -> str:
    return json.dumps({"label": [f"com.docker.compose.project={COMPOSE_PROJECT_NAME}"]}, separators=(",", ":"))


def _decode_logs(content: bytes) -> list[str]:
    if not content:
        return []
    lines: list[str] = []
    position = 0
    multiplexed = len(content) >= 8 and content[0] in {0, 1, 2} and content[1:4] == b"\x00\x00\x00"
    if multiplexed:
        while position + 8 <= len(content):
            size = int.from_bytes(content[position + 4 : position + 8], "big")
            start = position + 8
            end = start + size
            if end > len(content):
                break
            chunk = content[start:end].decode("utf-8", errors="replace")
            lines.extend(chunk.splitlines())
            position = end
    else:
        lines = content.decode("utf-8", errors="replace").splitlines()
    return lines


def _safe_container_name(value: str) -> str:
    return value.lstrip("/")[:200]


async def _docker_ping() -> dict[str, Any]:
    """Valida o proxy usando o mesmo recurso somente leitura liberado ao agente."""
    async with _client() as client:
        response = await client.get(
            f"/{DOCKER_API_VERSION}/containers/json",
            params={"all": "false", "limit": "1"},
        )
        response.raise_for_status()
        return {
            "ok": True,
            "api_version": response.headers.get("API-Version"),
        }


async def _containers() -> list[dict[str, Any]]:
    async with _client() as client:
        response = await client.get(
            f"/{DOCKER_API_VERSION}/containers/json",
            params={"all": "true", "filters": _project_filter()},
        )
        response.raise_for_status()
        rows = response.json()

    result: list[dict[str, Any]] = []
    for item in rows if isinstance(rows, list) else []:
        labels = item.get("Labels") or {}
        names = item.get("Names") or []
        container_id = str(item.get("Id") or "")
        inspect: dict[str, Any] = {}
        try:
            async with _client() as client:
                inspect_response = await client.get(f"/{DOCKER_API_VERSION}/containers/{container_id}/json")
                if inspect_response.status_code < 400:
                    inspect = inspect_response.json() if inspect_response.content else {}
        except (httpx.HTTPError, OSError):
            inspect = {}
        state = inspect.get("State") if isinstance(inspect.get("State"), dict) else {}
        health = state.get("Health") if isinstance(state.get("Health"), dict) else {}
        result.append(
            {
                "id": container_id,
                "name": _safe_container_name(str(names[0] if names else labels.get("com.docker.compose.service") or "container")),
                "service": str(labels.get("com.docker.compose.service") or ""),
                "project": str(labels.get("com.docker.compose.project") or ""),
                "image": str(item.get("Image") or ""),
                "state": str(item.get("State") or state.get("Status") or "UNKNOWN").lower(),
                "status": str(item.get("Status") or ""),
                "health": health.get("Status"),
                "restart_count": int(inspect.get("RestartCount") or 0),
                "started_at": state.get("StartedAt"),
                "finished_at": state.get("FinishedAt"),
                "exit_code": state.get("ExitCode"),
                "oom_killed": bool(state.get("OOMKilled", False)),
                "error": state.get("Error"),
                "created": item.get("Created"),
            }
        )
    return sorted(result, key=lambda row: (row["service"], row["name"]))


async def _resolve_container(container: str) -> dict[str, Any]:
    normalized = container.strip()
    for item in await _containers():
        if normalized in {item["id"], item["id"][:12], item["name"], item["service"]}:
            return item
    raise HTTPException(status_code=404, detail="Serviço não encontrado no projeto Docker.")


@app.get("/health")
async def health() -> dict[str, Any]:
    # Health não entrega logs nem inventário e não é publicado no host. Deixá-lo
    # sem autenticação permite ao próprio Docker verificar o processo sem colocar
    # o segredo interno em comandos de healthcheck/inspect.
    try:
        docker = await _docker_ping()
        return {"status": "ok" if docker["ok"] else "degraded", "docker": docker}
    except (httpx.HTTPError, OSError) as exc:
        raise HTTPException(status_code=503, detail="Docker indisponível para leitura de logs.") from exc


@app.get("/containers")
async def containers(x_internal_token: str | None = Header(default=None, alias="X-Internal-Token")) -> list[dict[str, Any]]:
    _authorize(x_internal_token)
    try:
        return await _containers()
    except (httpx.HTTPError, OSError) as exc:
        raise HTTPException(status_code=503, detail="Docker indisponível para leitura de containers.") from exc


@app.get("/logs/{container}")
async def logs(
    container: str,
    x_internal_token: str | None = Header(default=None, alias="X-Internal-Token"),
    tail: int = Query(default=500, ge=1, le=5000),
    since: int | None = Query(default=None, ge=0),
    search: str | None = Query(default=None, max_length=300),
    all_lines: bool = Query(default=False),
) -> dict[str, Any]:
    _authorize(x_internal_token)
    item = await _resolve_container(container)
    params: dict[str, str] = {
        "stdout": "true",
        "stderr": "true",
        "timestamps": "true",
        "tail": "all" if all_lines else str(tail),
    }
    if since is not None:
        params["since"] = str(since)
    try:
        async with _client() as client:
            response = await client.get(f"/{DOCKER_API_VERSION}/containers/{item['id']}/logs", params=params)
            response.raise_for_status()
            lines = _decode_logs(response.content)
    except (httpx.HTTPError, OSError) as exc:
        raise HTTPException(status_code=503, detail="Não foi possível ler os logs do serviço.") from exc

    if search:
        term = search.casefold()
        lines = [line for line in lines if term in line.casefold()]
    if not all_lines:
        lines = lines[-tail:]
    return {"container": item, "lines": lines, "count": len(lines), "all_lines": all_lines}


if __name__ == "__main__":
    import uvicorn

    uvicorn.run(app, host="0.0.0.0", port=LOG_AGENT_PORT, access_log=False)
