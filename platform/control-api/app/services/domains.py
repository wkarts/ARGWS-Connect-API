from __future__ import annotations

import secrets
from datetime import UTC, datetime
from typing import Any

import dns.asyncresolver
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import APIError
from app.models.platform import Tenant, TenantDomain
from app.providers.cloudflare import CloudflareDNSProvider

MANAGEMENT_PLATFORM_SUBDOMAIN = "PLATFORM_SUBDOMAIN"
MANAGEMENT_PLATFORM_MANAGED = "PLATFORM_MANAGED"
MANAGEMENT_EXTERNAL_DNS = "EXTERNAL_DNS"


def _normalize_hostname(value: str) -> str:
    return value.lower().strip().rstrip(".")


def _verification_name(hostname: str) -> str:
    return f"_connect-api-verification.{_normalize_hostname(hostname)}"


class DomainService:
    def __init__(self) -> None:
        self.cloudflare = CloudflareDNSProvider()

    @property
    def target(self) -> str:
        return _normalize_hostname(settings.cloudflare_tenant_record_target or settings.platform_domain)

    async def add_custom_domain(
        self,
        session: AsyncSession,
        tenant: Tenant,
        hostname: str,
        is_primary: bool = False,
        *,
        management_mode: str = MANAGEMENT_EXTERNAL_DNS,
        zone_name: str | None = None,
        dns_proxied: bool = False,
    ) -> TenantDomain:
        hostname = _normalize_hostname(hostname)
        mode = management_mode.strip().upper()
        if mode not in {MANAGEMENT_PLATFORM_MANAGED, MANAGEMENT_EXTERNAL_DNS}:
            raise APIError("DOMAIN_MANAGEMENT_MODE_INVALID", "Modo de administração do domínio inválido.", 422)
        if hostname == settings.control_plane_host or hostname.endswith(f".{settings.control_plane_host}"):
            raise APIError("RESERVED_DOMAIN", "Este domínio é reservado ao Control Plane.", 422)
        if hostname == settings.api_host or hostname.endswith(f".{settings.api_host}"):
            raise APIError("RESERVED_DOMAIN", "Este domínio é reservado à API da plataforma.", 422)
        if await session.scalar(select(TenantDomain.id).where(TenantDomain.hostname == hostname)):
            raise APIError("DOMAIN_ALREADY_EXISTS", "Este domínio já está vinculado à plataforma.", 409)
        if is_primary:
            for item in tenant.domains:
                item.is_primary = False
        normalized_zone = _normalize_hostname(zone_name or hostname) if mode == MANAGEMENT_PLATFORM_MANAGED else None
        domain = TenantDomain(
            tenant_id=tenant.id,
            hostname=hostname,
            domain_type="CUSTOM",
            management_mode=mode,
            dns_provider="CLOUDFLARE" if mode == MANAGEMENT_PLATFORM_MANAGED else "EXTERNAL",
            status="PROVISIONING" if mode == MANAGEMENT_PLATFORM_MANAGED else "VERIFYING",
            is_primary=is_primary,
            is_temporary=False,
            verification_token=secrets.token_urlsafe(32),
            zone_name=normalized_zone,
            dns_record_type="CNAME",
            dns_target=self.target,
            dns_proxied=bool(dns_proxied) if mode == MANAGEMENT_PLATFORM_MANAGED else False,
            ssl_status="PENDING",
        )
        session.add(domain)
        await session.commit()
        await session.refresh(domain)
        if mode == MANAGEMENT_PLATFORM_MANAGED:
            try:
                domain = await self.reconcile(session, domain)
            except APIError as exc:
                domain.last_error = exc.message
                domain.last_checked_at = datetime.now(UTC)
                await session.commit()
        return domain

    async def _external_cname(self, domain: TenantDomain) -> set[str]:
        try:
            answers = await dns.asyncresolver.resolve(domain.hostname, "CNAME")
        except Exception:
            return set()
        return {str(item.target).rstrip(".").lower() for item in answers}

    async def _external_ownership(self, domain: TenantDomain) -> bool:
        if not domain.verification_token:
            return False
        try:
            answers = await dns.asyncresolver.resolve(_verification_name(domain.hostname), "TXT")
        except Exception:
            return False
        expected = domain.verification_token.strip()
        for item in answers:
            text = "".join(part.decode() if isinstance(part, bytes) else str(part) for part in item.strings)
            if expected == text:
                return True
        return False

    async def verify(self, session: AsyncSession, domain: TenantDomain) -> TenantDomain:
        if domain.management_mode == MANAGEMENT_PLATFORM_MANAGED:
            return await self.reconcile(session, domain)
        if domain.management_mode == MANAGEMENT_PLATFORM_SUBDOMAIN:
            return await self.reconcile(session, domain)

        expected = _normalize_hostname(domain.dns_target or self.target)
        domain.last_checked_at = datetime.now(UTC)
        targets = await self._external_cname(domain)
        ownership = await self._external_ownership(domain)
        if expected not in targets:
            domain.status = "VERIFYING"
            domain.last_error = "O CNAME ainda não aponta para o gateway da plataforma."
            await session.commit()
            raise APIError(
                "DOMAIN_CNAME_MISMATCH",
                "O CNAME ainda não aponta para o gateway da plataforma.",
                409,
                {"expected": expected, "found": sorted(targets)},
            )
        if not ownership:
            domain.status = "VERIFYING"
            domain.last_error = "Aguarde a validação do TXT de propriedade do domínio."
            await session.commit()
            raise APIError("DOMAIN_OWNERSHIP_REQUIRED", domain.last_error, 409)
        now = datetime.now(UTC)
        domain.dns_verified_at = now
        domain.ownership_verified_at = now if ownership else domain.ownership_verified_at
        domain.last_reconciled_at = now
        domain.status = "WAITING_SSL" if settings.public_scheme == "https" else "ACTIVE"
        domain.ssl_status = "PENDING" if settings.public_scheme == "https" else "NOT_REQUIRED"
        domain.last_error = None
        await session.commit()
        return domain

    async def reconcile(self, session: AsyncSession, domain: TenantDomain) -> TenantDomain:
        now = datetime.now(UTC)
        domain.last_checked_at = now
        domain.last_reconciled_at = now
        domain.dns_target = _normalize_hostname(domain.dns_target or self.target)

        if domain.management_mode == MANAGEMENT_PLATFORM_SUBDOMAIN:
            from app.services.tls_status import apply_receipt
            if settings.public_scheme == "https":
                from app.services.managed_dns import reconcile_known_subdomain
                await reconcile_known_subdomain(domain)
                apply_receipt(domain)
            else:
                if settings.cloudflare_enabled:
                    await self.cloudflare.ensure_managed_wildcard()
                domain.dns_verified_at = now
                domain.ownership_verified_at = now
                domain.status, domain.ssl_status = "ACTIVE", "NOT_REQUIRED"
                domain.last_error = None
            await session.commit()
            return domain

        if domain.management_mode == MANAGEMENT_EXTERNAL_DNS:
            return await self.verify(session, domain)

        if domain.management_mode != MANAGEMENT_PLATFORM_MANAGED:
            raise APIError("DOMAIN_MANAGEMENT_MODE_INVALID", "Modo de administração do domínio inválido.", 422)
        if not settings.cloudflare_enabled:
            domain.status = "ERROR"
            domain.last_error = "Cloudflare está desabilitado na plataforma."
            await session.commit()
            raise APIError("CLOUDFLARE_NOT_CONFIGURED", domain.last_error, 503)

        zone_name = _normalize_hostname(domain.zone_name or domain.hostname)
        zone = await self.cloudflare.ensure_zone(zone_name)
        domain.zone_name = zone.name
        domain.zone_id = zone.zone_id
        domain.nameservers = zone.nameservers
        domain.dns_provider = "CLOUDFLARE"
        domain.provider_metadata = {
            **dict(domain.provider_metadata or {}),
            "zone_status": zone.status,
            "zone_paused": zone.paused,
            "development_mode": zone.development_mode,
        }

        if zone.status != "ACTIVE":
            domain.status = "WAITING_NAMESERVERS"
            domain.ssl_status = "PENDING"
            domain.last_error = None
            await session.commit()
            return domain

        record = await self.cloudflare.upsert_cname(
            domain.hostname,
            domain.dns_target,
            proxied=domain.dns_proxied,
            zone_id=zone.zone_id,
        )
        domain.dns_record_id = record.record_id
        domain.dns_record_type = record.record_type
        domain.dns_target = record.content
        domain.dns_proxied = record.proxied
        domain.dns_verified_at = now
        domain.ownership_verified_at = now
        try:
            dnssec = await self.cloudflare.dnssec(zone.zone_id)
            domain.dnssec_status = str(dnssec.get("status") or "UNKNOWN")
        except APIError:
            domain.dnssec_status = "UNKNOWN"
        domain.status = "WAITING_SSL" if settings.public_scheme == "https" else "ACTIVE"
        domain.ssl_status = "PENDING" if settings.public_scheme == "https" else "NOT_REQUIRED"
        domain.last_error = None
        await session.commit()
        return domain

    async def set_proxy(self, session: AsyncSession, domain: TenantDomain, enabled: bool) -> TenantDomain:
        if domain.management_mode != MANAGEMENT_PLATFORM_MANAGED or not domain.zone_id:
            raise APIError(
                "DOMAIN_NOT_PLATFORM_MANAGED",
                "Somente domínios administrados pela plataforma permitem alterar o proxy Cloudflare.",
                409,
            )
        record = await self.cloudflare.upsert_cname(
            domain.hostname,
            domain.dns_target or self.target,
            proxied=enabled,
            zone_id=domain.zone_id,
        )
        domain.dns_record_id = record.record_id
        domain.dns_proxied = record.proxied
        domain.last_reconciled_at = datetime.now(UTC)
        domain.last_error = None
        await session.commit()
        return domain

    async def set_dnssec(self, session: AsyncSession, domain: TenantDomain, enabled: bool) -> TenantDomain:
        if domain.management_mode != MANAGEMENT_PLATFORM_MANAGED or not domain.zone_id:
            raise APIError(
                "DOMAIN_NOT_PLATFORM_MANAGED",
                "DNSSEC só pode ser administrado em zonas Cloudflare controladas pela plataforma.",
                409,
            )
        if enabled:
            result = await self.cloudflare.enable_dnssec(domain.zone_id)
            domain.dnssec_status = str(result.get("status") or "ACTIVE").upper()
        else:
            await self.cloudflare.disable_dnssec(domain.zone_id)
            domain.dnssec_status = "DISABLED"
        domain.last_reconciled_at = datetime.now(UTC)
        await session.commit()
        return domain

    async def management_snapshot(self, domain: TenantDomain) -> dict[str, Any]:
        snapshot: dict[str, Any] = {
            "mode": domain.management_mode,
            "provider": domain.dns_provider,
            "hostname": domain.hostname,
            "zone_name": domain.zone_name,
            "zone_id": domain.zone_id,
            "status": domain.status,
            "ssl_status": domain.ssl_status,
            "dnssec_status": domain.dnssec_status,
            "dns_target": domain.dns_target or self.target,
            "dns_proxied": domain.dns_proxied,
            "nameservers": list(domain.nameservers or []),
            "last_checked_at": domain.last_checked_at.isoformat() if domain.last_checked_at else None,
            "last_reconciled_at": domain.last_reconciled_at.isoformat() if domain.last_reconciled_at else None,
            "last_error": domain.last_error,
            "instructions": [],
            "cloudflare": None,
        }
        if domain.management_mode == MANAGEMENT_PLATFORM_SUBDOMAIN:
            snapshot["instructions"] = [
                {"kind": "INFO", "message": "Domínio provisório administrado integralmente pela plataforma; nenhuma ação do cliente é necessária."}
            ]
        elif domain.management_mode == MANAGEMENT_EXTERNAL_DNS:
            snapshot["instructions"] = [
                {
                    "kind": "DNS",
                    "type": "CNAME",
                    "name": domain.hostname,
                    "value": domain.dns_target or self.target,
                    "required": True,
                    "message": "Crie ou ajuste este CNAME no provedor DNS do cliente.",
                },
                {
                    "kind": "DNS",
                    "type": "TXT",
                    "name": _verification_name(domain.hostname),
                    "value": domain.verification_token,
                    "required": True,
                    "message": "Registro de propriedade obrigatório antes de ativar o domínio.",
                },
            ]
        elif domain.management_mode == MANAGEMENT_PLATFORM_MANAGED:
            if domain.nameservers:
                snapshot["instructions"] = [
                    {
                        "kind": "NAMESERVERS",
                        "values": list(domain.nameservers),
                        "required": domain.status == "WAITING_NAMESERVERS",
                        "message": "Configure estes nameservers no registrador do domínio; depois a plataforma assume DNS, proxy e DNSSEC.",
                    }
                ]
            if domain.zone_id:
                try:
                    snapshot["cloudflare"] = {
                        "zone": await self.cloudflare.zone_details(domain.zone_id),
                        "dnssec": await self.cloudflare.dnssec(domain.zone_id),
                    }
                except APIError as exc:
                    snapshot["cloudflare"] = {"available": False, "message": exc.message}
        return snapshot

    async def mark_ssl_active(self, session: AsyncSession, domain: TenantDomain) -> TenantDomain:
        if domain.dns_verified_at is None:
            raise APIError("DOMAIN_DNS_NOT_VERIFIED", "Verifique o DNS antes de ativar o SSL.", 409)
        from app.services.tls_status import snapshot
        proof = snapshot(domain.hostname)
        if not proof["tls_ready"] or domain.ownership_verified_at is None:
            raise APIError("DOMAIN_SSL_NOT_VERIFIED", "O certificado ainda não foi verificado no proxy TLS.", 409)
        domain.ssl_status = "ACTIVE"
        domain.ssl_issued_at = datetime.now(UTC)
        domain.status = "ACTIVE"
        domain.last_error = None
        await session.commit()
        return domain

    async def remove(self, session: AsyncSession, domain: TenantDomain) -> None:
        if domain.management_mode == MANAGEMENT_PLATFORM_MANAGED and domain.zone_id and domain.dns_record_id:
            try:
                await self.cloudflare.delete_record(domain.dns_record_id, zone_id=domain.zone_id)
            except APIError:
                pass
        await session.delete(domain)
        await session.commit()


domain_service = DomainService()
