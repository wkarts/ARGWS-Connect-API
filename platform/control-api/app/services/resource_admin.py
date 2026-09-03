from __future__ import annotations

import asyncio
import re
from dataclasses import dataclass
from typing import Any, Literal

import asyncpg
import httpx
from botocore.exceptions import ClientError

from app.core.config import settings
from app.core.errors import APIError
from app.db.postgres_admin import connect_postgres_admin
from app.providers.storage import S3StorageProvider


_DB_NAME_RE = re.compile(r"^[A-Za-z_][A-Za-z0-9_$-]{0,62}$")


def _safe_mapping(value: Any) -> Any:
    """Remove material sensível de respostas administrativas de terceiros."""
    if isinstance(value, dict):
        result: dict[str, Any] = {}
        for key, item in value.items():
            lowered = str(key).lower()
            if any(token in lowered for token in ("password", "secret", "token", "authorization", "apikey", "api_key")):
                result[str(key)] = "***"
            else:
                result[str(key)] = _safe_mapping(item)
        return result
    if isinstance(value, list):
        return [_safe_mapping(item) for item in value]
    return value


def _confirm(actual: str, expected: str) -> None:
    if actual.strip() != expected:
        raise APIError(
            "RESOURCE_CONFIRMATION_REQUIRED",
            "A confirmação informada não corresponde ao recurso da operação.",
            409,
            {"expected": expected},
        )


@dataclass(slots=True)
class S3AdminService:
    storage: S3StorageProvider

    @classmethod
    def build(cls) -> "S3AdminService":
        return cls(storage=S3StorageProvider())

    async def list_buckets(self) -> list[dict[str, Any]]:
        def action() -> list[dict[str, Any]]:
            response = self.storage.client.list_buckets()
            result: list[dict[str, Any]] = []
            for bucket in response.get("Buckets", []):
                name = str(bucket.get("Name") or "")
                if not name:
                    continue
                try:
                    versioning = self.storage.client.get_bucket_versioning(Bucket=name).get("Status") or "Disabled"
                except ClientError:
                    versioning = "Unknown"
                result.append(
                    {
                        "name": name,
                        "creation_date": bucket.get("CreationDate").isoformat() if bucket.get("CreationDate") else None,
                        "versioning": versioning,
                        "managed": name.startswith(settings.s3_bucket_prefix) or name == settings.backup_s3_bucket,
                    }
                )
            return sorted(result, key=lambda item: item["name"])

        return await asyncio.to_thread(action)

    async def bucket_detail(self, bucket: str, *, sample_limit: int = 1000) -> dict[str, Any]:
        def action() -> dict[str, Any]:
            try:
                self.storage.client.head_bucket(Bucket=bucket)
            except ClientError as exc:
                raise APIError("S3_BUCKET_NOT_FOUND", "Bucket S3/MinIO não encontrado.", 404) from exc

            versioning = self.storage.client.get_bucket_versioning(Bucket=bucket).get("Status") or "Disabled"
            lifecycle: dict[str, Any] | None = None
            policy_configured = False
            try:
                lifecycle = self.storage.client.get_bucket_lifecycle_configuration(Bucket=bucket)
            except ClientError as exc:
                code = str(exc.response.get("Error", {}).get("Code") or "")
                if code not in {"NoSuchLifecycleConfiguration", "NoSuchLifecycle", "NoSuchBucket"}:
                    raise
            try:
                self.storage.client.get_bucket_policy(Bucket=bucket)
                policy_configured = True
            except ClientError as exc:
                code = str(exc.response.get("Error", {}).get("Code") or "")
                if code not in {"NoSuchBucketPolicy", "NoSuchPolicy", "AccessDenied"}:
                    raise

            count = 0
            size = 0
            truncated = False
            token: str | None = None
            while count < sample_limit:
                params: dict[str, Any] = {"Bucket": bucket, "MaxKeys": min(1000, sample_limit - count)}
                if token:
                    params["ContinuationToken"] = token
                page = self.storage.client.list_objects_v2(**params)
                objects = list(page.get("Contents") or [])
                count += len(objects)
                size += sum(int(item.get("Size") or 0) for item in objects)
                if not page.get("IsTruncated"):
                    break
                token = str(page.get("NextContinuationToken") or "") or None
                if not token:
                    break
            else:
                truncated = True
            if token:
                truncated = True

            return {
                "name": bucket,
                "managed": bucket.startswith(settings.s3_bucket_prefix) or bucket == settings.backup_s3_bucket,
                "versioning": versioning,
                "policy_configured": policy_configured,
                "lifecycle": _safe_mapping(lifecycle) if lifecycle else None,
                "object_count_sample": count,
                "object_size_sample": size,
                "sample_truncated": truncated,
            }

        return await asyncio.to_thread(action)

    async def create_bucket(self, bucket: str) -> dict[str, Any]:
        await self.storage.ensure_bucket(bucket)
        return await self.bucket_detail(bucket)

    async def delete_bucket(self, bucket: str, *, confirm: str) -> dict[str, Any]:
        _confirm(confirm, bucket)

        def action() -> dict[str, Any]:
            page = self.storage.client.list_objects_v2(Bucket=bucket, MaxKeys=1)
            if page.get("KeyCount", 0):
                raise APIError(
                    "S3_BUCKET_NOT_EMPTY",
                    "O bucket contém objetos. Remova os objetos antes de excluir o bucket.",
                    409,
                    {"bucket": bucket},
                )
            try:
                self.storage.client.delete_bucket(Bucket=bucket)
            except ClientError as exc:
                raise APIError("S3_BUCKET_DELETE_FAILED", "Não foi possível excluir o bucket.", 409) from exc
            return {"deleted": True, "bucket": bucket}

        return await asyncio.to_thread(action)

    async def set_versioning(self, bucket: str, enabled: bool) -> dict[str, Any]:
        await asyncio.to_thread(
            self.storage.client.put_bucket_versioning,
            Bucket=bucket,
            VersioningConfiguration={"Status": "Enabled" if enabled else "Suspended"},
        )
        return {"bucket": bucket, "versioning": "Enabled" if enabled else "Suspended"}

    async def list_objects(
        self,
        bucket: str,
        *,
        prefix: str = "",
        continuation_token: str | None = None,
        limit: int = 100,
    ) -> dict[str, Any]:
        def action() -> dict[str, Any]:
            params: dict[str, Any] = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": limit}
            if continuation_token:
                params["ContinuationToken"] = continuation_token
            response = self.storage.client.list_objects_v2(**params)
            return {
                "bucket": bucket,
                "prefix": prefix,
                "objects": [
                    {
                        "key": item.get("Key"),
                        "size": int(item.get("Size") or 0),
                        "etag": str(item.get("ETag") or "").strip('"'),
                        "last_modified": item.get("LastModified").isoformat() if item.get("LastModified") else None,
                        "storage_class": item.get("StorageClass"),
                    }
                    for item in response.get("Contents", [])
                ],
                "has_more": bool(response.get("IsTruncated")),
                "next_token": response.get("NextContinuationToken"),
            }

        return await asyncio.to_thread(action)

    async def delete_object(self, bucket: str, key: str, *, confirm: str) -> dict[str, Any]:
        _confirm(confirm, key)
        await self.storage.delete_object(bucket, key)
        return {"deleted": True, "bucket": bucket, "key": key}


