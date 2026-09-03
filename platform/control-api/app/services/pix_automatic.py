from __future__ import annotations

import json
from datetime import UTC, date, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.secrets import secret_cipher
from app.core.tenant_context import get_tenant_context
from app.db.platform import PlatformSessionLocal
from app.models.tenant import (
    BankAgreement,
    Contract,
    Customer,
    OutboxEvent,
    PixAutomaticInstruction,
    PixAutomaticMandate,
    Receivable,
)
from app.providers.banking import (
    BankCustomer,
    PixAutomaticAuthorizationRequest,
    banking_providers,
)
from app.services.banking_entitlements import require_provider_entitlement


class PixAutomaticService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _require_provider_entitlement(self, provider_name: str) -> None:
        try:
            context = get_tenant_context()
        except RuntimeError as exc:
            raise APIError(
                "TENANT_CONTEXT_REQUIRED",
                "Não é possível executar provider bancário fora de um contexto de tenant.",
                500,
            ) from exc
        async with PlatformSessionLocal() as platform_session:
            await require_provider_entitlement(
                platform_session,
                tenant_id=context.tenant_id,
                provider_code=provider_name,
            )
            await platform_session.commit()

    @staticmethod
    def serialize(item: PixAutomaticMandate) -> dict[str, object]:
        return {
            "id": str(item.id),
            "company_id": str(item.company_id),
            "customer_id": str(item.customer_id),
            "contract_id": str(item.contract_id) if item.contract_id else None,
            "bank_agreement_id": str(item.bank_agreement_id),
            "provider": item.provider,
            "external_id": item.external_id,
            "frequency": item.frequency,
            "start_date": item.start_date.isoformat(),
            "finish_date": item.finish_date.isoformat() if item.finish_date else None,
            "fixed_amount": str(item.fixed_amount) if item.fixed_amount is not None else None,
            "min_limit_value": str(item.min_limit_value) if item.min_limit_value is not None else None,
            "description": item.description,
            "payment_creation_mode": item.payment_creation_mode,
            "retry_policy": item.retry_policy,
            "status": item.status,
            "authorization_url": item.authorization_url,
            "qr_copy_paste": item.qr_copy_paste,
            "qr_encoded_image": item.qr_encoded_image,
            "activated_at": item.activated_at.isoformat() if item.activated_at else None,
            "cancelled_at": item.cancelled_at.isoformat() if item.cancelled_at else None,
            "last_synced_at": item.last_synced_at.isoformat() if item.last_synced_at else None,
            "last_error": item.last_error,
            "created_at": item.created_at.isoformat(),
        }

    async def create(self, payload: object) -> PixAutomaticMandate:
        data = payload.model_dump() if hasattr(payload, "model_dump") else dict(payload)
        return await self.create_mandate(**data)

    async def sync(self, mandate: PixAutomaticMandate) -> PixAutomaticMandate:
        return await self.sync_mandate(mandate)

    async def cancel(self, mandate: PixAutomaticMandate) -> PixAutomaticMandate:
        return await self.cancel_mandate(mandate)

    @staticmethod
    def _agreement_payload(agreement: BankAgreement) -> dict[str, object]:
        credentials = (
            json.loads(secret_cipher.decrypt(agreement.encrypted_credentials))
            if agreement.encrypted_credentials
            else {}
        )
        return {
            "id": str(agreement.id),
            "number": agreement.agreement_number,
            "wallet": agreement.wallet,
            "beneficiary_code": agreement.beneficiary_code,
            "environment": agreement.environment,
            "settings": agreement.settings,
            "credentials": credentials,
        }

    async def create_mandate(
        self,
        *,
        company_id: UUID,
        customer_id: UUID,
        bank_agreement_id: UUID,
        contract_id: UUID | None,
        frequency: str,
        start_date: date,
        finish_date: date | None,
        fixed_amount: Decimal | None,
        min_limit_value: Decimal | None,
        description: str,
        immediate_amount: Decimal,
        immediate_due_date: date,
        payment_creation_mode: str,
        retry_policy: str,
    ) -> PixAutomaticMandate:
        agreement = await self.session.get(BankAgreement, bank_agreement_id)
        if agreement is None or not agreement.is_active:
            raise APIError("BANK_AGREEMENT_NOT_FOUND", "Convênio bancário não encontrado ou inativo.", 404)
        if agreement.company_id != company_id:
            raise APIError("BANK_AGREEMENT_COMPANY_MISMATCH", "O convênio não pertence à empresa informada.", 409)
        customer = await self.session.get(Customer, customer_id)
        if customer is None or not customer.is_active:
            raise APIError("CUSTOMER_NOT_FOUND", "Cliente não encontrado ou inativo.", 404)
        if contract_id is not None:
            contract = await self.session.get(Contract, contract_id)
            if contract is None:
                raise APIError("CONTRACT_NOT_FOUND", "Contrato não encontrado.", 404)
            if contract.company_id != company_id or contract.customer_id != customer_id:
                raise APIError(
                    "CONTRACT_SCOPE_MISMATCH",
                    "O contrato não pertence à empresa e ao cliente informados.",
                    409,
                )
        if fixed_amount is None and min_limit_value is None:
            raise APIError(
                "PIX_AUTOMATIC_VALUE_REQUIRED",
                "Informe valor fixo ou valor mínimo limite para a autorização.",
                422,
            )
        await self._require_provider_entitlement(agreement.provider)
        provider = banking_providers.get(agreement.provider)
        result = await provider.create_pix_automatic_authorization(
            PixAutomaticAuthorizationRequest(
                internal_contract_id=str(contract_id or customer_id),
                customer=BankCustomer(
                    name=customer.name,
                    tax_id=customer.tax_id,
                    email=customer.email,
                    phone=customer.phone,
                    address=customer.address,
                ),
                frequency=frequency,
                start_date=start_date,
                finish_date=finish_date,
                fixed_amount=fixed_amount,
                min_limit_value=min_limit_value,
                description=description,
                immediate_amount=immediate_amount,
                immediate_due_date=immediate_due_date,
                payment_creation_mode=payment_creation_mode,
                retry_policy=retry_policy,
                agreement=self._agreement_payload(agreement),
            )
        )
        existing = await self.session.scalar(
            select(PixAutomaticMandate).where(
                PixAutomaticMandate.provider == result.provider,
                PixAutomaticMandate.external_id == result.external_id,
            )
        )
        if existing is not None:
            return existing
        mandate = PixAutomaticMandate(
            company_id=company_id,
            customer_id=customer_id,
            contract_id=contract_id,
            bank_agreement_id=bank_agreement_id,
            provider=result.provider,
            external_id=result.external_id,
            frequency=frequency.upper(),
            start_date=start_date,
            finish_date=finish_date,
            fixed_amount=fixed_amount,
            min_limit_value=min_limit_value,
            description=description,
            payment_creation_mode=payment_creation_mode.upper(),
            retry_policy=retry_policy.upper(),
            status=result.status,
            authorization_url=result.authorization_url,
            qr_copy_paste=result.qr_copy_paste,
            qr_encoded_image=result.qr_encoded_image,
            raw_payload=result.raw,
            last_synced_at=datetime.now(UTC),
        )
        self.session.add(mandate)
        await self.session.flush()
        self.session.add(
            OutboxEvent(
                aggregate_type="PixAutomaticMandate",
                aggregate_id=str(mandate.id),
                event_type="financial.pix_automatic.authorization.created",
                payload={
                    "mandate_id": str(mandate.id),
                    "company_id": str(company_id),
                    "customer_id": str(customer_id),
                    "contract_id": str(contract_id) if contract_id else None,
                    "status": mandate.status,
                },
            )
        )
        await self.session.commit()
        await self.session.refresh(mandate)
        return mandate

    async def sync_mandate(self, mandate: PixAutomaticMandate) -> PixAutomaticMandate:
        agreement = await self.session.get(BankAgreement, mandate.bank_agreement_id)
        if agreement is None:
            raise APIError("BANK_AGREEMENT_NOT_FOUND", "Convênio bancário não encontrado.", 404)
        await self._require_provider_entitlement(mandate.provider)
        provider = banking_providers.get(mandate.provider)
        try:
            result = await provider.get_pix_automatic_authorization(
                mandate.external_id,
                self._agreement_payload(agreement),
            )
        except Exception as exc:
            mandate.last_error = f"{type(exc).__name__}: {exc}"
            mandate.last_synced_at = datetime.now(UTC)
            await self.session.commit()
            raise
        previous = mandate.status
        mandate.status = result.status
        mandate.authorization_url = result.authorization_url or mandate.authorization_url
        mandate.qr_copy_paste = result.qr_copy_paste or mandate.qr_copy_paste
        mandate.qr_encoded_image = result.qr_encoded_image or mandate.qr_encoded_image
        mandate.raw_payload = result.raw
        mandate.last_synced_at = datetime.now(UTC)
        mandate.last_error = None
        if result.status.upper() in {"ACTIVE", "AUTHORIZED"} and mandate.activated_at is None:
            mandate.activated_at = datetime.now(UTC)
        if previous != mandate.status:
            self.session.add(
                OutboxEvent(
                    aggregate_type="PixAutomaticMandate",
                    aggregate_id=str(mandate.id),
                    event_type="financial.pix_automatic.authorization.status_changed",
                    payload={
                        "mandate_id": str(mandate.id),
                        "company_id": str(mandate.company_id),
                        "customer_id": str(mandate.customer_id),
                        "previous_status": previous,
                        "status": mandate.status,
                    },
                )
            )
        await self.session.commit()
        await self.session.refresh(mandate)
        return mandate

    async def cancel_mandate(self, mandate: PixAutomaticMandate) -> PixAutomaticMandate:
        if mandate.status in {"CANCELLED", "COMPLETED", "EXPIRED"}:
            return mandate
        agreement = await self.session.get(BankAgreement, mandate.bank_agreement_id)
        if agreement is None:
            raise APIError("BANK_AGREEMENT_NOT_FOUND", "Convênio bancário não encontrado.", 404)
        await self._require_provider_entitlement(mandate.provider)
        provider = banking_providers.get(mandate.provider)
        await provider.cancel_pix_automatic_authorization(
            mandate.external_id,
            self._agreement_payload(agreement),
        )
        mandate.status = "CANCELLED"
        mandate.cancelled_at = datetime.now(UTC)
        mandate.last_synced_at = datetime.now(UTC)
        self.session.add(
            OutboxEvent(
                aggregate_type="PixAutomaticMandate",
                aggregate_id=str(mandate.id),
                event_type="financial.pix_automatic.authorization.cancelled",
                payload={
                    "mandate_id": str(mandate.id),
                    "company_id": str(mandate.company_id),
                    "customer_id": str(mandate.customer_id),
                },
            )
        )
        await self.session.commit()
        await self.session.refresh(mandate)
        return mandate

    async def create_instruction(
        self,
        *,
        mandate: PixAutomaticMandate,
        receivable_id: UUID | None,
        due_date: date,
        amount: Decimal,
    ) -> PixAutomaticInstruction:
        if mandate.status not in {"ACTIVE", "AUTHORIZED", "CREATED"}:
            raise APIError("PIX_AUTOMATIC_NOT_ACTIVE", "A autorização não aceita novas instruções.", 409)
        receivable = None
        if receivable_id is not None:
            receivable = await self.session.get(Receivable, receivable_id)
            if receivable is None:
                raise APIError("RECEIVABLE_NOT_FOUND", "Recebível não encontrado.", 404)
            if receivable.company_id != mandate.company_id or receivable.customer_id != mandate.customer_id:
                raise APIError(
                    "PIX_AUTOMATIC_RECEIVABLE_SCOPE_MISMATCH",
                    "O recebível não pertence à empresa e ao cliente da autorização.",
                    409,
                )
        external_id = f"LOCAL-{mandate.id}-{due_date.isoformat()}-{amount:.2f}"
        existing = await self.session.scalar(
            select(PixAutomaticInstruction).where(
                PixAutomaticInstruction.provider == mandate.provider,
                PixAutomaticInstruction.external_id == external_id,
            )
        )
        if existing is not None:
            return existing
        instruction = PixAutomaticInstruction(
            mandate_id=mandate.id,
            receivable_id=receivable_id,
            provider=mandate.provider,
            external_id=external_id,
            due_date=due_date,
            amount=amount,
            status="SCHEDULED",
            raw_payload={"local_schedule": True},
        )
        self.session.add(instruction)
        await self.session.flush()
        self.session.add(
            OutboxEvent(
                aggregate_type="PixAutomaticInstruction",
                aggregate_id=str(instruction.id),
                event_type="financial.pix_automatic.instruction.scheduled",
                payload={
                    "instruction_id": str(instruction.id),
                    "mandate_id": str(mandate.id),
                    "receivable_id": str(receivable_id) if receivable_id else None,
                    "company_id": str(mandate.company_id),
                    "amount": str(amount),
                    "due_date": due_date.isoformat(),
                },
            )
        )
        await self.session.commit()
        await self.session.refresh(instruction)
        return instruction
