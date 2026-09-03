from __future__ import annotations

from datetime import UTC, date, datetime, timedelta
from typing import Any
from uuid import UUID

from fastapi import APIRouter, Depends, Query
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import (
    accessible_company_ids,
    ensure_company_access,
    get_tenant_context_dep,
    get_tenant_db,
    require_permission,
)
from app.core.errors import APIError
from app.core.tenant_context import TenantContext
from app.db.platform import get_platform_session
from app.models.banking import BankConnection
from app.models.banking_platform import BankInstitution
from app.models.tenant import BankAccount, BankTransaction, OutboxEvent
from app.providers.banking.core.capabilities import BankingEnvironment
from app.providers.banking.core.credentials import (
    certificate_metadata,
    decrypt_credentials,
    encrypt_credentials,
    validate_credentials,
)
from app.providers.banking.core.normalization import sanitize_mapping
from app.providers.banking.registry import banking_providers
from app.schemas.auth import AuthUser
from app.schemas.banking import BankConnectionCreate, BankConnectionSyncRequest, BankConnectionUpdate
from app.schemas.common import SuccessResponse
from app.services.audit import tenant_audit
from app.services.bank_institutions import BankInstitutionCatalogService
from app.services.banking_entitlements import require_provider_entitlement, tenant_provider_decisions
from app.services.banking_gateway import BankingGateway
from app.services.reconciliation_engine import ReconciliationEngine

router = APIRouter(prefix="/api/v1/banking", tags=["Banking Provider Framework"])


def _connection_dict(item: BankConnection) -> dict[str, Any]:
    manifest = banking_providers.manifest(item.provider)
    return {
        "id": str(item.id),
        "company_id": str(item.company_id),
        "bank_account_id": str(item.bank_account_id),
        "provider": item.provider,
        "provider_name": manifest.name,
        "provider_status": manifest.status.value,
        "environment": item.environment,
        "auth_type": item.auth_type,
        "settings": item.settings,
        "credential_version": item.credential_version,
        "has_credentials": bool(item.encrypted_credentials),
        "certificate": {
            "issuer": item.certificate_issuer,
            "serial": item.certificate_serial,
            "subject": item.certificate_subject,
            "not_before": item.certificate_not_before.isoformat() if item.certificate_not_before else None,
            "not_after": item.certificate_expires_at.isoformat() if item.certificate_expires_at else None,
            "fingerprint_sha256": item.certificate_fingerprint_sha256,
        },
        "last_health_status": item.last_health_status,
        "last_health_at": item.last_health_at.isoformat() if item.last_health_at else None,
        "last_success_at": item.last_success_at.isoformat() if item.last_success_at else None,
        "last_error": item.last_error,
        "is_active": item.is_active,
        "created_at": item.created_at.isoformat(),
        "updated_at": item.updated_at.isoformat(),
    }


def _institution_dict(item: BankInstitution) -> dict[str, Any]:
    return {
        "id": str(item.id),
        "bank_code": item.bank_code,
        "ispb": item.ispb,
        "cnpj": item.cnpj,
        "legal_name": item.legal_name,
        "short_name": item.short_name,
        "institution_type": item.institution_type,
        "pix_participant": item.pix_participant,
        "str_participant": item.str_participant,
        "active": item.active,
        "source": item.source,
        "source_updated_at": item.source_updated_at.isoformat() if item.source_updated_at else None,
    }


@router.get("/providers", response_model=SuccessResponse[list[dict]])
async def list_banking_providers(
    connectable_only: bool = Query(default=False),
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("banking.read")),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[list[dict]]:
    decisions = {
        item.provider: item
        for item in await tenant_provider_decisions(platform_session, tenant_id=context.tenant_id)
    }
    manifests = banking_providers.connectable_manifests() if connectable_only else banking_providers.manifests()
    data: list[dict[str, Any]] = []
    for manifest in manifests:
        decision = decisions[manifest.code]
        if not decision.allowed:
            continue
        payload = manifest.public_dict()
        payload["entitlement"] = decision.public_dict()
        data.append(payload)
    await platform_session.commit()
    return SuccessResponse(data=data)


@router.get("/providers/{provider}", response_model=SuccessResponse[dict])
async def banking_provider(
    provider: str,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("banking.read")),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    decision = await require_provider_entitlement(
        platform_session,
        tenant_id=context.tenant_id,
        provider_code=provider,
    )
    payload = banking_providers.manifest(provider).public_dict()
    payload["entitlement"] = decision.public_dict()
    await platform_session.commit()
    return SuccessResponse(data=payload)


@router.get("/support-matrix", response_model=SuccessResponse[list[dict]])
async def banking_support_matrix(
    _: AuthUser = Depends(require_permission("banking.read")),
) -> SuccessResponse[list[dict]]:
    return SuccessResponse(data=banking_providers.support_matrix())