class PostgresResourceAdmin:
    @staticmethod
    def _validate_database_name(database: str) -> str:
        value = database.strip()
        if not _DB_NAME_RE.fullmatch(value):
            raise APIError("POSTGRES_DATABASE_INVALID", "Nome de banco PostgreSQL inválido.", 422)
        return value

    @staticmethod
    async def _managed_database(conn: asyncpg.Connection, database: str) -> bool:
        row = await conn.fetchrow("select datname from pg_database where datname=$1 and not datistemplate", database)
        if row is None:
            raise APIError("POSTGRES_DATABASE_NOT_FOUND", "Banco PostgreSQL não encontrado.", 404)
        return database == settings.postgres_db or database.startswith(f"{settings.tenant_db_prefix}_")

    async def overview(self) -> dict[str, Any]:
        conn = await connect_postgres_admin()
        try:
            databases = await conn.fetch(
                """
                select d.datname,
                       pg_get_userbyid(d.datdba) as owner,
                       pg_database_size(d.datname) as size_bytes,
                       coalesce(s.numbackends, 0) as connections,
                       coalesce(s.xact_commit, 0) as xact_commit,
                       coalesce(s.xact_rollback, 0) as xact_rollback,
                       d.datallowconn
                  from pg_database d
                  left join pg_stat_database s on s.datid=d.oid
                 where not d.datistemplate
                 order by d.datname
                """
            )
            roles = await conn.fetch(
                """
                select rolname, rolsuper, rolcreaterole, rolcreatedb, rolcanlogin,
                       rolconnlimit, rolvaliduntil
                  from pg_roles
                 order by rolname
                """
            )
            return {
                "server": {
                    "version": await conn.fetchval("show server_version"),
                    "current_user": await conn.fetchval("select current_user"),
                    "max_connections": int(await conn.fetchval("show max_connections")),
                },
                "databases": [
                    {
                        **dict(row),
                        "managed": row["datname"] == settings.postgres_db
                        or str(row["datname"]).startswith(f"{settings.tenant_db_prefix}_"),
                    }
                    for row in databases
                ],
                "roles": [
                    {
                        **dict(row),
                        "rolvaliduntil": row["rolvaliduntil"].isoformat() if row["rolvaliduntil"] else None,
                    }
                    for row in roles
                ],
            }
        finally:
            await conn.close()

    async def sessions(self) -> list[dict[str, Any]]:
        conn = await connect_postgres_admin()
        try:
            rows = await conn.fetch(
                """
                select pid, datname, usename, application_name, client_addr::text,
                       state, wait_event_type, wait_event,
                       backend_start, xact_start, query_start,
                       left(query, 1000) as query
                  from pg_stat_activity
                 where pid <> pg_backend_pid()
                 order by query_start nulls last
                """
            )
            result: list[dict[str, Any]] = []
            for row in rows:
                item = dict(row)
                for key in ("backend_start", "xact_start", "query_start"):
                    if item.get(key):
                        item[key] = item[key].isoformat()
                item["managed"] = bool(
                    item.get("datname")
                    and (
                        item["datname"] == settings.postgres_db
                        or str(item["datname"]).startswith(f"{settings.tenant_db_prefix}_")
                    )
                )
                result.append(item)
            return result
        finally:
            await conn.close()

    async def locks(self) -> list[dict[str, Any]]:
        conn = await connect_postgres_admin()
        try:
            rows = await conn.fetch(
                """
                select a.pid, a.datname, a.usename, a.state,
                       l.locktype, l.mode, l.granted,
                       coalesce(c.relname, '') as relation,
                       left(a.query, 1000) as query
                  from pg_locks l
                  join pg_stat_activity a on a.pid=l.pid
                  left join pg_class c on c.oid=l.relation
                 order by l.granted, a.pid
                """
            )
            return [dict(row) for row in rows]
        finally:
            await conn.close()

    async def terminate_session(self, pid: int, *, confirm: str) -> dict[str, Any]:
        _confirm(confirm, str(pid))
        conn = await connect_postgres_admin()
        try:
            row = await conn.fetchrow("select datname, usename from pg_stat_activity where pid=$1", pid)
            if row is None:
                raise APIError("POSTGRES_SESSION_NOT_FOUND", "Sessão PostgreSQL não encontrada.", 404)
            if not row["datname"] or not await self._managed_database(conn, str(row["datname"])):
                raise APIError(
                    "POSTGRES_SESSION_NOT_MANAGED",
                    "Por segurança, somente sessões de bancos gerenciados pela plataforma podem ser encerradas.",
                    403,
                )
            terminated = bool(await conn.fetchval("select pg_terminate_backend($1)", pid))
            return {"pid": pid, "terminated": terminated, "database": row["datname"], "user": row["usename"]}
        finally:
            await conn.close()

    async def maintenance(
        self,
        database: str,
        operation: Literal["ANALYZE", "VACUUM_ANALYZE", "REINDEX_DATABASE"],
        *,
        confirm: str,
    ) -> dict[str, Any]:
        database = self._validate_database_name(database)
        _confirm(confirm, database)

        guard = await connect_postgres_admin()
        try:
            if not await self._managed_database(guard, database):
                raise APIError(
                    "POSTGRES_DATABASE_NOT_MANAGED",
                    "A manutenção administrativa está limitada aos bancos gerenciados pela plataforma.",
                    403,
                )
        finally:
            await guard.close()

        conn = await connect_postgres_admin(database)
        try:
            quoted = '"' + database.replace('"', '""') + '"'
            if operation == "ANALYZE":
                await conn.execute("ANALYZE")
            elif operation == "VACUUM_ANALYZE":
                await conn.execute("VACUUM (ANALYZE)")
            elif operation == "REINDEX_DATABASE":
                await conn.execute(f"REINDEX DATABASE {quoted}")
            else:  # pragma: no cover - protegido pelo schema/typing
                raise APIError("POSTGRES_OPERATION_INVALID", "Operação PostgreSQL inválida.", 422)
            return {"database": database, "operation": operation, "completed": True}
        finally:
            await conn.close()


