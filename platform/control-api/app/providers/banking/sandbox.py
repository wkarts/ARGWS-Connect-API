from __future__ import annotations

import hashlib
from datetime import UTC, datetime

from app.providers.banking.base import (
    BankChargeRequest,
    BankChargeResult,
    PixAutomaticAuthorizationRequest,
    PixAutomaticAuthorizationResult,
)


class SandboxBankingProvider:
    name = "SANDBOX"

    async def create_charge(self, request: BankChargeRequest) -> BankChargeResult:
        digest = hashlib.sha256(
            f"{request.internal_id}:{request.document_number}:{request.amount}:{request.due_date}".encode()
        ).hexdigest()
        external_id = f"SBX-{digest[:24].upper()}"
        our_number = digest[:17]
        txid = digest[:32]
        numeric = "".join(str(int(char, 16) % 10) for char in digest[:47])
        digitable_line = f"{numeric[:5]}.{numeric[5:10]} {numeric[10:15]}.{numeric[15:21]} " \
                         f"{numeric[21:26]}.{numeric[26:32]} {numeric[32]} {numeric[33:47]}"
        pix = f"00020101021226800014BR.GOV.BCB.PIX01{len(txid):02d}{txid}5204000053039865406{request.amount:.2f}5802BR6304ABCD"
        return BankChargeResult(
            provider=self.name,
            external_id=external_id,
            status="REGISTERED",
            our_number=our_number,
            txid=txid,
            digitable_line=digitable_line,
            barcode=numeric[:44],
            pix_copy_paste=pix,
            document_url=f"/api/v1/charges/{external_id}/document",
            raw={"sandbox": True, "created_at": datetime.now(UTC).isoformat()},
        )

    async def cancel_charge(self, external_id: str, agreement: dict | None = None) -> None:
        return None

    async def get_charge(self, external_id: str, agreement: dict | None = None) -> BankChargeResult:
        return BankChargeResult(provider=self.name, external_id=external_id, status="REGISTERED")


    async def create_pix_automatic_authorization(
        self, request: PixAutomaticAuthorizationRequest
    ) -> PixAutomaticAuthorizationResult:
        digest = hashlib.sha256(
            f"pix-auto:{request.internal_contract_id}:{request.customer.tax_id}:{request.start_date}".encode()
        ).hexdigest()
        external_id = f"PXA-SBX-{digest[:24].upper()}"
        qr = f"00020101021226800014BR.GOV.BCB.PIX01{len(digest[:32]):02d}{digest[:32]}5204000053039865802BR6304ABCD"
        return PixAutomaticAuthorizationResult(
            provider=self.name,
            external_id=external_id,
            status="CREATED",
            authorization_url=f"/p/pix-automatic/{external_id}",
            qr_copy_paste=qr,
            raw={
                "sandbox": True,
                "frequency": request.frequency,
                "startDate": request.start_date.isoformat(),
                "finishDate": request.finish_date.isoformat() if request.finish_date else None,
                "createdAt": datetime.now(UTC).isoformat(),
            },
        )

    async def get_pix_automatic_authorization(
        self, external_id: str, agreement: dict | None = None
    ) -> PixAutomaticAuthorizationResult:
        return PixAutomaticAuthorizationResult(
            provider=self.name, external_id=external_id, status="ACTIVE", raw={"sandbox": True}
        )

    async def cancel_pix_automatic_authorization(
        self, external_id: str, agreement: dict | None = None
    ) -> None:
        return None
