from __future__ import annotations

import hashlib
from io import BytesIO
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID, uuid4

from fastapi import APIRouter, Depends, File, Query, UploadFile
from fastapi.responses import Response
from pydantic import BaseModel, Field
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from reportlab.lib.pagesizes import A4
from reportlab.pdfgen import canvas

from app.api.deps import (
    accessible_company_ids,
    ensure_company_access,
    get_tenant_context_dep,
    get_tenant_db,
    get_tenant_entitlements,
    require_permission,
)
from app.core.errors import APIError
from app.core.tenant_context import TenantContext
from app.models.tenant import (
    BankAccount,
    BankAgreement,
    Charge,
    CNABEvent,
    CNABRemittance,
    CNABReturn,
    Company,
    Contract,
    Customer,
    OutboxEvent,
    Payment,
    Receivable,
)
from app.providers.cnab import (
    CNAB240Generator,
    CNAB240ReturnParser,
    CNAB400Generator,
    CNAB400Layout,
    CNAB400ReturnParser,
    CNABCompany,
    CNABTitle,
)
from app.providers.storage import S3StorageProvider
from app.schemas.auth import AuthUser
from app.schemas.common import PaginatedResponse, PaginationMeta, SuccessResponse
from app.schemas.tenant import (
    ChargeCreate,
    ChargeRead,
    DashboardRead,
    PaymentCreate,
    PaymentRead,
    ReceivableCreate,
    ReceivableRead,
)
from app.services.audit import tenant_audit
from app.services.billing import BillingService
from app.services.entitlements import TenantEntitlements
from app.services.recurrence import RecurrenceService

router = APIRouter(prefix="/api/v1", tags=["Tenant - Financeiro"])
storage = S3StorageProvider()


class CNABGenerateRequest(BaseModel):
    bank_agreement_id: UUID
    receivable_ids: list[UUID] = Field(min_length=1, max_length=5000)


class PaymentWebhookPayload(BaseModel):
    receivable_id: UUID
    charge_id: UUID | None = None
    external_id: str
    end_to_end_id: str | None = None
    amount: Decimal = Field(gt=0)
    paid_at: datetime
    payment_method: str = "PIX"
    raw: dict = Field(default_factory=dict)