class PrometheusAdminService:
    def __init__(self) -> None:
        self.base_url = settings.prometheus_base_url.rstrip("/")

    async def _json(self, method: str, path: str, **kwargs: Any) -> dict[str, Any]:
        if not settings.prometheus_enabled:
            raise APIError("PROMETHEUS_DISABLED", "Prometheus está desabilitado.", 409)
        try:
            async with httpx.AsyncClient(base_url=self.base_url, timeout=15.0) as client:
                response = await client.request(method, path, **kwargs)
                response.raise_for_status()
                if not response.content:
                    return {}
                data = response.json()
        except (httpx.HTTPError, ValueError) as exc:
            raise APIError("PROMETHEUS_UNAVAILABLE", "Prometheus está indisponível ou retornou resposta inválida.", 503) from exc
        if isinstance(data, dict) and data.get("status") == "error":
            raise APIError("PROMETHEUS_QUERY_FAILED", str(data.get("error") or "Consulta Prometheus falhou."), 422)
        return data if isinstance(data, dict) else {"data": data}

    async def health(self) -> dict[str, Any]:
        if not settings.prometheus_enabled:
            return {"enabled": False, "healthy": False, "ready": False}
        async with httpx.AsyncClient(base_url=self.base_url, timeout=10.0) as client:
            try:
                healthy = (await client.get("/-/healthy")).is_success
                ready = (await client.get("/-/ready")).is_success
            except httpx.HTTPError:
                healthy = ready = False
        return {"enabled": True, "healthy": healthy, "ready": ready, "base_url": self.base_url}

    async def overview(self) -> dict[str, Any]:
        health = await self.health()
        if not health["healthy"]:
            return {"health": health, "targets": [], "alerts": [], "rules": [], "runtime": {}, "build": {}}
        targets, alerts, rules, runtime, build = await asyncio.gather(
            self._json("GET", "/api/v1/targets", params={"state": "any"}),
            self._json("GET", "/api/v1/alerts"),
            self._json("GET", "/api/v1/rules"),
            self._json("GET", "/api/v1/status/runtimeinfo"),
            self._json("GET", "/api/v1/status/buildinfo"),
        )
        return {
            "health": health,
            "targets": targets.get("data", {}),
            "alerts": alerts.get("data", {}),
            "rules": rules.get("data", {}),
            "runtime": runtime.get("data", {}),
            "build": build.get("data", {}),
        }

    async def query(self, expression: str, *, at: str | None = None) -> dict[str, Any]:
        params = {"query": expression}
        if at:
            params["time"] = at
        return (await self._json("GET", "/api/v1/query", params=params)).get("data", {})

    async def reload(self, *, confirm: str) -> dict[str, Any]:
        _confirm(confirm, "PROMETHEUS")
        if not settings.prometheus_lifecycle_enabled:
            raise APIError(
                "PROMETHEUS_LIFECYCLE_DISABLED",
                "Reload administrativo do Prometheus não está habilitado no runtime.",
                409,
            )
        try:
            async with httpx.AsyncClient(base_url=self.base_url, timeout=15.0) as client:
                response = await client.post("/-/reload")
                response.raise_for_status()
        except httpx.HTTPError as exc:
            raise APIError("PROMETHEUS_RELOAD_FAILED", "Não foi possível recarregar a configuração do Prometheus.", 502) from exc
        return {"reloaded": True}


