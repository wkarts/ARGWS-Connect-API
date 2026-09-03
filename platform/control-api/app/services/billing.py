from __future__ import annotations

import json
from datetime import UTC, datetime
from decimal import Decimal
from uuid import UUID

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.secrets import secret_cipher
from app.core.tenant_context import get_tenant_context
from app.db.platform import PlatformSessionLocal
from app.models.banking import BankConnection
from app.models.tenant import BankAgreement, Charge, Customer, OutboxEvent, Payment, Receivable
from app.providers.banking.base import BankChargeRequest, BankCustomer
from app.providers.banking.core.capabilities import BankingIntegrationMode
from app.providers.banking.core.credentials import decrypt_credentials
from app.providers.banking.registry import banking_providers
from app.services.banking_binding import assert_bank_account_provider_binding, normalize_bank_code
from app.services.banking_entitlements import require_provider_entitlement


class BillingService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _agreement_connection(self, agreement_id: UUID) -> BankConnection | None:
        """Resolve a nova conexão sem exigir que o model legado seja reescrito abruptamente."""
        result = await self.session.execute(
            text("SELECT bank_connection_id FROM bank_agreements WHERE id=:id"),
            {"id": str(agreement_id)},
        )
        connection_id = result.scalar_one_or_none()
        if not connection_id:
            return None
        return await self.session.get(BankConnection, UUID(str(connection_id)))

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
    def _require_direct_api(provider_name: str) -> None:
        manifest = banking_providers.manifest(provider_name)
        if not banking_providers.mode_available(manifest.code, BankingIntegrationMode.DIRECT_API):
            raise APIError(
                "BANKING_PROVIDER_MODE_NOT_AVAILABLE",
                "Este fluxo de cobrança exige DIRECT_API, mas o provider não possui executor API instalado.",
                422,
                {
                    "provider": manifest.code,
                    "implemented_modes": sorted(
                        mode.value for mode in manifest.effective_implemented_modes()
                    ),
                },
            )

    async def create_charge(
        self,
        *,
        receivable_id: str,
        provider_name: str = "SANDBOX",
        charge_type: str = "BOLETO_PIX",
        bank_agreement_id: str | None = None,
    ) -> Charge:
        receivable = await self.session.scalar(
            select(Receivable).where(Receivable.id == receivable_id).with_for_update()
        )
        if receivable is None:
            raise APIError("RECEIVABLE_NOT_FOUND", "Conta a receber não encontrada.", 404)
        if receivable.status in {"PAID", "CANCELLED", "REVERSED"}:
            raise APIError("RECEIVABLE_NOT_CHARGEABLE", "Este recebível não pode ser cobrado.", 409)
        customer = await self.session.get(Customer, receivable.customer_id)
        if customer is None:
            raise APIError("CUSTOMER_NOT_FOUND", "Cliente não encontrado.", 404)

        agreement_data: dict[str, object] = {}
        if bank_agreement_id:
            agreement = await self.session.get(BankAgreement, bank_agreement_id)
            if agreement is None or not agreement.is_active:
                raise APIError("BANK_AGREEMENT_NOT_FOUND", "Convênio bancário não encontrado ou inativo.", 404)
            if agreement.company_id != receivable.company_id:
                raise APIError(
                    "BANK_AGREEMENT_COMPANY_MISMATCH",
                    "O convênio bancário não pertence à empresa emissora do recebível.",
                    409,
                )

            connection = await self._agreement_connection(agreement.id)
            if connection is not None:
                if not connection.is_active:
                    raise APIError("BANK_CONNECTION_INACTIVE", "A conexão bancária do convênio está inativa.", 409)
                if connection.company_id != receivable.company_id:
                    raise APIError(
                        "BANK_CONNECTION_COMPANY_MISMATCH",
                        "A conexão bancária pertence a outra empresa emissora.",
                        409,
                    )
                agreement_provider = str(agreement.provider or "").strip().upper()
                connection_provider = connection.provider.strip().upper()
                if agreement_provider and agreement_provider != connection_provider:
                    raise APIError(
                        "BANK_AGREEMENT_PROVIDER_MISMATCH",
                        "O convênio e a conexão bancária pertencem a providers diferentes.",
                        409,
                        {
                            "agreement_provider": agreement_provider,
                            "connection_provider": connection_provider,
                        },
                    )
                provider_name = connection_provider
                self._require_direct_api(provider_name)
                manifest = banking_providers.manifest(provider_name)
                await assert_bank_account_provider_binding(
                    self.session,
                    bank_account_id=connection.bank_account_id,
                    manifest=manifest,
                )
                credentials = decrypt_credentials(connection.encrypted_credentials)
                environment = connection.environment
                provider_settings = dict(connection.settings or {})
            else:
                provider_name = str(agreement.provider or "").strip().upper()
                self._require_direct_api(provider_name)
                manifest = banking_providers.manifest(provider_name)
                await assert_bank_account_provider_binding(
                    self.session,
                    bank_account_id=agreement.bank_account_id,
                    manifest=manifest,
                )
                credentials = (
                    json.loads(secret_cipher.decrypt(agreement.encrypted_credentials))
                    if agreement.encrypted_credentials
                    else {}
                )
                environment = agreement.environment
                provider_settings = {}

            agreement_data = {
                "id": str(agreement.id),
                "number": agreement.agreement_number,
                "wallet": agreement.wallet,
                "beneficiary_code": agreement.beneficiary_code,
                "environment": environment,
                "settings": {**dict(agreement.settings or {}), **provider_settings},
                "credentials": credentials,
            }

        active_charge = await self.session.scalar(
            select(Charge)
            .where(
                Charge.receivable_id == receivable.id,
                Charge.status.notin_(["CANCELLED", "REVERSED", "FAILED", "EXPIRED"]),
            )
            .order_by(Charge.created_at.desc())
        )
        if active_charge is not None:
            return active_charge

        provider_name = provider_name.strip().upper()
        self._require_direct_api(provider_name)
        await self._require_provider_entitlement(provider_name)

        provider = banking_providers.get_for_mode(provider_name, BankingIntegrationMode.DIRECT_API)
        result = await provider.create_charge(
            BankChargeRequest(
                internal_id=str(receivable.id),
                document_number=receivable.document_number,
                amount=Decimal(receivable.balance),
                due_date=receivable.due_date,
                description=receivable.description,
                customer=BankCustomer(
                    name=customer.name,
                    tax_id=customer.tax_id,
                    email=customer.email,
                    phone=customer.phone,
                    address=customer.address,
                ),
                charge_type=charge_type,
                agreement=agreement_data,
            )
        )
        result_provider = str(result.provider or "").strip().upper()
        if result_provider != provider_name:
            raise APIError(
                "BANK_PROVIDER_RESPONSE_MISMATCH",
                "O executor bancário retornou identidade de outro provider; a operação foi bloqueada.",
                502,
                {"requested_provider": provider_name, "response_provider": result_provider},
            )

        existing = await self.session.scalar(
            select(Charge).where(Charge.provider == result.provider, Charge.external_id == result.external_id)
        )
        if existing is not None:
            if existing.receivable_id != receivable.id:
                raise APIError(
                    "BANK_EXTERNAL_ID_COLLISION",
                    "O identificador externo retornado pelo banco já pertence a outro recebível.",
                    409,
                )
            receivable.status = "REGISTERED"
            await self.session.commit()
            return existing
        charge = Charge(
            receivable_id=receivable.id,
            bank_agreement_id=bank_agreement_id,
            charge_type=charge_type,
            provider=result_provider,
            external_id=result.external_id,
            our_number=result.our_number,
            txid=result.txid,
            digitable_line=result.digitable_line,
            barcode=result.barcode,
            pix_copy_paste=result.pix_copy_paste,
            document_url=result.document_url,
            status=result.status,
            registered_at=datetime.now(UTC),
            raw_response=result.raw,
        )
        self.session.add(charge)
        receivable.status = "REGISTERED"
        await self.session.flush()
        normalized_payload = {
            "charge_id": str(charge.id),
            "receivable_id": str(receivable.id),
            "customer_id": str(customer.id),
            "company_id": str(receivable.company_id),
            "provider": result_provider,
        }
        self.session.add(
            OutboxEvent(
                aggregate_type="Charge",
                aggregate_id=str(charge.id),
                event_type="bank.charge.created",
                payload=normalized_payload,
            )
        )
        self.session.add(
            OutboxEvent(
                aggregate_type="Charge",
                aggregate_id=str(charge.id),
                event_type="financial.charge.registered",
                payload=normalized_payload,
            )
        )
        await self.session.commit()
        await self.session.refresh(charge)
        return charge

    async def register_payment(
        self,
        *,
        receivable_id: str,
        provider: str,
        external_id: str,
        amount: Decimal,
        paid_at: datetime,
        payment_method: str,
        charge_id: str | None = None,
        end_to_end_id: str | None = None,
        raw_payload: dict[str, object] | None = None,
        commit: bool = True,
    ) -> Payment:
        provider = provider.strip().upper()
        existing = await self.session.scalar(
            select(Payment).where(Payment.provider == provider, Payment.external_id == external_id)
        )
        if existing is not None:
            return existing
        receivable = await self.session.scalar(
            select(Receivable).where(Receivable.id == receivable_id).with_for_update()
        )
        if receivable is None:
            raise APIError("RECEIVABLE_NOT_FOUND", "Conta a receber não encontrada.", 404)
        existing = await self.session.scalar(
            select(Payment).where(Payment.provider == provider, Payment.external_id == external_id)
        )
        if existing is not None:
            return existing
        if charge_id:
            charge = await self.session.get(Charge, charge_id)
            if charge is None or charge.receivable_id != receivable.id:
                raise APIError(
                    "PAYMENT_CHARGE_MISMATCH",
                    "A cobrança informada não pertence ao recebível.",
                    409,
                )
            charge_provider = str(charge.provider or "").strip().upper()
            if provider.startswith("CNAB"):
                bank_code = normalize_bank_code(provider[4:])
                try:
                    charge_manifest = banking_providers.manifest(charge_provider)
                except APIError:
                    charge_manifest = None
                expected_bank_code = (
                    normalize_bank_code(charge_manifest.institution.bank_code)
                    if charge_manifest is not None and charge_manifest.institution is not None
                    else ""
                )
                if expected_bank_code and bank_code != expected_bank_code:
                    raise APIError(
                        "PAYMENT_PROVIDER_MISMATCH",
                        "Retorno CNAB pertence a outro banco e não pode liquidar esta cobrança.",
                        409,
                        {
                            "charge_provider": charge_provider,
                            "cnab_bank_code": bank_code,
                            "expected_bank_code": expected_bank_code,
                        },
                    )
            elif charge_provider and charge_provider != provider:
                raise APIError(
                    "PAYMENT_PROVIDER_MISMATCH",
                    "Pagamento de um provider não pode ser associado à cobrança de outro banco.",
                    409,
                    {"charge_provider": charge_provider, "payment_provider": provider},
                )
        if amount <= 0:
            raise APIError("INVALID_PAYMENT_AMOUNT", "O pagamento precisa ser maior que zero.", 422)
        if paid_at.tzinfo is None:
            paid_at = paid_at.replace(tzinfo=UTC)
        payment = Payment(
            receivable_id=receivable.id,
            charge_id=charge_id,
            provider=provider,
            external_id=external_id,
            end_to_end_id=end_to_end_id,
            amount=amount,
            paid_at=paid_at,
            payment_method=payment_method,
            status="CONFIRMED",
            raw_payload=raw_payload or {},
        )
        self.session.add(payment)
        receivable.paid_amount = Decimal(receivable.paid_amount) + amount
        receivable.balance = max(Decimal(receivable.balance) - amount, Decimal("0"))
        receivable.status = "PAID" if receivable.balance == 0 else "PARTIALLY_PAID"
        await self.session.flush()
        normalized_payload = {
            "payment_id": str(payment.id),
            "receivable_id": str(receivable.id),
            "company_id": str(receivable.company_id),
            "customer_id": str(receivable.customer_id),
            "amount": str(amount),
            "receivable_status": receivable.status,
            "provider": provider,
        }
        self.session.add(
            OutboxEvent(
                aggregate_type="Payment",
                aggregate_id=str(payment.id),
                event_type="bank.payment.confirmed",
                payload=normalized_payload,
            )
        )
        self.session.add(
            OutboxEvent(
                aggregate_type="Payment",
                aggregate_id=str(payment.id),
                event_type="financial.payment.confirmed",
                payload=normalized_payload,
            )
        )
        if commit:
            await self.session.commit()
            await self.session.refresh(payment)
        else:
            await self.session.flush()
        return payment