@router.get("/dashboard", response_model=SuccessResponse[DashboardRead])
async def financial_dashboard(
    company_id: UUID | None = Query(default=None),
    user: AuthUser = Depends(require_permission("dashboard.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[DashboardRead]:
    filters = []
    contract_filters = []
    if company_id:
        ensure_company_access(user, company_id)
        filters.append(Receivable.company_id == company_id)
        contract_filters.append(Contract.company_id == company_id)
    elif user.role != "TENANT_ADMIN" and "*" not in user.permissions:
        ids = [UUID(value) for value in user.companies]
        filters.append(Receivable.company_id.in_(ids))
        contract_filters.append(Contract.company_id.in_(ids))
    today = datetime.now(UTC).date()
    month_start = today.replace(day=1)
    open_amount = await session.scalar(
        select(func.coalesce(func.sum(Receivable.balance), 0)).where(
            *filters, Receivable.status.in_(["OPEN", "REGISTERED", "PARTIALLY_PAID", "OVERDUE"])
        )
    )
    overdue_amount = await session.scalar(
        select(func.coalesce(func.sum(Receivable.balance), 0)).where(
            *filters,
            Receivable.due_date < today,
            Receivable.status.in_(["OPEN", "REGISTERED", "PARTIALLY_PAID", "OVERDUE"]),
        )
    )
    received_month = await session.scalar(
        select(func.coalesce(func.sum(Payment.amount), 0))
        .join(Receivable, Payment.receivable_id == Receivable.id)
        .where(*filters, Payment.paid_at >= datetime.combine(month_start, datetime.min.time(), tzinfo=UTC), Payment.status == "CONFIRMED")
    )
    receivables_count = await session.scalar(select(func.count()).select_from(Receivable).where(*filters)) or 0
    overdue_count = await session.scalar(
        select(func.count()).select_from(Receivable).where(
            *filters,
            Receivable.due_date < today,
            Receivable.status.in_(["OPEN", "REGISTERED", "PARTIALLY_PAID", "OVERDUE"]),
        )
    ) or 0
    active_contracts = await session.scalar(
        select(func.count()).select_from(Contract).where(*contract_filters, Contract.status == "ACTIVE")
    ) or 0
    customers = await session.scalar(select(func.count()).select_from(Customer).where(Customer.is_active.is_(True))) or 0
    return SuccessResponse(
        data=DashboardRead(
            open_amount=Decimal(open_amount or 0),
            overdue_amount=Decimal(overdue_amount or 0),
            received_month=Decimal(received_month or 0),
            receivables_count=receivables_count,
            overdue_count=overdue_count,
            active_contracts=active_contracts,
            customers=customers,
        )
    )


@router.get("/receivables", response_model=PaginatedResponse[ReceivableRead])
async def list_receivables(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=25, ge=1, le=100),
    status: str | None = Query(default=None),
    company_id: UUID | None = Query(default=None),
    customer_id: UUID | None = Query(default=None),
    due_from: date | None = Query(default=None),
    due_to: date | None = Query(default=None),
    user: AuthUser = Depends(require_permission("receivables.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> PaginatedResponse[ReceivableRead]:
    filters = []
    if status:
        filters.append(Receivable.status == status.upper())
    if customer_id:
        filters.append(Receivable.customer_id == customer_id)
    if due_from:
        filters.append(Receivable.due_date >= due_from)
    if due_to:
        filters.append(Receivable.due_date <= due_to)
    if company_id:
        ensure_company_access(user, company_id)
        filters.append(Receivable.company_id == company_id)
    elif user.role != "TENANT_ADMIN" and "*" not in user.permissions:
        filters.append(Receivable.company_id.in_([UUID(value) for value in user.companies]))
    total = await session.scalar(select(func.count()).select_from(Receivable).where(*filters)) or 0
    items = list(
        (
            await session.execute(
                select(Receivable)
                .where(*filters)
                .order_by(Receivable.due_date.desc(), Receivable.created_at.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        ).scalars()
    )
    return PaginatedResponse(
        data=[ReceivableRead.model_validate(item) for item in items],
        meta=PaginationMeta(page=page, per_page=per_page, total=total, pages=(total + per_page - 1) // per_page),
    )


@router.post("/receivables", response_model=SuccessResponse[ReceivableRead], status_code=201)
async def create_receivable(
    payload: ReceivableCreate,
    user: AuthUser = Depends(require_permission("receivables.create")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[ReceivableRead]:
    ensure_company_access(user, payload.company_id)
    if await session.get(Company, payload.company_id) is None:
        raise APIError("COMPANY_NOT_FOUND", "Empresa não encontrada.", 404)
    if await session.get(Customer, payload.customer_id) is None:
        raise APIError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404)
    balance = payload.original_amount - payload.discount_amount
    if balance < 0:
        raise APIError("DISCOUNT_EXCEEDS_AMOUNT", "Desconto não pode exceder o valor original.", 422)
    receivable = Receivable(
        **payload.model_dump(),
        document_number=f"REC-{payload.competence.replace('-', '')}-{uuid4().hex[:10].upper()}",
        interest_amount=Decimal("0"),
        fine_amount=Decimal("0"),
        abatement_amount=Decimal("0"),
        paid_amount=Decimal("0"),
        balance=balance,
        status="OPEN",
        source="MANUAL",
    )
    session.add(receivable)
    await session.flush()
    session.add(
        OutboxEvent(
            aggregate_type="Receivable",
            aggregate_id=str(receivable.id),
            event_type="financial.receivable.created",
            payload={"receivable_id": str(receivable.id), "company_id": str(receivable.company_id)},
        )
    )
    await tenant_audit(
        session,
        action="receivable.created",
        entity_type="Receivable",
        entity_id=str(receivable.id),
        actor_id=user.id,
        company_id=str(receivable.company_id),
        after=payload.model_dump(mode="json"),
    )
    await session.commit()
    await session.refresh(receivable)
    return SuccessResponse(data=ReceivableRead.model_validate(receivable))


@router.post("/recurrences/generate", response_model=SuccessResponse[dict])
async def generate_recurrences(
    user: AuthUser = Depends(require_permission("recurrences.generate")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    items = await RecurrenceService(session).generate_due(company_ids=accessible_company_ids(user))
    return SuccessResponse(data={"generated": len(items), "ids": [str(item.id) for item in items]})


@router.post("/charges", response_model=SuccessResponse[ChargeRead], status_code=201)
async def create_charge(
    payload: ChargeCreate,
    user: AuthUser = Depends(require_permission("charges.create")),
    session: AsyncSession = Depends(get_tenant_db),
    entitlements: TenantEntitlements = Depends(get_tenant_entitlements),
) -> SuccessResponse[ChargeRead]:
    receivable = await session.get(Receivable, payload.receivable_id)
    if receivable is None:
        raise APIError("RECEIVABLE_NOT_FOUND", "Conta a receber não encontrada.", 404)
    ensure_company_access(user, receivable.company_id)
    charge_type = payload.charge_type.upper()
    entitlements.require_feature("pix" if "PIX" in charge_type else "boleto")
    month_start = datetime.now(UTC).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    month_count = await session.scalar(
        select(func.count()).select_from(Charge).where(Charge.created_at >= month_start)
    ) or 0
    entitlements.enforce_limit("monthly_charges", int(month_count))
    charge = await BillingService(session).create_charge(
        receivable_id=str(payload.receivable_id),
        provider_name=payload.provider,
        charge_type=payload.charge_type,
        bank_agreement_id=str(payload.bank_agreement_id) if payload.bank_agreement_id else None,
    )
    return SuccessResponse(data=ChargeRead.model_validate(charge))


@router.get("/charges", response_model=SuccessResponse[list[ChargeRead]])
async def list_charges(
    receivable_id: UUID | None = Query(default=None),
    status: str | None = Query(default=None),
    user: AuthUser = Depends(require_permission("charges.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[ChargeRead]]:
    filters = []
    if receivable_id:
        filters.append(Charge.receivable_id == receivable_id)
    if status:
        filters.append(Charge.status == status.upper())
    stmt = select(Charge).join(Receivable, Charge.receivable_id == Receivable.id).where(*filters)
    company_ids = accessible_company_ids(user)
    if company_ids is not None:
        stmt = stmt.where(Receivable.company_id.in_(company_ids))
    items = list((await session.execute(stmt.order_by(Charge.created_at.desc()).limit(500))).scalars())
    return SuccessResponse(data=[ChargeRead.model_validate(item) for item in items])


@router.get("/charges/{external_id}/document")
async def download_charge_document(
    external_id: str,
    user: AuthUser = Depends(require_permission("charges.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> Response:
    charge = await session.scalar(select(Charge).where(Charge.external_id == external_id))
    if charge is None:
        raise APIError("CHARGE_NOT_FOUND", "Cobrança não encontrada.", 404)
    receivable = await session.get(Receivable, charge.receivable_id)
    if receivable is None:
        raise APIError("RECEIVABLE_NOT_FOUND", "Recebível da cobrança não foi encontrado.", 404)
    ensure_company_access(user, receivable.company_id)
    customer = await session.get(Customer, receivable.customer_id)
    company = await session.get(Company, receivable.company_id)
    if customer is None or company is None:
        raise APIError("CHARGE_DOCUMENT_INCOMPLETE", "Dados da cobrança estão incompletos.", 409)

    output = BytesIO()
    pdf = canvas.Canvas(output, pagesize=A4)
    _, height = A4
    pdf.setTitle(f"Cobranca {receivable.document_number}")
    pdf.setFont("Helvetica-Bold", 16)
    pdf.drawString(50, height - 60, company.trade_name or company.legal_name)
    pdf.setFont("Helvetica", 10)
    pdf.drawString(50, height - 80, f"CNPJ/CPF: {company.tax_id}")
    pdf.setFont("Helvetica-Bold", 14)
    pdf.drawString(50, height - 125, "Documento de cobranca - ambiente Sandbox")
    pdf.setFont("Helvetica", 11)
    rows = [
        ("Cliente", customer.name),
        ("CPF/CNPJ", customer.tax_id or "Nao informado"),
        ("Documento", receivable.document_number),
        ("Vencimento", receivable.due_date.strftime("%d/%m/%Y")),
        ("Valor", f"R$ {Decimal(receivable.balance):,.2f}"),
        ("Provedor", charge.provider),
        ("Nosso numero", charge.our_number or "-"),
        ("Linha digitavel", charge.digitable_line or "-"),
        ("PIX copia e cola", charge.pix_copy_paste or "-"),
    ]
    y = height - 165
    for label, value in rows:
        pdf.setFont("Helvetica-Bold", 9)
        pdf.drawString(50, y, f"{label}:")
        pdf.setFont("Helvetica", 9)
        pdf.drawString(145, y, str(value)[:95])
        y -= 24
    pdf.setFont("Helvetica-Oblique", 8)
    pdf.drawString(50, 45, "Documento gerado pelo provider SANDBOX. Nao possui validade bancaria.")
    pdf.showPage()
    pdf.save()
    content = output.getvalue()
    return Response(
        content=content,
        media_type="application/pdf",
        headers={"Content-Disposition": f'inline; filename="cobranca-{receivable.document_number}.pdf"'},
    )


@router.post("/payments", response_model=SuccessResponse[PaymentRead], status_code=201)
async def create_manual_payment(
    payload: PaymentCreate,
    user: AuthUser = Depends(require_permission("payments.create")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[PaymentRead]:
    receivable = await session.get(Receivable, payload.receivable_id)
    if receivable is None:
        raise APIError("RECEIVABLE_NOT_FOUND", "Conta a receber não encontrada.", 404)
    ensure_company_access(user, receivable.company_id)
    payment = await BillingService(session).register_payment(
        receivable_id=str(payload.receivable_id),
        charge_id=str(payload.charge_id) if payload.charge_id else None,
        provider=payload.provider,
        external_id=payload.external_id,
        end_to_end_id=payload.end_to_end_id,
        amount=payload.amount,
        paid_at=payload.paid_at,
        payment_method=payload.payment_method,
    )
    return SuccessResponse(data=PaymentRead.model_validate(payment))


@router.get("/payments", response_model=SuccessResponse[list[PaymentRead]])
async def list_payments(
    receivable_id: UUID | None = Query(default=None),
    user: AuthUser = Depends(require_permission("payments.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[PaymentRead]]:
    stmt = select(Payment).join(Receivable, Payment.receivable_id == Receivable.id)
    if receivable_id:
        stmt = stmt.where(Payment.receivable_id == receivable_id)
    company_ids = accessible_company_ids(user)
    if company_ids is not None:
        stmt = stmt.where(Receivable.company_id.in_(company_ids))
    items = list((await session.execute(stmt.order_by(Payment.paid_at.desc()).limit(500))).scalars())
    return SuccessResponse(data=[PaymentRead.model_validate(item) for item in items])


@router.post("/cnab/remittances", response_model=SuccessResponse[dict], status_code=201)
async def generate_cnab_remittance(
    payload: CNABGenerateRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("cnab.generate")),
    session: AsyncSession = Depends(get_tenant_db),
    entitlements: TenantEntitlements = Depends(get_tenant_entitlements),
) -> SuccessResponse[dict]:
    entitlements.require_feature("cnab")
    agreement = await session.get(BankAgreement, payload.bank_agreement_id)
    if agreement is None or not agreement.is_active:
        raise APIError("BANK_AGREEMENT_NOT_FOUND", "Convênio bancário não encontrado.", 404)
    ensure_company_access(user, agreement.company_id)
    account = await session.get(BankAccount, agreement.bank_account_id)
    company = await session.get(Company, agreement.company_id)
    if account is None or company is None:
        raise APIError("BANK_CONFIGURATION_INCOMPLETE", "Conta bancária ou empresa não encontrada.", 409)
    receivables = list(
        (
            await session.execute(
                select(Receivable).where(
                    Receivable.id.in_(payload.receivable_ids),
                    Receivable.company_id == agreement.company_id,
                    Receivable.status.in_(["OPEN", "REGISTERED"]),
                )
            )
        ).scalars()
    )
    if len(receivables) != len(set(payload.receivable_ids)):
        raise APIError("CNAB_RECEIVABLES_INVALID", "Há títulos inexistentes, de outra empresa ou indisponíveis.", 422)
    titles: list[CNABTitle] = []
    for receivable in receivables:
        customer = await session.get(Customer, receivable.customer_id)
        if customer is None:
            raise APIError("CUSTOMER_NOT_FOUND", "Cliente de um dos títulos não foi encontrado.", 409)
        address = customer.address or {}
        charge = await session.scalar(
            select(Charge).where(Charge.receivable_id == receivable.id).order_by(Charge.created_at.desc())
        )
        titles.append(
            CNABTitle(
                document_number=receivable.document_number,
                our_number=charge.our_number if charge and charge.our_number else receivable.document_number[-20:],
                due_date=receivable.due_date,
                amount=Decimal(receivable.balance),
                payer_name=customer.name,
                payer_tax_id=customer.tax_id or "",
                payer_address=str(address.get("street") or ""),
                payer_zip_code=str(address.get("zip_code") or ""),
                payer_city=str(address.get("city") or ""),
                payer_state=str(address.get("state") or ""),
            )
        )
    last_sequence = await session.scalar(
        select(func.max(CNABRemittance.sequence)).where(CNABRemittance.bank_agreement_id == agreement.id)
    ) or 0
    sequence = int(last_sequence) + 1
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
    if layout == "400":
        generator = CNAB400Generator(
            cnab_company,
            sequence=sequence,
            generation_date=datetime.now(UTC).date(),
            layout=CNAB400Layout(wallet=agreement.wallet or ""),
        )
    elif layout == "240":
        generator = CNAB240Generator(
            cnab_company, sequence=sequence, generation_date=datetime.now(UTC).date()
        )
    else:
        raise APIError("CNAB_LAYOUT_UNSUPPORTED", "Layout CNAB não suportado.", 422, {"layout": layout})
    content = generator.generate(titles)
    digest = hashlib.sha256(content).hexdigest()
    key = f"cnab/remittances/{datetime.now(UTC):%Y/%m}/REM-{account.bank_code}-{sequence:06d}-CNAB{layout}.REM"
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
    await session.commit()
    return SuccessResponse(
        data={
            "id": str(remittance.id),
            "sequence": sequence,
            "object_key": key,
            "sha256": digest,
            "record_count": remittance.record_count,
            "total_amount": str(remittance.total_amount),
            "download_url": await storage.presigned_url(context.storage_bucket, key),
        }
    )


@router.post("/cnab/returns", response_model=SuccessResponse[dict], status_code=201)
async def import_cnab_return(
    company_id: UUID = Query(...),
    file: UploadFile = File(...),
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("cnab.import")),
    session: AsyncSession = Depends(get_tenant_db),
    entitlements: TenantEntitlements = Depends(get_tenant_entitlements),
) -> SuccessResponse[dict]:
    entitlements.require_feature("cnab")
    ensure_company_access(user, company_id)
    if await session.get(Company, company_id) is None:
        raise APIError("COMPANY_NOT_FOUND", "Empresa não encontrada.", 404)
    content = await file.read()
    if not content:
        raise APIError("EMPTY_CNAB_FILE", "Arquivo CNAB vazio.", 422)
    digest = hashlib.sha256(content).hexdigest()
    existing = await session.scalar(select(CNABReturn).where(CNABReturn.sha256 == digest))
    if existing:
        return SuccessResponse(data={"id": str(existing.id), "status": existing.status, "idempotent": True})
    first_line = next((line for line in content.decode("latin-1", errors="ignore").splitlines() if line.strip()), "")
    try:
        if len(first_line) == 240:
            layout = "240"
            events = CNAB240ReturnParser().parse(content)
        elif len(first_line) == 400:
            layout = "400"
            events = CNAB400ReturnParser().parse(content)
        else:
            raise ValueError("Não foi possível identificar o layout CNAB 240/400 pelo tamanho do registro.")
    except ValueError as exc:
        raise APIError("INVALID_CNAB_RETURN", str(exc), 422) from exc
    bank_code = (
        first_line[:3] if layout == "240" else first_line[76:79]
    ).strip()
    filename = file.filename or f"return-{uuid4().hex}.RET"
    key = f"cnab/returns/{company_id}/{datetime.now(UTC):%Y/%m}/{digest[:12]}-{filename}"
    await storage.put_bytes(context.storage_bucket, key, content, "text/plain")
    def json_value(value: object) -> object:
        if isinstance(value, (date, datetime)):
            return value.isoformat()
        if isinstance(value, Decimal):
            return str(value)
        if isinstance(value, dict):
            return {str(key): json_value(item) for key, item in value.items()}
        if isinstance(value, (list, tuple)):
            return [json_value(item) for item in value]
        return value

    def json_safe(event: dict[str, object]) -> dict[str, object]:
        return {event_key: json_value(value) for event_key, value in event.items()}

    item = CNABReturn(
        company_id=company_id,
        bank_code=bank_code,
        layout=layout,
        filename=filename,
        object_key=key,
        sha256=digest,
        status="PROCESSING",
        event_count=len(events),
        raw_summary={"events": [json_safe(event) for event in events[:500]]},
    )
    session.add(item)
    await session.flush()

    matched = 0
    unmatched = 0
    liquidated = 0
    registered = 0
    rejected = 0
    cancelled = 0
    protested = 0
    billing = BillingService(session)
    for event in events:
        our_number = str(event.get("our_number") or "").strip()
        normalized_our_number = str(event.get("our_number_normalized") or our_number).strip()
        document_number = str(event.get("document_number") or "").strip()
        normalized_document_number = str(
            event.get("document_number_normalized") or document_number
        ).strip()
        charge = None
        receivable = None

        # O mesmo nosso número pode existir em convênios distintos. Sempre
        # limite a busca à empresa informada na importação para impedir
        # associação cruzada dentro do tenant.
        if our_number or normalized_our_number:
            charge = await session.scalar(
                select(Charge)
                .join(Receivable, Receivable.id == Charge.receivable_id)
                .where(
                    Receivable.company_id == company_id,
                    or_(
                        Charge.our_number == our_number,
                        func.ltrim(Charge.our_number, "0") == normalized_our_number,
                    ),
                )
                .order_by(Charge.created_at.desc())
            )
        if charge is not None:
            receivable = await session.get(Receivable, charge.receivable_id)

        if receivable is None and (document_number or normalized_document_number):
            receivable = await session.scalar(
                select(Receivable).where(
                    Receivable.company_id == company_id,
                    or_(
                        Receivable.document_number == document_number,
                        func.ltrim(Receivable.document_number, "0")
                        == normalized_document_number,
                    ),
                )
            )
            if receivable is not None and charge is None:
                charge = await session.scalar(
                    select(Charge)
                    .where(Charge.receivable_id == receivable.id)
                    .order_by(Charge.created_at.desc())
                )

        occurrence_code = str(event.get("occurrence_code") or "")
        event_status = "MATCHED" if receivable is not None else "UNMATCHED"
        if receivable is not None:
            matched += 1
        else:
            unmatched += 1

        cnab_event = CNABEvent(
            return_id=item.id,
            receivable_id=receivable.id if receivable else None,
            charge_id=charge.id if charge else None,
            occurrence_code=occurrence_code,
            occurrence_description=str(
                event.get("occurrence_description") or f"Ocorrência {occurrence_code}"
            ),
            our_number=our_number or None,
            amount=(
                event.get("amount")
                if isinstance(event.get("amount"), Decimal)
                else None
            ),
            occurrence_date=(
                event.get("occurrence_date")
                if isinstance(event.get("occurrence_date"), date)
                else None
            ),
            status=event_status,
            raw_data=json_safe(event),
        )
        session.add(cnab_event)

        if charge is not None:
            if occurrence_code == "02":
                charge.status = "REGISTERED"
                if receivable is not None and receivable.status == "OPEN":
                    receivable.status = "REGISTERED"
                registered += 1
                cnab_event.status = "APPLIED"
            elif occurrence_code == "03":
                charge.status = "FAILED"
                if receivable is not None and receivable.status == "REGISTERED":
                    receivable.status = "OPEN"
                rejected += 1
                cnab_event.status = "APPLIED"
            elif occurrence_code in {"09", "10"}:
                charge.status = "CANCELLED"
                if receivable is not None and receivable.status == "REGISTERED":
                    receivable.status = "OPEN"
                cancelled += 1
                cnab_event.status = "APPLIED"

        if receivable is not None and occurrence_code in {"19", "23"}:
            receivable.status = "PROTESTED"
            protested += 1
            cnab_event.status = "APPLIED"

        if receivable is not None and occurrence_code in {"06", "15", "17"}:
            paid_amount = event.get("amount")
            if not isinstance(paid_amount, Decimal) or paid_amount <= 0:
                paid_amount = event.get("title_amount")
            if isinstance(paid_amount, Decimal) and paid_amount > 0:
                paid_at_date = event.get("occurrence_date")
                paid_at = (
                    datetime.combine(paid_at_date, datetime.min.time(), tzinfo=UTC)
                    if isinstance(paid_at_date, date)
                    else datetime.now(UTC)
                )
                payment = await billing.register_payment(
                    receivable_id=str(receivable.id),
                    charge_id=str(charge.id) if charge else None,
                    provider=f"CNAB{bank_code}",
                    external_id=(
                        f"CNAB-{digest[:20]}-{layout}-{event.get('sequence')}"
                    ),
                    amount=paid_amount,
                    paid_at=paid_at,
                    payment_method="CNAB",
                    raw_payload=json_safe(event),
                    commit=False,
                )
                if charge is not None:
                    charge.status = "PAID"
                cnab_event.status = "APPLIED"
                cnab_event.amount = paid_amount
                cnab_event.raw_data = {
                    **json_safe(event),
                    "payment_id": str(payment.id),
                }
                liquidated += 1

    item.status = "PROCESSED" if unmatched == 0 else "PROCESSED_WITH_WARNINGS"
    item.processed_at = datetime.now(UTC)
    item.raw_summary = {
        "events": [json_safe(event) for event in events[:500]],
        "matched": matched,
        "unmatched": unmatched,
        "liquidated": liquidated,
        "registered": registered,
        "rejected": rejected,
        "cancelled": cancelled,
        "protested": protested,
    }
    await session.commit()
    return SuccessResponse(
        data={
            "id": str(item.id),
            "status": item.status,
            "events": len(events),
            "matched": matched,
            "unmatched": unmatched,
            "liquidated": liquidated,
            "registered": registered,
            "rejected": rejected,
            "cancelled": cancelled,
            "protested": protested,
            "sha256": digest,
            "object_key": key,
        }
    )
