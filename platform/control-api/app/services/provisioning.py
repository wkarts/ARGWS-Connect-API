from __future__ import annotations

import asyncio
import re
import secrets
from datetime import UTC, datetime
from pathlib import Path
from urllib.parse import quote_plus
from uuid import UUID, uuid4

from alembic import command
from alembic.config import Config
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from slugify import slugify

from app.core.config import settings
from app.core.errors import APIError
from app.core.security import hash_password
from app.core.secrets import secret_cipher
from app.core.tenant_context import TenantContext
from app.db.platform import PlatformSessionLocal
from app.db.postgres_admin import connect_postgres_admin
from app.db.tenant import tenant_engines
from app.models.platform import PlatformPlan, ProvisioningJob, Tenant, TenantDatabase, TenantDomain, TenantStorage
from app.models.tenant import (
    Company,
    NotificationRule,
    NotificationTemplate,
    ServiceCatalog,
    TenantUser,
    UserCompany,
)
from app.providers.storage import S3StorageProvider
from app.schemas.control import TenantCreate
from app.services.audit import platform_audit
from app.services.bootstrap_defaults import ensure_tenant_roles
from app.services.collection_rules import default_notification_rule_events, default_notification_templates
from app.services.domains import MANAGEMENT_PLATFORM_SUBDOMAIN, domain_service
from app.services.tenant_resolver import TenantResolver

_SAFE_IDENTIFIER = re.compile(r"^[a-z][a-z0-9_]{0,62}$")


def sql_identifier(value: str) -> str:
    if not _SAFE_IDENTIFIER.fullmatch(value):
        raise ValueError(f"Identificador PostgreSQL inválido: {value}")
    return f'"{value}"'


def sql_literal(value: str) -> str:
    return "'" + value.replace("'", "''") + "'"


def normalized_database_identifiers(tenant_id: UUID) -> tuple[str, str]:
    suffix = tenant_id.hex[:16]
    database = f"{settings.tenant_db_prefix}_{suffix}"[:63]
    user = f"{settings.tenant_db_user_prefix}_{suffix}"[:63]
    return database, user


