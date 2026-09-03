from __future__ import annotations

import hashlib
import io
from datetime import UTC, datetime
from xml.etree.ElementTree import Element, SubElement, tostring

from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.pdfgen import canvas

from app.providers.fiscal.base import FiscalIssueRequest, FiscalIssueResult


class SandboxNFSeProvider:
    """Provider funcional para desenvolvimento e homologação interna.

    Não substitui a homologação do município/provedor nacional. Gera XML e PDF
    determinísticos para que todo o fluxo fiscal, armazenamento e comunicação
    possa ser testado sem credenciais externas.
    """

    name = "SANDBOX"

    async def issue(self, request: FiscalIssueRequest) -> FiscalIssueResult:
        issued_at = datetime.now(UTC)
        seed = f"{request.internal_id}|{request.amount}|{request.competence}|{request.issuer.tax_id}"
        digest = hashlib.sha256(seed.encode()).hexdigest()
        number = str(int(digest[:10], 16))[-10:].zfill(10)
        verification = digest[10:22].upper()
        external_id = f"NFSE-SBX-{digest[:24]}"

        root = Element("CompNfse", versao="1.00", ambiente="SANDBOX")
        nfse = SubElement(root, "Nfse")
        SubElement(nfse, "Numero").text = number
        SubElement(nfse, "CodigoVerificacao").text = verification
        SubElement(nfse, "DataEmissao").text = issued_at.isoformat()
        prestador = SubElement(nfse, "Prestador")
        SubElement(prestador, "RazaoSocial").text = request.issuer.legal_name
        SubElement(prestador, "Cnpj").text = request.issuer.tax_id
        tomador = SubElement(nfse, "Tomador")
        SubElement(tomador, "RazaoSocial").text = request.customer.name
        SubElement(tomador, "Documento").text = request.customer.tax_id or ""
        servico = SubElement(nfse, "Servico")
        SubElement(servico, "Discriminacao").text = request.service_description
        SubElement(servico, "Codigo").text = request.service_code or ""
        SubElement(servico, "ValorServicos").text = f"{request.amount:.2f}"
        xml = tostring(root, encoding="utf-8", xml_declaration=True)

        buffer = io.BytesIO()
        pdf = canvas.Canvas(buffer, pagesize=A4)
        width, height = A4
        pdf.setTitle(f"NFS-e Sandbox {number}")
        pdf.setFont("Helvetica-Bold", 16)
        pdf.drawString(20 * mm, height - 25 * mm, "NOTA FISCAL DE SERVIÇO ELETRÔNICA")
        pdf.setFont("Helvetica-Bold", 10)
        pdf.drawString(20 * mm, height - 34 * mm, "DOCUMENTO DE HOMOLOGAÇÃO / SANDBOX — SEM VALOR FISCAL")
        y = height - 50 * mm
        rows = [
            ("Número", number),
            ("Código de verificação", verification),
            ("Emissão", issued_at.strftime("%d/%m/%Y %H:%M:%S UTC")),
            ("Prestador", request.issuer.legal_name),
            ("CNPJ prestador", request.issuer.tax_id),
            ("Tomador", request.customer.name),
            ("Documento tomador", request.customer.tax_id or "Não informado"),
            ("Competência", request.competence),
            ("Serviço", request.service_description),
            ("Valor", f"R$ {request.amount:,.2f}"),
        ]
        for label, value in rows:
            pdf.setFont("Helvetica-Bold", 9)
            pdf.drawString(20 * mm, y, f"{label}:")
            pdf.setFont("Helvetica", 9)
            pdf.drawString(62 * mm, y, str(value)[:100])
            y -= 8 * mm
        pdf.setFont("Helvetica", 8)
        pdf.drawString(20 * mm, 18 * mm, f"Identificador: {external_id}")
        pdf.save()
        pdf_bytes = buffer.getvalue()
        return FiscalIssueResult(
            provider=self.name,
            external_id=external_id,
            number=number,
            verification_code=verification,
            status="ISSUED",
            issued_at=issued_at,
            xml=xml,
            pdf=pdf_bytes,
            raw={"environment": "SANDBOX", "digest": digest},
        )

    async def cancel(self, external_id: str, reason: str, credentials: dict[str, object]) -> dict[str, object]:
        return {"provider": self.name, "external_id": external_id, "status": "CANCELLED", "reason": reason}
