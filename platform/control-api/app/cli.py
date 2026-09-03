from __future__ import annotations

import asyncio
import json
from pathlib import Path
from uuid import UUID, uuid4

import click
import httpx
from alembic import command
from alembic.config import Config
from sqlalchemy import select
from sqlalchemy.orm import selectinload

from app.core.config import settings
from app.core.errors import APIError
from app.core.security import hash_password
from app.db.platform import PlatformSessionLocal
from app.db.tenant import tenant_engines
from app.legacy import FinancialVitorImporter
from app.models.platform import PlatformUser, ProvisioningJob, Tenant
from app.models.tenant import Company, ServiceCatalog
from app.schemas.control import TenantCreate
from app.services.backup import BackupService
from app.services.bootstrap_defaults import ensure_platform_defaults, ensure_tenant_roles
from app.services.provisioning import provisioning_service
from app.services.restore import RestoreService
from app.services.tenant_resolver import TenantResolver


BACKEND_ROOT = Path(__file__).resolve().parents[1]


def run(coro):
    return asyncio.run(coro)


def migrate_platform() -> None:
    cfg = Config(str(BACKEND_ROOT / "alembic-platform.ini"))
    cfg.set_main_option("script_location", str(BACKEND_ROOT / "migrations" / "platform"))
    cfg.set_main_option("sqlalchemy.url", settings.platform_database_url_sync.replace("%", "%%"))
    command.upgrade(cfg, "head")


def _is_nonblocking_cloudflare_error(exc: Exception) -> bool:
    if isinstance(exc, APIError):
        return exc.code.startswith("CLOUDFLARE_")
    if isinstance(exc, httpx.HTTPStatusError):
        return (exc.request.url.host or "").lower() == "api.cloudflare.com"
    return False


async def _provision_demo_job(job_id: str) -> bool:
    """Provisiona o tenant demo sem derrubar o boot por falha externa de DNS.

    O ProvisioningService continua registrando job/tenant como FAILED quando o
    domínio não pode ser reconciliado. Aqui apenas impedimos que essa falha
    externa da Cloudflare encerre o container de bootstrap e bloqueie API e
    workers. Erros de banco, storage, migrations e demais componentes continuam
    fatais e são propagados normalmente.
    """

    try:
        await provisioning_service.provision(job_id)
        return True
    except Exception as exc:  # noqa: BLE001
        if not _is_nonblocking_cloudflare_error(exc):
            raise
        detail = exc.code if isinstance(exc, APIError) else f"HTTP {exc.response.status_code}"
        click.echo(
            "Aviso: reconciliação Cloudflare do tenant demo ficou pendente "
            f"({detail}); o bootstrap da plataforma continuará e o job poderá ser reprocessado."
        )
        return False