class GrafanaAdminService:
    def __init__(self) -> None:
        self.base_url = settings.grafana_base_url.rstrip("/")

    def _headers(self) -> dict[str, str]:
        if not settings.grafana_service_account_token:
            raise APIError(
                "GRAFANA_ADMIN_NOT_CONFIGURED",
                "Configure GRAFANA_SERVICE_ACCOUNT_TOKEN para administrar o Grafana pelo Control Plane.",
                409,
            )
        headers = {"Authorization": f"Bearer {settings.grafana_service_account_token}", "Accept": "application/json"}
        if settings.grafana_org_id:
            headers["X-Grafana-Org-Id"] = str(settings.grafana_org_id)
        return headers

    async def _json(self, method: str, path: str, **kwargs: Any) -> Any:
        try:
            async with httpx.AsyncClient(base_url=self.base_url, headers=self._headers(), timeout=20.0) as client:
                response = await client.request(method, path, **kwargs)
                response.raise_for_status()
                data: Any = response.json() if response.content else {}
        except (httpx.HTTPError, ValueError) as exc:
            raise APIError("GRAFANA_API_FAILED", "A API administrativa do Grafana não respondeu corretamente.", 502) from exc
        return _safe_mapping(data)

    async def health(self) -> dict[str, Any]:
        try:
            async with httpx.AsyncClient(base_url=self.base_url, timeout=10.0) as client:
                response = await client.get("/api/health")
                healthy = response.is_success
                data = response.json() if response.content and response.is_success else {}
        except (httpx.HTTPError, ValueError):
            healthy, data = False, {}
        return {"healthy": healthy, "base_url": self.base_url, "details": _safe_mapping(data)}

    async def overview(self) -> dict[str, Any]:
        health = await self.health()
        if not settings.grafana_service_account_token:
            return {"health": health, "admin_configured": False, "dashboards": [], "folders": [], "datasources": []}
        dashboards, folders, datasources = await asyncio.gather(
            self._json("GET", "/api/search", params={"type": "dash-db", "limit": 1000}),
            self._json("GET", "/api/folders", params={"limit": 1000}),
            self._json("GET", "/api/datasources"),
        )
        return {
            "health": health,
            "admin_configured": True,
            "dashboards": dashboards if isinstance(dashboards, list) else [],
            "folders": folders if isinstance(folders, list) else [],
            "datasources": datasources if isinstance(datasources, list) else [],
        }

    async def dashboard(self, uid: str) -> dict[str, Any]:
        data = await self._json("GET", f"/api/dashboards/uid/{uid}")
        return data if isinstance(data, dict) else {"data": data}

    async def save_dashboard(self, payload: dict[str, Any]) -> dict[str, Any]:
        dashboard = payload.get("dashboard")
        if not isinstance(dashboard, dict):
            raise APIError("GRAFANA_DASHBOARD_INVALID", "O payload precisa conter o objeto dashboard.", 422)
        data = await self._json("POST", "/api/dashboards/db", json=payload)
        return data if isinstance(data, dict) else {"data": data}

    async def delete_dashboard(self, uid: str, *, confirm: str) -> dict[str, Any]:
        _confirm(confirm, uid)
        data = await self._json("DELETE", f"/api/dashboards/uid/{uid}")
        return data if isinstance(data, dict) else {"deleted": True, "uid": uid}

    async def create_folder(self, *, title: str, uid: str | None = None) -> dict[str, Any]:
        payload: dict[str, Any] = {"title": title}
        if uid:
            payload["uid"] = uid
        data = await self._json("POST", "/api/folders", json=payload)
        return data if isinstance(data, dict) else {"data": data}

    async def delete_folder(self, uid: str, *, confirm: str) -> dict[str, Any]:
        _confirm(confirm, uid)
        data = await self._json("DELETE", f"/api/folders/{uid}")
        return data if isinstance(data, dict) else {"deleted": True, "uid": uid}


