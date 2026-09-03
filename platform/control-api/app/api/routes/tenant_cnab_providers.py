from __future__ import annotations

import hashlib
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from fastapi import APIRouter, Depends
from pydantic import BaseModel, Field
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    ensure_company_access,
    get_tenant_context_dep,
    get_tenant_db,
    get_tenant_entitlements,
    require_permission,
)
from app.core.errors import APIError
from app.core.tenant_context import TenantContext
from app.db.platform import get_platform_session
from app.models.tenant import (
    BankAccount,
    BankAgreement,
    Charge,
    CNABRemittance,
    Company,
    Customer,
    Receivable,
)
from app.providers.banking.core.capabilities import BankingCapability, BankingIntegrationMode
from app.providers.banking.registry import banking_providers
from app.providers.cnab import CNABCompany, CNABTitle
from app.providers.storage import S3StorageProvider
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.services.audit import tenant_audit
from app.services.banking_entitlements import require_provider_entitlement
from app.services.entitlements import TenantEntitlements

router = APIRouter(prefix="/api/v1/cnab", tags=["Tenant - CNAB Providers"])
storage = S3StorageProvider()


class ProviderCNABGenerateRequest(BaseModel):
    bank_agreement_id: UUID
    receivable_ids: list[UUID] = Field(min_length=1, max_length=5000)


def _digits(value: object) -> str:
    return "".join(ch for ch in str(value or "") if ch.isdigit())


async def _titles_for_remittance(
    session: AsyncSession,
    *,
    agreement: BankAgreement,
    receivable_ids: list[UUID],
    provider_code: str,
) -> list[CNABTitle]:
    receivables = list(
        (
            await session.execute(
                select(Receivable).where(
                    Receivable.id.in_(receivable_ids),
                    Receivable.company_id == agreement.company_id,
                    Receivable.status.in_(["OPEN", "REGISTERED"]),
                )
            )
        ).scalars()
    )
    if len(receivables) != len(set(receivable_ids)):
        raise APIError(
            "CNAB_RECEIVABLES_INVALID",
            "Há títulos inexistentes, de outra empresa ou indisponíveis.",
            422,
        )

    titles: list[CNABTitle] = []
    bank_allocated_our_number = {"SAFRA", "C6", "BANCO_DO_BRASIL", "ITAU", "MERCANTIL"}
    for receivable in receivables:
        customer = await session.get(Customer, receivable.customer_id)
        if customer is None:
            raise APIError(
                "CUSTOMER_NOT_FOUND",
                "Cliente de um dos títulos não foi encontrado.",
                409,
            )
        address = dict(customer.address or {})
        charge = await session.scalar(
            select(Charge)
            .where(Charge.receivable_id == receivable.id)
            .order_by(Charge.created_at.desc())
        )

        # Providers que documentam numeração pelo banco devem receber Nosso
        # Número vazio/zerado no adapter. Não reutilize document_number como
        # substituto: cada instituição possui regra própria de atribuição/DV.
        our_number = charge.our_number if charge and charge.our_number else ""
        if provider_code not in bank_allocated_our_number and not our_number:
            our_number = receivable.document_number[-20:]

        titles.append(
            CNABTitle(
                document_number=receivable.document_number,
                our_number=our_number,
                due_date=receivable.due_date,
                amount=Decimal(receivable.balance),
                payer_name=customer.name,
                payer_tax_id=customer.tax_id or "",
                payer_address=str(address.get("street") or ""),
                payer_zip_code=str(address.get("zip_code") or ""),
                payer_city=str(address.get("city") or ""),
                payer_state=str(address.get("state") or ""),
                issue_date=receivable.issue_date,
            )
        )
    return titles


