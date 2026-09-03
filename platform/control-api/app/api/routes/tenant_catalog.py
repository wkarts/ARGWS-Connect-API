from __future__ import annotations

from datetime import timedelta
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import current_connect_api_tser, ensure_company_access, get_tenant_db, get_tenant_entitlements, require_permission
from app.core.errors import APIError
from app.models.tenant import (
    Company,
    Contract,
    Customer,
    CustomerContact,
    ServiceCatalog,
)
from app.schemas.auth import AuthUser
from app.schemas.common import PaginatedResponse, PaginationMeta, SuccessResponse
from app.schemas.tenant import (
    CompanyCreate,
    CompanyRead,
    ContractCreate,
    ContractRead,
    CustomerCreate,
    CustomerRead,
    CustomerUpdate,
    ServiceCreate,
    ServiceRead,
)
from app.services.audit import tenant_audit
from app.services.entitlements import TenantEntitlements

router = APIRouter(prefix="/api/v1", tags=["Tenant - Cadastros"])


@router.get("/companies", response_model=SuccessResponse[list[CompanyRead]])
async def list_companies(
    user: AuthUser = Depends(current_connect_api_tser),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[CompanyRead]]:
    stmt = select(Company).where(Company.is_active.is_(True)).order_by(Company.legal_name)
    if user.role != "TENANT_ADMIN" and "*" not in user.permissions:
        stmt = stmt.where(Company.id.in_([UUID(value) for value in user.companies]))
    companies = list((await session.execute(stmt)).scalars())
    return SuccessResponse(data=[CompanyRead.model_validate(item) for item in companies])


@router.post("/companies", response_model=SuccessResponse[CompanyRead], status_code=201)
async def create_company(
    payload: CompanyCreate,
    user: AuthUser = Depends(require_permission("companies.create")),
    session: AsyncSession = Depends(get_tenant_db),
    entitlements: TenantEntitlements = Depends(get_tenant_entitlements),
) -> SuccessResponse[CompanyRead]:
    company_count = await session.scalar(select(func.count()).select_from(Company)) or 0
    entitlements.enforce_limit("companies", int(company_count))
    if await session.scalar(select(Company.id).where(Company.tax_id == payload.tax_id)):
        raise APIError("COMPANY_TAX_ID_EXISTS", "Já existe uma empresa com este CNPJ/CPF.", 409)
    company = Company(**payload.model_dump())
    session.add(company)
    await session.flush()
    await tenant_audit(
        session,
        action="company.created",
        entity_type="Company",
        entity_id=str(company.id),
        actor_id=user.id,
        company_id=str(company.id),
        after=payload.model_dump(mode="json"),
    )
    await session.commit()
    await session.refresh(company)
    return SuccessResponse(data=CompanyRead.model_validate(company))