class PlatformResourceCatalog:
    @staticmethod
    def entries() -> list[dict[str, Any]]:
        return [
            {"code": "POSTGRES", "name": "PostgreSQL", "management": "NATIVE", "path": "/resources", "category": "DATA"},
            {"code": "S3", "name": "S3 / MinIO", "management": "NATIVE", "path": "/resources", "category": "STORAGE"},
            {"code": "PROMETHEUS", "name": "Prometheus", "management": "NATIVE", "path": "/resources", "category": "OBSERVABILITY"},
            {"code": "GRAFANA", "name": "Grafana", "management": "NATIVE", "path": "/resources", "category": "OBSERVABILITY"},
            {"code": "DOCKER", "name": "Containers Docker", "management": "READ_ONLY_AGENT", "path": "/observability", "category": "RUNTIME"},
            {"code": "RABBITMQ", "name": "RabbitMQ / filas", "management": "INTEGRATED", "path": "/platform-health", "category": "MESSAGING"},
            {"code": "REDIS", "name": "Redis", "management": "INTEGRATED", "path": "/platform-health", "category": "CACHE"},
            {"code": "CELERY", "name": "Celery workers / beat", "management": "INTEGRATED", "path": "/platform-health", "category": "JOBS"},
            {"code": "BACKUP", "name": "Backup / restore", "management": "NATIVE", "path": "/backups", "category": "DATA"},
            {"code": "CLOUDFLARE", "name": "Cloudflare / DNS / SSL", "management": "NATIVE", "path": "/domains", "category": "NETWORK"},
            {"code": "EVOLUTION", "name": "Evolution API / WhatsApp", "management": "NATIVE", "path": "/platform-whatsapp", "category": "COMMUNICATION"},
            {"code": "BANK_PROVIDERS", "name": "Providers bancários", "management": "NATIVE", "path": "/bank-providers", "category": "FINANCE"},
            {"code": "PLATFORM_SETTINGS", "name": "Configurações e integrações", "management": "NATIVE", "path": "/control-settings", "category": "PLATFORM"},
        ]