async def bootstrap_async() -> None:
    async with PlatformSessionLocal() as session:
        await ensure_platform_defaults(session)
        await session.commit()
        admin = await session.scalar(select(PlatformUser).where(PlatformUser.email == str(settings.platform_admin_email).lower()))
        if admin is None:
            session.add(
                PlatformUser(
                    name=settings.platform_admin_name,
                    email=str(settings.platform_admin_email).lower(),
                    password_hash=hash_password(settings.platform_admin_password),
                    role="PLATFORM_SUPERADMIN",
                    is_active=True,
                )
            )
            await session.commit()
            click.echo("Administrador do Control Plane criado.")
        else:
            click.echo("Administrador do Control Plane já existe.")
        if settings.bootstrap_demo_tenant:
            tenant = await session.scalar(
                select(Tenant)
                .where(Tenant.slug == settings.demo_tenant_slug)
                .options(selectinload(Tenant.domains))
            )
            if tenant is None:
                tenant, job = await provisioning_service.create_request(
                    session,
                    TenantCreate(
                        name=settings.demo_tenant_name,
                        slug=settings.demo_tenant_slug,
                        admin_name=settings.demo_tenant_admin_name,
                        admin_email=str(settings.demo_tenant_admin_email),
                        admin_password=settings.demo_tenant_admin_password,
                        initial_company_name=settings.demo_tenant_name,
                        initial_company_tax_id="00000000000191",
                    ),
                    actor_id=None,
                )
                if await _provision_demo_job(str(job.id)):
                    click.echo(f"Tenant demo provisionado: {settings.tenant_hostname(tenant.slug)}")
                else:
                    click.echo(
                        f"Tenant demo preparado parcialmente e aguardando reconciliação: "
                        f"{settings.tenant_hostname(tenant.slug)}"
                    )
            else:
                primary = next((item for item in tenant.domains if item.is_primary), None)
                operational = tenant.status == "ACTIVE" and primary is not None and primary.status == "ACTIVE"
                if operational:
                    click.echo("Tenant demo já existe e está operacional.")
                else:
                    previous = await session.scalar(
                        select(ProvisioningJob)
                        .where(ProvisioningJob.tenant_id == tenant.id)
                        .order_by(ProvisioningJob.created_at.desc())
                    )
                    if previous is None or not previous.payload:
                        click.echo("Tenant demo existe, mas não há payload para reconciliar automaticamente.")
                    else:
                        if previous.status in {"PENDING", "RUNNING"}:
                            job = previous
                        else:
                            job = ProvisioningJob(
                                tenant_id=tenant.id,
                                operation="PROVISION",
                                status="PENDING",
                                current_step="BOOTSTRAP_RECONCILE",
                                progress=0,
                                correlation_id=uuid4().hex,
                                payload=previous.payload,
                            )
                            job.add_event(
                                "BOOTSTRAP_RECONCILE",
                                "Tenant demo existente está incompleto; reconciliação automática iniciada.",
                            )
                            session.add(job)
                        tenant.status = "PROVISIONING"
                        await session.commit()
                        if await _provision_demo_job(str(job.id)):
                            click.echo(f"Tenant demo reconciliado: {settings.tenant_hostname(tenant.slug)}")
                        else:
                            click.echo(
                                f"Tenant demo continua pendente de reconciliação externa: "
                                f"{settings.tenant_hostname(tenant.slug)}"
                            )


@click.group()
def cli() -> None:
    """Administração da Connect|API Platform."""


@cli.command("migrate-platform")
def migrate_platform_command() -> None:
    migrate_platform()
    click.echo("Migrations do Control Plane aplicadas.")


async def migrate_all_tenants_async() -> dict[str, str]:
    results: dict[str, str] = {}
    async with PlatformSessionLocal() as session:
        tenant_ids = list((await session.scalars(select(Tenant.id).order_by(Tenant.created_at))).all())
        resolver = TenantResolver(session)
        for tenant_id in tenant_ids:
            try:
                context = await resolver.resolve_by_id(str(tenant_id), require_active=False)
                await provisioning_service._run_tenant_migrations(context)
                results[str(tenant_id)] = "migrated"
            except Exception as exc:  # noqa: BLE001
                results[str(tenant_id)] = f"error:{type(exc).__name__}:{exc}"
    return results


@cli.command("migrate-all-tenants")
def migrate_all_tenants_command() -> None:
    results = run(migrate_all_tenants_async())
    failures = {key: value for key, value in results.items() if value.startswith("error:")}
    click.echo(json.dumps(results, ensure_ascii=False, indent=2))
    if failures:
        raise click.ClickException(f"Falha ao migrar {len(failures)} tenant(s).")


@cli.command("bootstrap")
def bootstrap_command() -> None:
    run(bootstrap_async())


@cli.command("init")
def init_command() -> None:
    migrate_platform()
    run(bootstrap_async())
    click.echo("Inicialização concluída.")


@cli.command("backup")
@click.option("--tenant-id", type=click.UUID, default=None, help="Gera backup portável de um único tenant.")
def backup_command(tenant_id: UUID | None) -> None:
    async def action() -> None:
        async with PlatformSessionLocal() as session:
            service = BackupService(session)
            result = await service.create_tenant(tenant_id) if tenant_id else await service.create_full()
            click.echo(json.dumps({
                "id": str(result.id),
                "scope": result.scope,
                "tenant_id": str(result.tenant_id) if result.tenant_id else None,
                "path": result.path,
                "sha256": result.checksum,
            }, ensure_ascii=False, indent=2))
    run(action())