@router.get("/customers", response_model=PaginatedResponse[CustomerRead])
async def list_customers(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=25, ge=1, le=100),
    q: str | None = Query(default=None),
    active: bool | None = Query(default=True),
    _: AuthUser = Depends(require_permission("customers.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> PaginatedResponse[CustomerRead]:
    filters = []
    if q:
        filters.append(
            or_(Customer.name.ilike(f"%{q}%"), Customer.trade_name.ilike(f"%{q}%"), Customer.tax_id.ilike(f"%{q}%"))
        )
    if active is not None:
        filters.append(Customer.is_active.is_(active))
    total = await session.scalar(select(func.count()).select_from(Customer).where(*filters)) or 0
    items = list(
        (
            await session.execute(
                select(Customer)
                .where(*filters)
                .order_by(Customer.name)
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        ).scalars()
    )
    return PaginatedResponse(
        data=[CustomerRead.model_validate(item) for item in items],
        meta=PaginationMeta(
            page=page,
            per_page=per_page,
            total=total,
            pages=(total + per_page - 1) // per_page,
        ),
    )


@router.post("/customers", response_model=SuccessResponse[CustomerRead], status_code=201)
async def create_customer(
    payload: CustomerCreate,
    user: AuthUser = Depends(require_permission("customers.create")),
    session: AsyncSession = Depends(get_tenant_db),
    entitlements: TenantEntitlements = Depends(get_tenant_entitlements),
) -> SuccessResponse[CustomerRead]:
    customer_count = await session.scalar(select(func.count()).select_from(Customer)) or 0
    entitlements.enforce_limit("customers", int(customer_count))
    if payload.tax_id and await session.scalar(select(Customer.id).where(Customer.tax_id == payload.tax_id)):
        raise APIError("CUSTOMER_TAX_ID_EXISTS", "Já existe um cliente com este CPF/CNPJ.", 409)
    values = payload.model_dump(exclude={"contacts"})
    customer = Customer(**values)
    session.add(customer)
    await session.flush()
    for contact in payload.contacts:
        session.add(CustomerContact(customer_id=customer.id, **contact.model_dump()))
    await tenant_audit(
        session,
        action="customer.created",
        entity_type="Customer",
        entity_id=str(customer.id),
        actor_id=user.id,
        after=values,
    )
    await session.commit()
    await session.refresh(customer)
    return SuccessResponse(data=CustomerRead.model_validate(customer))


@router.get("/customers/{customer_id}", response_model=SuccessResponse[CustomerRead])
async def get_customer(
    customer_id: UUID,
    _: AuthUser = Depends(require_permission("customers.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[CustomerRead]:
    customer = await session.get(Customer, customer_id)
    if customer is None:
        raise APIError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404)
    return SuccessResponse(data=CustomerRead.model_validate(customer))


@router.patch("/customers/{customer_id}", response_model=SuccessResponse[CustomerRead])
async def update_customer(
    customer_id: UUID,
    payload: CustomerUpdate,
    user: AuthUser = Depends(require_permission("customers.update")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[CustomerRead]:
    customer = await session.get(Customer, customer_id)
    if customer is None:
        raise APIError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404)
    before = CustomerRead.model_validate(customer).model_dump(mode="json")
    values = payload.model_dump(exclude_unset=True)
    for key, value in values.items():
        setattr(customer, key, value)
    await tenant_audit(
        session,
        action="customer.updated",
        entity_type="Customer",
        entity_id=str(customer.id),
        actor_id=user.id,
        before=before,
        after=values,
    )
    await session.commit()
    await session.refresh(customer)
    return SuccessResponse(data=CustomerRead.model_validate(customer))


@router.get("/services", response_model=SuccessResponse[list[ServiceRead]])
async def list_services(
    _: AuthUser = Depends(require_permission("services.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[ServiceRead]]:
    items = list((await session.execute(select(ServiceCatalog).order_by(ServiceCatalog.name))).scalars())
    return SuccessResponse(data=[ServiceRead.model_validate(item) for item in items])


@router.post("/services", response_model=SuccessResponse[ServiceRead], status_code=201)
async def create_service(
    payload: ServiceCreate,
    user: AuthUser = Depends(require_permission("services.create")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[ServiceRead]:
    if await session.scalar(select(ServiceCatalog.id).where(ServiceCatalog.code == payload.code.upper())):
        raise APIError("SERVICE_CODE_EXISTS", "Código de serviço já cadastrado.", 409)
    item = ServiceCatalog(**payload.model_dump(), code=payload.code.upper())
    session.add(item)
    await session.flush()
    await tenant_audit(
        session,
        action="service.created",
        entity_type="Service",
        entity_id=str(item.id),
        actor_id=user.id,
        after=payload.model_dump(mode="json"),
    )
    await session.commit()
    await session.refresh(item)
    return SuccessResponse(data=ServiceRead.model_validate(item))


@router.get("/contracts", response_model=PaginatedResponse[ContractRead])
async def list_contracts(
    page: int = Query(default=1, ge=1),
    per_page: int = Query(default=25, ge=1, le=100),
    status: str | None = Query(default=None),
    company_id: UUID | None = Query(default=None),
    user: AuthUser = Depends(require_permission("contracts.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> PaginatedResponse[ContractRead]:
    filters = []
    if status:
        filters.append(Contract.status == status.upper())
    if company_id:
        ensure_company_access(user, company_id)
        filters.append(Contract.company_id == company_id)
    elif user.role != "TENANT_ADMIN" and "*" not in user.permissions:
        filters.append(Contract.company_id.in_([UUID(value) for value in user.companies]))
    total = await session.scalar(select(func.count()).select_from(Contract).where(*filters)) or 0
    items = list(
        (
            await session.execute(
                select(Contract)
                .where(*filters)
                .order_by(Contract.created_at.desc())
                .offset((page - 1) * per_page)
                .limit(per_page)
            )
        ).scalars()
    )
    return PaginatedResponse(
        data=[ContractRead.model_validate(item) for item in items],
        meta=PaginationMeta(page=page, per_page=per_page, total=total, pages=(total + per_page - 1) // per_page),
    )


@router.post("/contracts", response_model=SuccessResponse[ContractRead], status_code=201)
async def create_contract(
    payload: ContractCreate,
    user: AuthUser = Depends(require_permission("contracts.create")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[ContractRead]:
    ensure_company_access(user, payload.company_id)
    if await session.scalar(select(Contract.id).where(Contract.code == payload.code)):
        raise APIError("CONTRACT_CODE_EXISTS", "Código de contrato já existe.", 409)
    for model, entity_id, code in (
        (Company, payload.company_id, "COMPANY_NOT_FOUND"),
        (Customer, payload.customer_id, "CUSTOMER_NOT_FOUND"),
        (ServiceCatalog, payload.service_id, "SERVICE_NOT_FOUND"),
    ):
        if await session.get(model, entity_id) is None:
            raise APIError(code, "Cadastro relacionado não encontrado.", 404)
    values = payload.model_dump(exclude={"next_generation_date"})
    next_date = payload.next_generation_date or (payload.start_date - timedelta(days=payload.issue_days_before_due))
    contract = Contract(**values, next_generation_date=next_date, status="ACTIVE")
    session.add(contract)
    await session.flush()
    await tenant_audit(
        session,
        action="contract.created",
        entity_type="Contract",
        entity_id=str(contract.id),
        actor_id=user.id,
        company_id=str(contract.company_id),
        after=payload.model_dump(mode="json"),
    )
    await session.commit()
    await session.refresh(contract)
    return SuccessResponse(data=ContractRead.model_validate(contract))
