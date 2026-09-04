from __future__ import annotations

import asyncio
import hashlib
import json
import os
import shutil
import subprocess
import tempfile
from datetime import UTC, datetime, timedelta
from pathlib import Path, PurePosixPath
from typing import Any
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.secrets import secret_cipher
from app.models.platform import BackupRun, Tenant, TenantDatabase, TenantStorage
from app.providers.storage import S3StorageProvider


class BackupError(RuntimeError):
    pass


def safe_backup_path(root: Path, relative: str) -> Path:
    """Resolve um membro de backup sem permitir caminho absoluto/traversal."""

    value = PurePosixPath(relative)
    if value.is_absolute() or ".." in value.parts or "\x00" in relative:
        raise BackupError(f"Caminho inseguro no backup: {relative!r}")
    root_resolved = root.resolve()
    candidate = (root / Path(*value.parts)).resolve()
    if not candidate.is_relative_to(root_resolved):
        raise BackupError(f"Caminho escapa do diretório de restauração: {relative!r}")
    return candidate


async def run_command(args: list[str], *, env: dict[str, str] | None = None, cwd: Path | None = None) -> str:
    process = await asyncio.create_subprocess_exec(
        *args,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
        env=env,
        cwd=str(cwd) if cwd else None,
    )
    stdout, stderr = await process.communicate()
    if process.returncode != 0:
        raise BackupError(f"Comando falhou ({args[0]}): {stderr.decode(errors='replace')[-4000:]}")
    return stdout.decode(errors="replace")


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