class ProvisioningService:
    def __init__(self) -> None:
        self.storage = S3StorageProvider()

    async def create_request(self, session: AsyncSession, data: TenantCreate, actor_id: str | None) -> tuple[Tenant, ProvisioningJob]:
        slug = slugify(data.slug or data.name)
        if not slug:
            raise APIError("INVALID_TENANT_SLUG", "Não foi possível gerar um slug válido.", 422)
        if await session.scalar(select(Tenant.id).where(Tenant.slug == slug)):
            raise APIError("TENANT_SLUG_EXISTS", "Já existe um tenant com este slug.", 409)
        hostname = settings.tenant_hostname(slug)
        if await session.scalar(select(TenantDomain.id).where(TenantDomain.hostname == hostname)):
            raise APIError("TENANT_DOMAIN_EXISTS", "O domínio provisionado já está em uso.", 409)

        plan = await session.scalar(
            select(PlatformPlan).where(PlatformPlan.code == data.plan_code.upper(), PlatformPlan.is_active.is_(True))
        )
        if plan is None:
            raise APIError("PLAN_NOT_FOUND", "Plano informado não existe ou está inativo.", 422)
        features = dict(plan.features or {})
        features.update(data.features or {})
        limits = dict(plan.limits or {})
        limits.update(data.limits or {})
        tenant = Tenant(
            name=data.name,
            slug=slug,
            legal_document=data.legal_document,
            status="PROVISIONING",
            plan_code=plan.code,
            timezone=data.timezone,
            partner_id=data.partner_id,
            branding_mode="INHERIT" if data.partner_id else data.branding_mode,
            features=features,
            limits=limits,
        )
        session.add(tenant)
        await session.flush()
        domain = TenantDomain(
            tenant_id=tenant.id,
            hostname=hostname,
            domain_type="PROVISIONED",
            management_mode=MANAGEMENT_PLATFORM_SUBDOMAIN,
            dns_provider="CLOUDFLARE" if settings.cloudflare_enabled else "PLATFORM",
            status="PENDING",
            is_primary=True,
            is_temporary=True,
            verification_token=secrets.token_urlsafe(32),
            zone_name=settings.cloudflare_zone_name or settings.tenant_domain_root,
            zone_id=settings.cloudflare_zone_id or None,
            dns_record_type="CNAME",
            dns_target=domain_service.target,
            dns_proxied=False,
        )
        storage = TenantStorage(
            tenant_id=tenant.id,
            provider="S3",
            bucket=f"{settings.s3_bucket_prefix}-{tenant.id.hex[:20]}".lower(),
            prefix="",
            status="PENDING",
        )
        session.add_all([domain, storage])
        correlation_id = uuid4().hex
        job = ProvisioningJob(
            tenant_id=tenant.id,
            status="PENDING",
            current_step="CREATED",
            progress=0,
            correlation_id=correlation_id,
            payload={
                "admin_name": data.admin_name,
                "admin_email": data.admin_email.lower(),
                "admin_password": secret_cipher.encrypt(data.admin_password),
                "initial_company_name": data.initial_company_name,
                "initial_company_tax_id": "".join(ch for ch in data.initial_company_tax_id if ch.isdigit()),
            },
        )
        job.add_event("CREATED", "Solicitação de provisionamento criada.")
        session.add(job)
        await platform_audit(
            session,
            action="tenant.create.requested",
            entity_type="Tenant",
            entity_id=str(tenant.id),
            actor_id=actor_id,
            tenant_id=str(tenant.id),
            after={
                "name": tenant.name,
                "slug": tenant.slug,
                "hostname": hostname,
                "domain_management": MANAGEMENT_PLATFORM_SUBDOMAIN,
                "plan": plan.code,
            },
            correlation_id=correlation_id,
        )
        await session.commit()
        await session.refresh(tenant)
        await session.refresh(job)
        return tenant, job

    async def _save_step(
        self,
        session: AsyncSession,
        job: ProvisioningJob,
        step: str,
        progress: int,
        message: str,
        *,
        status: str = "RUNNING",
    ) -> None:
        job.current_step = step
        job.progress = progress
        job.status = status
        job.add_event(step, message)
        await session.commit()

    async def _create_database(self, database_name: str, database_user: str, password: str) -> None:
        conn = await connect_postgres_admin()
        try:
            role_exists = await conn.fetchval("select 1 from pg_roles where rolname=$1", database_user)
            if not role_exists:
                await conn.execute(
                    f"create role {sql_identifier(database_user)} login password {sql_literal(password)} "
                    "nosuperuser nocreatedb nocreaterole inherit"
                )
            else:
                await conn.execute(
                    f"alter role {sql_identifier(database_user)} password {sql_literal(password)}"
                )
            db_exists = await conn.fetchval("select 1 from pg_database where datname=$1", database_name)
            if not db_exists:
                await conn.execute(
                    f"create database {sql_identifier(database_name)} owner {sql_identifier(database_user)} "
                    "encoding 'UTF8' template template0"
                )
        finally:
            await conn.close()

    async def _run_tenant_migrations(self, context: TenantContext) -> None:
        backend_root = Path(__file__).resolve().parents[2]
        config_path = backend_root / "alembic-tenant.ini"
        url = (
            f"postgresql+psycopg://{quote_plus(context.database_user)}:{quote_plus(context.database_password)}"
            f"@{settings.postgres_host}:{settings.postgres_port}/{context.database}"
        )

        def upgrade() -> None:
            cfg = Config(str(config_path))
            cfg.set_main_option("script_location", str(backend_root / "migrations" / "tenant"))
            cfg.set_main_option("sqlalchemy.url", url.replace("%", "%%"))
            command.upgrade(cfg, "head")

        await asyncio.to_thread(upgrade)

    async def validate_resources(self, session: AsyncSession, tenant: Tenant) -> dict[str, object]:
        """Valida de forma efetiva banco, storage e domínio do tenant.

        A validação é deliberadamente corretiva e não recria o tenant. Ela atualiza
        os estados já persistidos para que o Control Plane não trate flags antigas
        como prova de que o recurso continua disponível.
        """

        result: dict[str, object] = {"database": False, "storage": False, "domain": False, "errors": []}
        errors: list[str] = result["errors"]  # type: ignore[assignment]

        if tenant.database is None:
            errors.append("Banco isolado não provisionado.")
        else:
            try:
                context = await TenantResolver(session).resolve_by_id(str(tenant.id), require_active=False)
                entry = await tenant_engines.get(context)
                async with entry.engine.connect() as connection:
                    await connection.execute(text("select 1"))
                tenant.database.status = "ACTIVE"
                tenant.database.last_error = None
                result["database"] = True
            except Exception as exc:
                tenant.database.status = "ERROR"
                tenant.database.last_error = str(exc)[:4000]
                errors.append(f"Banco: {type(exc).__name__}: {exc}")

        if tenant.storage is None:
            errors.append("Storage isolado não provisionado.")
        else:
            try:
                if await self.storage.bucket_exists(tenant.storage.bucket):
                    tenant.storage.status = "ACTIVE"
                    tenant.storage.last_error = None
                    result["storage"] = True
                else:
                    tenant.storage.status = "ERROR"
                    tenant.storage.last_error = "Bucket S3/MinIO não encontrado."
                    errors.append("Storage: bucket S3/MinIO não encontrado.")
            except Exception as exc:
                tenant.storage.status = "ERROR"
                tenant.storage.last_error = str(exc)[:4000]
                errors.append(f"Storage: {type(exc).__name__}: {exc}")

        primary = next((item for item in tenant.domains if item.is_primary), None)
        primary = primary or next(iter(tenant.domains), None)
        if primary is None:
            errors.append("Domínio principal não provisionado.")
        else:
            try:
                await domain_service.verify(session, primary)
                result["domain"] = primary.status == "ACTIVE" and primary.ssl_status in {"ACTIVE", "NOT_REQUIRED"}
                if not result["domain"]:
                    errors.append(f"Domínio: estado={primary.status}, ssl={primary.ssl_status}.")
            except Exception as exc:
                errors.append(f"Domínio: {type(exc).__name__}: {exc}")

        result["ready"] = bool(result["database"] and result["storage"] and result["domain"])
        await session.flush()
        return result

    async def _bootstrap_tenant(self, context: TenantContext, payload: dict[str, str]) -> None:
        entry = await tenant_engines.get(context)
        async with entry.session_factory() as session:
            existing = await session.scalar(select(TenantUser.id).where(TenantUser.email == payload["admin_email"]))
            if existing:
                return
            company = Company(
                legal_name=payload["initial_company_name"],
                trade_name=payload["initial_company_name"],
                tax_id=payload["initial_company_tax_id"],
                is_active=True,
            )
            user = TenantUser(
                name=payload["admin_name"],
                email=payload["admin_email"],
                password_hash=hash_password(secret_cipher.decrypt(payload["admin_password"])),
                role="TENANT_ADMIN",
                permissions=["*"],
                is_active=True,
            )
            session.add_all([company, user])

            # O domínio financeiro permanece apenas como referência opcional.
            # Um tenant Connect|API não deve nascer com honorários, cobrança ou
            # templates financeiros quando ENABLE_REFERENCE_FINANCIAL_DOMAIN=false.
            if settings.enable_reference_financial_domain:
                default_service = ServiceCatalog(
                    code="HONORARIOS",
                    name="Honorários",
                    description="Serviço recorrente padrão importado/configurável.",
                    default_amount=0,
                    default_frequency="MONTHLY",
                )
                default_rule = NotificationRule(
                    name="Régua padrão de cobrança",
                    is_default=True,
                    events=default_notification_rule_events(),
                )
                templates = [NotificationTemplate(**item) for item in default_notification_templates()]
                session.add_all([default_service, default_rule, *templates])

            await session.flush()
            await ensure_tenant_roles(session)
            session.add(UserCompany(user_id=user.id, company_id=company.id, is_default=True))
            await session.commit()

    async def _activate_provisioned_domain(self, session: AsyncSession, primary: TenantDomain) -> str:
        primary.management_mode = MANAGEMENT_PLATFORM_SUBDOMAIN
        primary.dns_provider = "CLOUDFLARE" if settings.cloudflare_enabled else "PLATFORM"
        primary.zone_name = primary.zone_name or settings.cloudflare_zone_name or settings.tenant_domain_root
        primary.zone_id = primary.zone_id or settings.cloudflare_zone_id or None
        primary.dns_target = primary.dns_target or domain_service.target
        result = await domain_service.reconcile(session, primary)
        wildcard = (result.provider_metadata or {}).get("wildcard")
        target = result.dns_target or domain_service.target
        return (
            f"Domínio provisório {result.hostname} reconciliado pela plataforma; wildcard {wildcard} -> {target}."
            if wildcard
            else f"Domínio provisório {result.hostname} reconciliado para {target}."
        )

    async def provision(self, job_id: str) -> None:
        async with PlatformSessionLocal() as session:
            stmt = (
                select(ProvisioningJob)
                .where(ProvisioningJob.id == job_id)
                .options(
                    selectinload(ProvisioningJob.tenant).selectinload(Tenant.domains),
                    selectinload(ProvisioningJob.tenant).selectinload(Tenant.storage),
                    selectinload(ProvisioningJob.tenant).selectinload(Tenant.database),
                )
                .with_for_update()
            )
            job = (await session.execute(stmt)).scalar_one_or_none()
            if job is None:
                raise APIError("PROVISIONING_JOB_NOT_FOUND", "Job de provisionamento não encontrado.", 404)
            if job.status == "SUCCEEDED":
                return
            tenant = job.tenant
            job.attempts += 1
            job.started_at = job.started_at or datetime.now(UTC)
            try:
                await self._save_step(session, job, "DATABASE", 15, "Criando banco e usuário isolados do tenant.")
                database_name, database_user = normalized_database_identifiers(tenant.id)
                database_password = secrets.token_urlsafe(36)
                await self._create_database(database_name, database_user, database_password)
                if tenant.database is None:
                    tenant.database = TenantDatabase(
                        tenant_id=tenant.id,
                        database_name=database_name,
                        database_user=database_user,
                        encrypted_password=secret_cipher.encrypt(database_password),
                        status="PROVISIONING",
                    )
                    session.add(tenant.database)
                else:
                    tenant.database.database_name = database_name
                    tenant.database.database_user = database_user
                    tenant.database.encrypted_password = secret_cipher.encrypt(database_password)
                    tenant.database.credential_version += 1
                await session.commit()

                context = TenantContext(
                    tenant_id=str(tenant.id),
                    slug=tenant.slug,
                    database=database_name,
                    database_user=database_user,
                    database_password=database_password,
                    storage_bucket=tenant.storage.bucket if tenant.storage else "",
                    hostname=next(item.hostname for item in tenant.domains if item.is_primary),
                    timezone=tenant.timezone,
                    credential_version=tenant.database.credential_version,
                )
                await self._save_step(session, job, "MIGRATIONS", 35, "Aplicando migrations do banco do tenant.")
                await self._run_tenant_migrations(context)
                tenant.database.status = "ACTIVE"
                tenant.database.migrated_revision = "head"
                tenant.database.provisioned_at = datetime.now(UTC)
                tenant.database.last_error = None
                await session.commit()

                await self._save_step(session, job, "STORAGE", 55, "Criando namespace S3/MinIO isolado.")
                if tenant.storage is None:
                    raise RuntimeError("Tenant sem registro de storage.")
                await self.storage.ensure_bucket(tenant.storage.bucket)
                tenant.storage.status = "ACTIVE"
                tenant.storage.provisioned_at = datetime.now(UTC)
                tenant.storage.last_error = None
                await session.commit()

                await self._save_step(session, job, "DOMAIN", 70, "Reconciliando domínio provisório, DNS e SSL da plataforma.")
                primary = next(item for item in tenant.domains if item.is_primary)
                domain_detail = await self._activate_provisioned_domain(session, primary)
                job.add_event("DOMAIN", domain_detail)
                await session.commit()

                await self._save_step(session, job, "BOOTSTRAP", 85, "Criando empresa, administrador e templates iniciais.")
                await self._bootstrap_tenant(context, job.payload)

                await self._save_step(session, job, "VALIDATION", 95, "Validando recursos provisionados.")
                validation = await self.validate_resources(session, tenant)
                if not validation.get("ready"):
                    details = "; ".join(str(item) for item in validation.get("errors", []))
                    raise RuntimeError(f"Validação final do tenant falhou: {details or 'recursos incompletos'}")
                tenant.status = "ACTIVE"
                tenant.activated_at = datetime.now(UTC)
                job.status = "SUCCEEDED"
                job.current_step = "COMPLETED"
                job.progress = 100
                job.finished_at = datetime.now(UTC)
                job.last_error = None
                job.add_event("COMPLETED", "Tenant provisionado e validado com sucesso.")
                await platform_audit(
                    session,
                    action="tenant.provisioned",
                    entity_type="Tenant",
                    entity_id=str(tenant.id),
                    tenant_id=str(tenant.id),
                    after={
                        "status": "ACTIVE",
                        "hostname": primary.hostname,
                        "domain_management": primary.management_mode,
                        "database": tenant.database.status if tenant.database else None,
                        "storage": tenant.storage.status if tenant.storage else None,
                    },
                    correlation_id=job.correlation_id,
                )
                await session.commit()
            except Exception as exc:
                tenant.status = "PROVISIONING_FAILED"
                job.status = "FAILED"
                job.last_error = str(exc)[:4000]
                job.finished_at = datetime.now(UTC)
                job.add_event(job.current_step, f"Falha: {type(exc).__name__}: {exc}", "ERROR")
                if tenant.database:
                    tenant.database.last_error = job.last_error
                if tenant.storage:
                    tenant.storage.last_error = job.last_error
                primary = next((item for item in tenant.domains if item.is_primary), None)
                if primary and job.current_step == "DOMAIN":
                    primary.status = "ERROR"
                    primary.last_checked_at = datetime.now(UTC)
                    primary.last_error = job.last_error
                await session.commit()
                raise


provisioning_service = ProvisioningService()