@cli.command("restore-validate")
@click.argument("archive", type=click.Path(exists=True, path_type=Path))
@click.option("--identity", type=click.Path(exists=True, path_type=Path), default=None)
@click.option("--sha256", "expected_sha256", default=None)
def restore_validate_command(archive: Path, identity: Path | None, expected_sha256: str | None) -> None:
    result = run(RestoreService().validate_archive(
        archive,
        identity=identity,
        expected_sha256=expected_sha256,
    ))
    click.echo(json.dumps(result, ensure_ascii=False, indent=2))


@cli.command("restore-tenant")
@click.argument("archive", type=click.Path(exists=True, path_type=Path))
@click.option("--tenant-id", type=click.UUID, required=True)
@click.option("--identity", type=click.Path(exists=True, path_type=Path), default=None)
@click.option("--sha256", "expected_sha256", default=None)
@click.option("--yes", is_flag=True, help="Confirma a restauração destrutiva do tenant.")
def restore_tenant_command(
    archive: Path,
    tenant_id: UUID,
    identity: Path | None,
    expected_sha256: str | None,
    yes: bool,
) -> None:
    if not yes:
        raise click.ClickException("Restauração não confirmada. Use --yes após colocar a plataforma em manutenção.")
    result = run(RestoreService().restore_tenant(
        archive,
        tenant_id,
        identity=identity,
        expected_sha256=expected_sha256,
    ))
    click.echo(json.dumps({
        "archive": result.archive,
        "scope": result.scope,
        "tenant_id": result.tenant_id,
        "tenants_restored": result.tenants_restored,
        "buckets_restored": result.buckets_restored,
        "manifest_version": result.manifest_version,
    }, ensure_ascii=False, indent=2))


@cli.command("restore")
@click.argument("archive", type=click.Path(exists=True, path_type=Path))
@click.option("--identity", type=click.Path(exists=True, path_type=Path), default=None, help="Chave privada age para backup criptografado.")
@click.option("--sha256", "expected_sha256", default=None, help="SHA-256 esperado do arquivo externo.")
@click.option("--yes", is_flag=True, help="Confirma a restauração destrutiva.")
def restore_command(archive: Path, identity: Path | None, expected_sha256: str | None, yes: bool) -> None:
    if not yes:
        raise click.ClickException("Restauração não confirmada. Use --yes após parar API, workers e beat.")

    async def action() -> None:
        result = await RestoreService().restore_full(archive, identity=identity, expected_sha256=expected_sha256)
        click.echo(json.dumps({
            "archive": result.archive,
            "platform_database": result.platform_database,
            "tenants_restored": result.tenants_restored,
            "buckets_restored": result.buckets_restored,
            "manifest_version": result.manifest_version,
            "scope": result.scope,
            "tenant_id": result.tenant_id,
        }, ensure_ascii=False, indent=2))

    run(action())


@cli.command("legacy-preview")
@click.argument("archive", type=click.Path(exists=True, path_type=Path))
@click.option("--output", type=click.Path(path_type=Path), default=None)
def legacy_preview(archive: Path, output: Path | None) -> None:
    report = FinancialVitorImporter().preview(archive).to_dict()
    content = json.dumps(report, ensure_ascii=False, indent=2)
    if output:
        output.write_text(content, encoding="utf-8")
        click.echo(str(output))
    else:
        click.echo(content)


@cli.command("legacy-import")
@click.argument("archive", type=click.Path(exists=True, path_type=Path))
@click.option("--tenant-id", required=True)
@click.option("--company-id", required=True)
@click.option("--service-id", required=True)
def legacy_import(archive: Path, tenant_id: str, company_id: str, service_id: str) -> None:
    async def action() -> None:
        async with PlatformSessionLocal() as platform_session:
            context = await TenantResolver(platform_session).resolve_by_id(tenant_id)
            entry = await tenant_engines.get(context)
            async with entry.session_factory() as session:
                stats = await FinancialVitorImporter().import_into(
                    session,
                    archive,
                    company_id=company_id,
                    service_id=service_id,
                )
                click.echo(json.dumps(stats, ensure_ascii=False, indent=2))
    run(action())


if __name__ == "__main__":
    cli()
