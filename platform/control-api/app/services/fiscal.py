from __future__ import annotations

import json
from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.errors import APIError
from app.core.secrets import secret_cipher
from app.models.tenant import Company, Contract, Customer, FiscalDocument, IntegrationSetting, Receivable, ServiceCatalog
from app.providers.fiscal import fiscal_providers
from app.providers.fiscal.base import FiscalCustomer, FiscalIssueRequest, FiscalIssuer
from app.services.documents import DocumentService


class FiscalService:
    def __init__(self, session: AsyncSession, *, bucket: str) -> None:
        self.session = session
        self.documents = DocumentService(session, bucket=bucket)

    async def _integration(self, company_id: UUID) -> IntegrationSetting | None:
        stmt = (
            select(IntegrationSetting)
            .where(
                IntegrationSetting.provider == "NFSE",
                IntegrationSetting.is_enabled.is_(True),
                or_(IntegrationSetting.company_id == company_id, IntegrationSetting.company_id.is_(None)),
            )
            .order_by(IntegrationSetting.company_id.desc().nullslast())
        )
        return (await self.session.execute(stmt)).scalars().first()

    async def issue(self, receivable_id: UUID, provider_override: str | None = None) -> FiscalDocument:
        existing = await self.session.scalar(
            select(FiscalDocument).where(
                FiscalDocument.receivable_id == receivable_id,
                FiscalDocument.status.in_(["ISSUED", "AUTHORIZED"]),
            )
        )
        if existing is not None:
            return existing
        receivable = await self.session.get(Receivable, receivable_id)
        if receivable is None:
            raise APIError("RECEIVABLE_NOT_FOUND", "Recebível não encontrado.", 404)
        company = await self.session.get(Company, receivable.company_id)
        customer = await self.session.get(Customer, receivable.customer_id)
        if company is None or customer is None:
            raise APIError("FISCAL_PARTIES_NOT_FOUND", "Empresa ou cliente não encontrado.", 409)

        service: ServiceCatalog | None = None
        if receivable.contract_id:
            contract = await self.session.get(Contract, receivable.contract_id)
            if contract:
                service = await self.session.get(ServiceCatalog, contract.service_id)
        integration = await self._integration(company.id)
        public = integration.public_config if integration else {}
        secrets_data = (
            json.loads(secret_cipher.decrypt(integration.encrypted_secrets))
            if integration and integration.encrypted_secrets
            else {}
        )
        provider_name = (provider_override or str(public.get("provider") or "SANDBOX")).upper()
        provider = fiscal_providers.get(provider_name)
        result = await provider.issue(
            FiscalIssueRequest(
                internal_id=str(receivable.id),
                issuer=FiscalIssuer(
                    legal_name=company.legal_name,
                    tax_id=company.tax_id,
                    municipal_registration=company.municipal_registration,
                    municipality_code=str(public.get("municipality_code") or "") or None,
                    address=company.address,
                ),
                customer=FiscalCustomer(
                    name=customer.name,
                    tax_id=customer.tax_id,
                    email=customer.email,
                    address=customer.address,
                ),
                service_description=service.description if service and service.description else receivable.description,
                service_code=service.fiscal_service_code if service else None,
                amount=receivable.original_amount,
                competence=receivable.competence,
                environment=str(public.get("environment") or "SANDBOX"),
                settings=public,
                credentials=secrets_data,
            )
        )
        fiscal = FiscalDocument(
            company_id=company.id,
            customer_id=customer.id,
            receivable_id=receivable.id,
            provider=result.provider,
            external_id=result.external_id,
            number=result.number,
            verification_code=result.verification_code,
            amount=receivable.original_amount,
            status=result.status,
            issued_at=result.issued_at,
        )
        self.session.add(fiscal)
        await self.session.flush()
        xml_document = await self.documents.store(
            company_id=company.id,
            entity_type="FiscalDocument",
            entity_id=str(fiscal.id),
            document_type="NFSE_XML",
            filename=f"nfse-{result.number}.xml",
            content=result.xml,
            content_type="application/xml",
            folder="invoices",
        )
        pdf_document = await self.documents.store(
            company_id=company.id,
            entity_type="FiscalDocument",
            entity_id=str(fiscal.id),
            document_type="NFSE_PDF",
            filename=f"nfse-{result.number}.pdf",
            content=result.pdf,
            content_type="application/pdf",
            folder="invoices",
        )
        fiscal.xml_object_key = xml_document.object_key
        fiscal.pdf_object_key = pdf_document.object_key
        await self.session.commit()
        await self.session.refresh(fiscal)
        return fiscal