class BackupService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session
        self.s3 = S3StorageProvider()

    async def _dump_database(
        self, target: Path, database: str, user: str, password: str, filename: str
    ) -> dict[str, Any]:
        path = target / filename
        env = os.environ.copy()
        env["PGPASSWORD"] = password
        await run_command(
            [
                "pg_dump",
                "--host", settings.postgres_host,
                "--port", str(settings.postgres_port),
                "--username", user,
                "--format", "custom",
                "--no-owner",
                "--no-privileges",
                "--file", str(path),
                database,
            ],
            env=env,
        )
        return {"database": database, "file": filename, "size": path.stat().st_size, "sha256": sha256_file(path)}

    async def _copy_bucket(self, target: Path, bucket: str) -> dict[str, Any]:
        destination = target / "objects" / bucket
        destination.mkdir(parents=True, exist_ok=True)
        env = {
            **os.environ,
            "RCLONE_S3_PROVIDER": "Minio",
            "RCLONE_S3_ENDPOINT": settings.s3_endpoint_url,
            "RCLONE_S3_ACCESS_KEY_ID": settings.s3_access_key,
            "RCLONE_S3_SECRET_ACCESS_KEY": settings.s3_secret_key,
        }
        args = [
            "rclone", "copy", f":s3:{bucket}", str(destination),
            "--fast-list", "--checksum",
        ]
        await run_command(args, env=env)
        files = [item for item in destination.rglob("*") if item.is_file()]
        return {"bucket": bucket, "files": len(files), "size": sum(item.stat().st_size for item in files)}

    async def _upload_rclone(self, archive: Path, remote: str) -> dict[str, Any]:
        env = os.environ.copy()
        if settings.backup_rclone_config.exists():
            env["RCLONE_CONFIG"] = str(settings.backup_rclone_config)
        target = f"{remote.rstrip('/')}/{archive.name}"
        await run_command(["rclone", "copyto", str(archive), target, "--checksum", "--retries", "5"], env=env)
        return {"status": "UPLOADED", "target": target}

    async def _upload_s3(self, archive: Path, *, prefix: str = "full") -> dict[str, Any]:
        await self.s3.ensure_bucket(settings.backup_s3_bucket)
        key = f"{prefix.strip('/')}/{archive.name}"
        stored = await self.s3.upload_file(
            settings.backup_s3_bucket, key, archive, "application/zstd"
        )
        return {"status": "UPLOADED", "bucket": stored.bucket, "key": stored.key, "sha256": stored.sha256}

    async def create_full(self) -> BackupRun:
        run = BackupRun(scope="FULL", status="RUNNING", started_at=datetime.now(UTC))
        self.session.add(run)
        await self.session.commit()
        await self.session.refresh(run)
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        work_root = settings.backup_dir / "work"
        final_root = settings.backup_dir / "archives"
        work_root.mkdir(parents=True, exist_ok=True)
        final_root.mkdir(parents=True, exist_ok=True)
        temp_dir = Path(tempfile.mkdtemp(prefix=f"backup-{timestamp}-", dir=work_root))
        archive = final_root / f"connect-api-platform-full-{timestamp}.tar.zst"
        try:
            database_dir = temp_dir / "databases"
            database_dir.mkdir(parents=True)
            manifest: dict[str, Any] = {
                "format": 1,
                "application": settings.app_name,
                "version": settings.app_version,
                "created_at": datetime.now(UTC).isoformat(),
                "scope": "FULL",
                "platform_database": {},
                "tenants": [],
            }
            manifest["platform_database"] = await self._dump_database(
                database_dir,
                settings.postgres_db,
                settings.postgres_user,
                settings.postgres_password,
                "platform.dump",
            )
            tenants = list(
                (
                    await self.session.execute(
                        select(Tenant)
                        .where(Tenant.status.in_(["ACTIVE", "SUSPENDED", "PROVISIONING_FAILED"]))
                        .options(selectinload(Tenant.database), selectinload(Tenant.storage))
                    )
                ).scalars()
            )
            for tenant in tenants:
                if tenant.database is None:
                    continue
                item: dict[str, Any] = {
                    "tenant_id": str(tenant.id),
                    "slug": tenant.slug,
                    "database": await self._dump_database(
                        database_dir,
                        tenant.database.database_name,
                        tenant.database.database_user,
                        secret_cipher.decrypt(tenant.database.encrypted_password),
                        f"tenant-{tenant.slug}.dump",
                    ),
                }
                if tenant.storage and tenant.storage.status == "ACTIVE":
                    item["storage"] = await self._copy_bucket(temp_dir, tenant.storage.bucket)
                manifest["tenants"].append(item)
            manifest_path = temp_dir / "manifest.json"
            manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2), encoding="utf-8")
            checksums = []
            for item in sorted(path for path in temp_dir.rglob("*") if path.is_file()):
                checksums.append(f"{sha256_file(item)}  {item.relative_to(temp_dir)}")
            (temp_dir / "checksums.sha256").write_text("\n".join(checksums) + "\n", encoding="utf-8")
            await run_command(
                ["tar", "--zstd", "-cf", str(archive), "-C", str(temp_dir), "."],
                env={**os.environ, "ZSTD_CLEVEL": str(settings.backup_compress_level)},
            )
            if settings.backup_encryption_recipient:
                encrypted = archive.with_suffix(archive.suffix + ".age")
                await run_command(
                    ["age", "-r", settings.backup_encryption_recipient, "-o", str(encrypted), str(archive)]
                )
                archive.unlink()
                archive = encrypted
            destinations: dict[str, Any] = {"local": {"status": "CREATED", "path": str(archive)}}
            if settings.backup_upload_s3:
                destinations["s3"] = await self._upload_s3(archive, prefix="full")
            if settings.backup_google_drive_enabled:
                destinations["google_drive"] = await self._upload_rclone(
                    archive, settings.backup_google_drive_remote
                )
            if settings.backup_dropbox_enabled:
                destinations["dropbox"] = await self._upload_rclone(archive, settings.backup_dropbox_remote)
            run.status = "SUCCEEDED"
            run.path = str(archive)
            run.checksum = sha256_file(archive)
            run.size_bytes = archive.stat().st_size
            run.manifest = manifest
            run.destinations = destinations
            run.finished_at = datetime.now(UTC)
            await self.session.commit()
            await self.apply_local_retention()
            return run
        except Exception as exc:
            run.status = "FAILED"
            run.last_error = str(exc)[:4000]
            run.finished_at = datetime.now(UTC)
            await self.session.commit()
            raise
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    async def create_tenant(self, tenant_id: UUID) -> BackupRun:
        """Cria um pacote portável contendo somente banco e objetos de um tenant."""

        run = BackupRun(
            scope="TENANT",
            tenant_id=tenant_id,
            status="RUNNING",
            started_at=datetime.now(UTC),
        )
        self.session.add(run)
        await self.session.commit()
        await self.session.refresh(run)
        timestamp = datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        work_root = settings.backup_dir / "work"
        final_root = settings.backup_dir / "archives"
        work_root.mkdir(parents=True, exist_ok=True)
        final_root.mkdir(parents=True, exist_ok=True)
        temp_dir = Path(tempfile.mkdtemp(prefix=f"backup-tenant-{timestamp}-", dir=work_root))
        archive: Path | None = None
        try:
            tenant = await self.session.scalar(
                select(Tenant)
                .where(Tenant.id == tenant_id)
                .options(selectinload(Tenant.database), selectinload(Tenant.storage))
            )
            if tenant is None:
                raise BackupError(f"Tenant não encontrado: {tenant_id}")
            if tenant.database is None:
                raise BackupError(f"Tenant {tenant.slug} não possui banco provisionado.")

            database_dir = temp_dir / "databases"
            database_dir.mkdir(parents=True)
            entry: dict[str, Any] = {
                "tenant_id": str(tenant.id),
                "slug": tenant.slug,
                "database": await self._dump_database(
                    database_dir,
                    tenant.database.database_name,
                    tenant.database.database_user,
                    secret_cipher.decrypt(tenant.database.encrypted_password),
                    f"tenant-{tenant.slug}.dump",
                ),
            }
            if tenant.storage and tenant.storage.status == "ACTIVE":
                entry["storage"] = await self._copy_bucket(temp_dir, tenant.storage.bucket)

            manifest: dict[str, Any] = {
                "format": 1,
                "application": settings.app_name,
                "version": settings.app_version,
                "created_at": datetime.now(UTC).isoformat(),
                "scope": "TENANT",
                "tenant_id": str(tenant.id),
                "tenant_slug": tenant.slug,
                "tenants": [entry],
            }
            (temp_dir / "manifest.json").write_text(
                json.dumps(manifest, ensure_ascii=False, indent=2),
                encoding="utf-8",
            )
            checksums = [
                f"{sha256_file(item)}  {item.relative_to(temp_dir)}"
                for item in sorted(path for path in temp_dir.rglob("*") if path.is_file())
            ]
            (temp_dir / "checksums.sha256").write_text(
                "\n".join(checksums) + "\n",
                encoding="utf-8",
            )
            archive = final_root / f"connect-api-platform-tenant-{tenant.slug}-{timestamp}.tar.zst"
            await run_command(
                ["tar", "--zstd", "-cf", str(archive), "-C", str(temp_dir), "."],
                env={**os.environ, "ZSTD_CLEVEL": str(settings.backup_compress_level)},
            )
            if settings.backup_encryption_recipient:
                encrypted = archive.with_suffix(archive.suffix + ".age")
                await run_command(
                    ["age", "-r", settings.backup_encryption_recipient, "-o", str(encrypted), str(archive)]
                )
                archive.unlink()
                archive = encrypted

            destinations: dict[str, Any] = {"local": {"status": "CREATED", "path": str(archive)}}
            if settings.backup_upload_s3:
                destinations["s3"] = await self._upload_s3(
                    archive,
                    prefix=f"tenant/{tenant.id}",
                )
            if settings.backup_google_drive_enabled:
                destinations["google_drive"] = await self._upload_rclone(
                    archive,
                    f"{settings.backup_google_drive_remote.rstrip('/')}/tenants/{tenant.slug}",
                )
            if settings.backup_dropbox_enabled:
                destinations["dropbox"] = await self._upload_rclone(
                    archive,
                    f"{settings.backup_dropbox_remote.rstrip('/')}/tenants/{tenant.slug}",
                )

            run.status = "SUCCEEDED"
            run.path = str(archive)
            run.checksum = sha256_file(archive)
            run.size_bytes = archive.stat().st_size
            run.manifest = manifest
            run.destinations = destinations
            run.finished_at = datetime.now(UTC)
            await self.session.commit()
            await self.apply_local_retention(
                pattern=f"connect-api-platform-tenant-{tenant.slug}-*.tar.zst*"
            )
            return run
        except Exception as exc:
            run.status = "FAILED"
            run.last_error = str(exc)[:4000]
            run.finished_at = datetime.now(UTC)
            await self.session.commit()
            raise
        finally:
            shutil.rmtree(temp_dir, ignore_errors=True)

    async def apply_local_retention(self, *, pattern: str = "connect-api-platform-full-*.tar.zst*") -> None:
        root = settings.backup_dir / "archives"
        if not root.exists():
            return
        files = sorted(
            (item for item in root.glob(pattern) if item.is_file()),
            key=lambda item: item.stat().st_mtime,
            reverse=True,
        )
        keep: set[Path] = set(files[: settings.backup_keep_daily])
        seen_weeks: set[str] = set()
        seen_months: set[str] = set()
        for item in files:
            dt = datetime.fromtimestamp(item.stat().st_mtime, tz=UTC)
            week = dt.strftime("%G-W%V")
            month = dt.strftime("%Y-%m")
            if len(seen_weeks) < settings.backup_keep_weekly and week not in seen_weeks:
                keep.add(item); seen_weeks.add(week)
            if len(seen_months) < settings.backup_keep_monthly and month not in seen_months:
                keep.add(item); seen_months.add(month)
        for item in files:
            if item not in keep:
                item.unlink(missing_ok=True)