@router.get("/institutions", response_model=SuccessResponse[list[dict]])
async def list_bank_institutions(
    q: str | None = Query(default=None, max_length=120),
    active_only: bool = Query(default=True),
    _: AuthUser = Depends(require_permission("banking.read")),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[list[dict]]:
    service = BankInstitutionCatalogService(platform_session)
    await service.ensure_manifest_seeds()
    await platform_session.commit()
    stmt = select(BankInstitution)
    if active_only:
        stmt = stmt.where(BankInstitution.active.is_(True))
    if q:
        term = f"%{q.strip()}%"
        stmt = stmt.where(
            BankInstitution.short_name.ilike(term)
            | BankInstitution.legal_name.ilike(term)
            | BankInstitution.bank_code.ilike(term)
            | BankInstitution.ispb.ilike(term)
        )
    items = list((await platform_session.scalars(stmt.order_by(BankInstitution.short_name).limit(1000))).all())
    return SuccessResponse(data=[_institution_dict(item) for item in items])


@router.get("/connections", response_model=SuccessResponse[list[dict]])
async def list_bank_connections(
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    stmt = select(BankConnection).order_by(BankConnection.created_at.desc())
    allowed = accessible_company_ids(user)
    if allowed is not None:
        stmt = stmt.where(BankConnection.company_id.in_(allowed))
    return SuccessResponse(data=[_connection_dict(item) for item in (await session.scalars(stmt)).all()])


@router.get("/connections/{connection_id}", response_model=SuccessResponse[dict])
async def get_bank_connection(
    connection_id: UUID,
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.get(BankConnection, connection_id)
    if item is None:
        raise APIError("BANK_CONNECTION_NOT_FOUND", "Conexão bancária não encontrada.", 404)
    ensure_company_access(user, item.company_id)
    return SuccessResponse(data=_connection_dict(item))


@router.post("/connections", response_model=SuccessResponse[dict], status_code=201)
async def create_bank_connection(
    payload: BankConnectionCreate,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    ensure_company_access(user, payload.company_id)
    account = await session.get(BankAccount, payload.bank_account_id)
    if account is None or account.company_id != payload.company_id:
        raise APIError("BANK_ACCOUNT_NOT_FOUND", "Conta bancária não encontrada para esta empresa.", 404)
    manifest = banking_providers.manifest(payload.provider)
    if not manifest.implementation_available:
        raise APIError(
            "BANKING_PROVIDER_NOT_AVAILABLE",
            "A instituição está no catálogo, mas este driver ainda não está liberado para conexão nesta versão.",
            422,
            {"provider": manifest.code, "status": manifest.status.value},
        )
    await require_provider_entitlement(
        platform_session,
        tenant_id=context.tenant_id,
        provider_code=manifest.code,
    )
    try:
        environment = BankingEnvironment(payload.environment)
    except ValueError as exc:
        raise APIError("BANK_INVALID_CONFIGURATION", "Ambiente bancário inválido.", 422) from exc
    if environment not in manifest.environments:
        raise APIError(
            "BANK_INVALID_CONFIGURATION",
            "O provider não suporta o ambiente selecionado.",
            422,
            {"provider": manifest.code, "environment": environment.value},
        )
    validate_credentials(manifest, payload.credentials)

    institution = None
    if payload.institution_id:
        institution = await platform_session.get(BankInstitution, payload.institution_id)
        if institution is None:
            raise APIError("BANK_INSTITUTION_NOT_FOUND", "Instituição financeira não encontrada no catálogo.", 404)

    item = BankConnection(
        company_id=payload.company_id,
        bank_account_id=payload.bank_account_id,
        provider=manifest.code,
        environment=environment.value,
        auth_type=manifest.authentication.auth_type.value,
        encrypted_credentials=encrypt_credentials(payload.credentials),
        settings=payload.settings,
        credential_version=1,
        is_active=payload.is_active,
        last_health_status="DISCONNECTED",
    )
    certificate = payload.credentials.get("certificate")
    if certificate:
        meta = certificate_metadata(
            str(certificate),
            password=str(payload.credentials.get("certificate_password") or "") or None,
            container=str(payload.settings.get("certificate_container") or "PEM"),
        )
        item.certificate_issuer = meta.issuer
        item.certificate_serial = meta.serial
        item.certificate_subject = meta.subject
        item.certificate_not_before = meta.not_before
        item.certificate_expires_at = meta.not_after
        item.certificate_fingerprint_sha256 = meta.fingerprint_sha256

    session.add(item)
    await session.flush()
    if institution:
        await session.execute(
            text("UPDATE bank_accounts SET ispb=:ispb, institution_id=:institution_id WHERE id=:account_id"),
            {"ispb": institution.ispb, "institution_id": str(institution.id), "account_id": str(account.id)},
        )
    await tenant_audit(
        session,
        action="bank.connection.created",
        entity_type="BankConnection",
        entity_id=str(item.id),
        actor_id=user.id,
        company_id=str(item.company_id),
        after={
            "provider": item.provider,
            "environment": item.environment,
            "bank_account_id": str(item.bank_account_id),
            "credential_version": item.credential_version,
        },
    )
    await platform_session.commit()
    await session.commit()
    await session.refresh(item)
    return SuccessResponse(data=_connection_dict(item))


@router.patch("/connections/{connection_id}", response_model=SuccessResponse[dict])
async def update_bank_connection(
    connection_id: UUID,
    payload: BankConnectionUpdate,
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    item = await session.scalar(select(BankConnection).where(BankConnection.id == connection_id).with_for_update())
    if item is None:
        raise APIError("BANK_CONNECTION_NOT_FOUND", "Conexão bancária não encontrada.", 404)
    ensure_company_access(user, item.company_id)
    manifest = banking_providers.manifest(item.provider)
    before = _connection_dict(item)
    if payload.environment is not None:
        environment = BankingEnvironment(payload.environment)
        if environment not in manifest.environments:
            raise APIError("BANK_INVALID_CONFIGURATION", "Ambiente não suportado pelo provider.", 422)
        item.environment = environment.value
    if payload.settings is not None:
        item.settings = {**dict(item.settings or {}), **payload.settings}
    if payload.credentials:
        credentials = decrypt_credentials(item.encrypted_credentials)
        credentials.update({key: value for key, value in payload.credentials.items() if value not in (None, "")})
        validate_credentials(manifest, credentials)
        item.encrypted_credentials = encrypt_credentials(credentials)
        item.credential_version += 1
        certificate = credentials.get("certificate")
        if certificate:
            meta = certificate_metadata(
                str(certificate),
                password=str(credentials.get("certificate_password") or "") or None,
                container=str(item.settings.get("certificate_container") or "PEM"),
            )
            item.certificate_issuer = meta.issuer
            item.certificate_serial = meta.serial
            item.certificate_subject = meta.subject
            item.certificate_not_before = meta.not_before
            item.certificate_expires_at = meta.not_after
            item.certificate_fingerprint_sha256 = meta.fingerprint_sha256
    if payload.is_active is not None:
        item.is_active = payload.is_active
    item.last_health_status = "DISCONNECTED"
    item.last_error = None
    await tenant_audit(
        session,
        action="bank.connection.updated",
        entity_type="BankConnection",
        entity_id=str(item.id),
        actor_id=user.id,
        company_id=str(item.company_id),
        before={"environment": before["environment"], "credential_version": before["credential_version"], "is_active": before["is_active"]},
        after={"environment": item.environment, "credential_version": item.credential_version, "is_active": item.is_active},
    )
    await session.commit()
    await session.refresh(item)
    return SuccessResponse(data=_connection_dict(item))


async def _entitled_connection(
    connection_id: UUID,
    context: TenantContext,
    user: AuthUser,
    session: AsyncSession,
    platform_session: AsyncSession,
) -> BankConnection:
    item = await session.get(BankConnection, connection_id)
    if item is None:
        raise APIError("BANK_CONNECTION_NOT_FOUND", "Conexão bancária não encontrada.", 404)
    ensure_company_access(user, item.company_id)
    await require_provider_entitlement(
        platform_session,
        tenant_id=context.tenant_id,
        provider_code=item.provider,
    )
    await platform_session.commit()
    return item


@router.post("/connections/{connection_id}/validate", response_model=SuccessResponse[dict])
async def validate_bank_connection(
    connection_id: UUID,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    await _entitled_connection(connection_id, context, user, session, platform_session)
    return SuccessResponse(
        data=await BankingGateway(session, tenant_id=context.tenant_id).validate_connection(
            connection_id,
            actor_id=user.id,
        )
    )


@router.get("/connections/{connection_id}/balance", response_model=SuccessResponse[dict])
async def bank_connection_balance(
    connection_id: UUID,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    await _entitled_connection(connection_id, context, user, session, platform_session)
    gateway = BankingGateway(session, tenant_id=context.tenant_id)
    return SuccessResponse(data=gateway.public_balance(await gateway.get_balance(connection_id)))


@router.get("/connections/{connection_id}/transactions", response_model=SuccessResponse[list[dict]])
async def bank_connection_transactions(
    connection_id: UUID,
    limit: int = Query(default=200, ge=1, le=1000),
    user: AuthUser = Depends(require_permission("banking.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[list[dict]]:
    connection = await session.get(BankConnection, connection_id)
    if connection is None:
        raise APIError("BANK_CONNECTION_NOT_FOUND", "Conexão bancária não encontrada.", 404)
    ensure_company_access(user, connection.company_id)
    items = list((await session.scalars(
        select(BankTransaction)
        .where(BankTransaction.bank_account_id == connection.bank_account_id)
        .order_by(BankTransaction.transaction_date.desc(), BankTransaction.created_at.desc())
        .limit(limit)
    )).all())
    return SuccessResponse(data=[
        {
            "id": str(item.id),
            "external_id": item.external_id,
            "transaction_date": item.transaction_date.isoformat(),
            "posted_at": item.posted_at.isoformat() if item.posted_at else None,
            "amount": str(item.amount),
            "transaction_type": item.transaction_type,
            "description": item.description,
            "document_number": item.document_number,
            "end_to_end_id": item.end_to_end_id,
            "reconciliation_status": item.reconciliation_status,
            "raw_summary": sanitize_mapping({key: value for key, value in dict(item.raw_payload or {}).items() if key not in {"payload", "body"}}),
        }
        for item in items
    ])


@router.post("/connections/{connection_id}/sync", response_model=SuccessResponse[dict])
async def sync_bank_connection(
    connection_id: UUID,
    payload: BankConnectionSyncRequest,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("banking.manage")),
    session: AsyncSession = Depends(get_tenant_db),
    platform_session: AsyncSession = Depends(get_platform_session),
) -> SuccessResponse[dict]:
    connection = await _entitled_connection(connection_id, context, user, session, platform_session)
    gateway = BankingGateway(session, tenant_id=context.tenant_id)
    resources = payload.resources or ["STATEMENT"]
    result: dict[str, Any] = {"connection_id": str(connection_id), "resources": {}}
    if "BALANCE" in resources:
        balance = await gateway.get_balance(connection_id)
        result["resources"]["BALANCE"] = gateway.public_balance(balance)
    if "STATEMENT" in resources:
        end_date = payload.end_date or date.today()
        start_date = payload.start_date or (end_date - timedelta(days=30))
        statement = await gateway.get_statement(connection_id, start_date=start_date, end_date=end_date)
        imported = 0
        duplicate = 0
        engine = ReconciliationEngine(session)
        for tx in statement.transactions:
            external_id = tx.external_id or tx.provider_transaction_id
            existing = await session.scalar(
                select(BankTransaction).where(
                    BankTransaction.bank_account_id == connection.bank_account_id,
                    BankTransaction.external_id == external_id,
                )
            )
            if existing:
                duplicate += 1
                continue
            item = BankTransaction(
                bank_account_id=connection.bank_account_id,
                external_id=external_id,
                transaction_date=tx.transaction_date,
                posted_at=tx.posted_at,
                amount=tx.amount,
                transaction_type=tx.transaction_type,
                description=tx.description,
                document_number=tx.document_number,
                end_to_end_id=tx.end_to_end_id,
                raw_payload={
                    **tx.raw_response,
                    "provider": connection.provider,
                    "provider_transaction_id": tx.provider_transaction_id,
                    "txid": tx.txid,
                    "bank_reference": tx.bank_reference,
                    "provider_status": tx.provider_status,
                    "provider_metadata": tx.provider_metadata,
                },
                reconciliation_status="UNMATCHED",
            )
            session.add(item)
            await session.flush()
            decision = await engine.decide(item)
            await engine.persist_decision(item, decision)
            await session.execute(
                text(
                    "UPDATE bank_transactions SET provider=:provider, provider_transaction_id=:provider_id, "
                    "txid=:txid, bank_reference=:bank_reference, source='DIRECT_API' WHERE id=:id"
                ),
                {
                    "provider": connection.provider,
                    "provider_id": tx.provider_transaction_id,
                    "txid": tx.txid,
                    "bank_reference": tx.bank_reference,
                    "id": str(item.id),
                },
            )
            imported += 1
        await gateway.update_sync_state(
            connection_id,
            "STATEMENT",
            cursor=statement.next_cursor,
            sync_from=datetime.combine(start_date, datetime.min.time(), tzinfo=UTC),
            sync_to=datetime.combine(end_date, datetime.max.time(), tzinfo=UTC),
        )
        session.add(
            OutboxEvent(
                aggregate_type="BankConnection",
                aggregate_id=str(connection_id),
                event_type="bank.transaction.imported",
                payload={
                    "connection_id": str(connection_id),
                    "company_id": str(connection.company_id),
                    "provider": connection.provider,
                    "imported": imported,
                    "duplicates": duplicate,
                },
            )
        )
        result["resources"]["STATEMENT"] = {
            "imported": imported,
            "duplicates": duplicate,
            "next_cursor": statement.next_cursor,
            "has_more": statement.has_more,
        }
    await session.commit()
    return SuccessResponse(data=result)