@router.post("/provider-remittances", response_model=SuccessResponse[dict], status_code=201)
async def generate_provider_cnab_remittance(
    payload: ProviderCNABGenerateRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("cnab.generate")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
    entitlements: TenantEntitlements = Depends(get_tenant_entitlements),
) -> SuccessResponse[dict]:
    """Gera remessa somente pelo adapter CNAB específico da instituição.

    O endpoint legado `/api/v1/cnab/remittances` continua disponível para
    compatibilidade histórica. Este endpoint provider-aware nunca cai em
    gerador genérico: cada banco precisa possuir executor CNAB próprio.
    """

    entitlements.require_feature("cnab")
    agreement = await session.get(BankAgreement, payload.bank_agreement_id)
    if agreement is None or not agreement.is_active:
        raise APIError("BANK_AGREEMENT_NOT_FOUND", "Convênio bancário não encontrado.", 404)
    ensure_company_access(user, agreement.company_id)

    account = await session.get(BankAccount, agreement.bank_account_id)
    company = await session.get(Company, agreement.company_id)
    if account is None or company is None:
        raise APIError(
            "BANK_CONFIGURATION_INCOMPLETE",
            "Conta bancária ou empresa não encontrada.",
            409,
        )

    provider_code = str(agreement.provider or "").strip().upper()
    if not provider_code:
        raise APIError(
            "BANKING_PROVIDER_REQUIRED",
            "O convênio precisa estar associado explicitamente ao provider da própria instituição.",
            422,
        )

    manifest = banking_providers.manifest(provider_code)
    if not banking_providers.mode_available(provider_code, BankingIntegrationMode.CNAB):
        raise APIError(
            "BANKING_PROVIDER_MODE_NOT_AVAILABLE",
            "O provider informado não possui executor CNAB específico nesta versão.",
            422,
            {
                "provider": provider_code,
                "implemented_modes": sorted(item.value for item in manifest.effective_implemented_modes()),
            },
        )

    await require_provider_entitlement(
        platform_session,
        tenant_id=context.tenant_id,
        provider_code=provider_code,
    )
    await platform_session.commit()

    bank_code = manifest.institution.bank_code if manifest.institution else None
    if bank_code and _digits(account.bank_code).zfill(3) != _digits(bank_code).zfill(3):
        raise APIError(
            "BANK_PROVIDER_ACCOUNT_MISMATCH",
            "O código bancário da conta não corresponde ao provider do convênio.",
            409,
            {
                "provider": provider_code,
                "expected_bank_code": bank_code,
                "account_bank_code": account.bank_code,
            },
        )

    titles = await _titles_for_remittance(
        session,
        agreement=agreement,
        receivable_ids=payload.receivable_ids,
        provider_code=provider_code,
    )

    last_sequence = await session.scalar(
        select(func.max(CNABRemittance.sequence)).where(
            CNABRemittance.bank_agreement_id == agreement.id
        )
    ) or 0
    sequence = int(last_sequence) + 1
    now = datetime.now(UTC)
    cnab_company = CNABCompany(
        bank_code=account.bank_code,
        tax_id=company.tax_id,
        name=company.legal_name,
        agreement=agreement.agreement_number or "",
        branch=account.branch,
        branch_digit=account.branch_digit or "",
        account=account.account,
        account_digit=account.account_digit or "",
    )
    layout = str(agreement.cnab_layout or "240").strip()

    try:
        provider = banking_providers.get_for_mode(provider_code, BankingIntegrationMode.CNAB)
        capability = BankingCapability.CNAB_240 if layout == "240" else BankingCapability.CNAB_400
        if capability not in manifest.capabilities:
            raise APIError(
                "BANK_CAPABILITY_NOT_SUPPORTED",
                "O provider não implementa o layout CNAB selecionado.",
                422,
                {"provider": provider_code, "layout": layout},
            )
        if layout == "240":
            factory = getattr(provider, "build_cnab240_generator", None)
            if factory is None:
                raise APIError(
                    "BANKING_PROVIDER_MODE_NOT_AVAILABLE",
                    "O executor CNAB do provider não possui gerador 240 instalado.",
                    422,
                    {"provider": provider_code},
                )
            generator = factory(
                company=cnab_company,
                sequence=sequence,
                generation_date=now.date(),
                generation_time=now.strftime("%H%M%S"),
                wallet=agreement.wallet,
                settings=dict(agreement.settings or {}),
            )
        elif layout == "400":
            factory = getattr(provider, "build_cnab400_generator", None)
            if factory is None:
                raise APIError(
                    "BANKING_PROVIDER_MODE_NOT_AVAILABLE",
                    "O executor CNAB do provider não possui gerador 400 instalado.",
                    422,
                    {"provider": provider_code},
                )
            generator = factory(
                company=cnab_company,
                sequence=sequence,
                generation_date=now.date(),
                wallet=agreement.wallet,
                settings=dict(agreement.settings or {}),
            )
        else:
            raise APIError(
                "CNAB_LAYOUT_UNSUPPORTED",
                "Layout CNAB não suportado.",
                422,
                {"layout": layout},
            )
        provider_mode = "PROVIDER_CNAB"
        content = generator.generate(titles)
    except APIError:
        raise
    except ValueError as exc:
        raise APIError(
            "CNAB_PROVIDER_CONFIGURATION_INVALID",
            str(exc),
            422,
            {"provider": provider_code, "layout": layout},
        ) from exc

    digest = hashlib.sha256(content).hexdigest()
    key = (
        f"cnab/remittances/{now:%Y/%m}/"
        f"REM-{_digits(account.bank_code).zfill(3)}-{sequence:06d}-CNAB{layout}.REM"
    )
    await storage.put_bytes(context.storage_bucket, key, content, "text/plain")
    remittance = CNABRemittance(
        company_id=company.id,
        bank_agreement_id=agreement.id,
        sequence=sequence,
        layout=layout,
        status="GENERATED",
        object_key=key,
        sha256=digest,
        record_count=len(content.decode("ascii").splitlines()),
        total_amount=sum((item.amount for item in titles), Decimal("0")),
    )
    session.add(remittance)
    await tenant_audit(
        session,
        action="cnab.remittance.generated",
        entity_type="CNABRemittance",
        entity_id=str(remittance.id),
        actor_id=user.id,
        company_id=str(company.id),
        after={
            "provider": provider_code,
            "provider_mode": provider_mode,
            "layout": layout,
            "sequence": sequence,
            "record_count": remittance.record_count,
            "sha256": digest,
        },
    )
    await session.commit()
    await session.refresh(remittance)

    return SuccessResponse(
        data={
            "id": str(remittance.id),
            "provider": provider_code,
            "provider_mode": provider_mode,
            "implemented_modes": sorted(item.value for item in manifest.effective_implemented_modes()),
            "sequence": sequence,
            "layout": layout,
            "object_key": key,
            "sha256": digest,
            "record_count": remittance.record_count,
            "total_amount": str(remittance.total_amount),
            "download_url": await storage.presigned_url(context.storage_bucket, key),
        }
    )
