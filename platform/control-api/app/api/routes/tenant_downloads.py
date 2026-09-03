from __future__ import annotations

from pathlib import Path
from uuid import UUID

from fastapi import APIRouter, Depends
from fastapi.responses import Response
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ensure_company_access, get_tenant_context_dep, get_tenant_db, require_permission
from app.core.errors import APIError
from app.core.tenant_context import TenantContext
from app.models.tenant import CNABRemittance, Document, ExportJob
from app.providers.storage import S3StorageProvider
from app.schemas.auth import AuthUser

router = APIRouter(prefix="/api/v1", tags=["Financeiro - Downloads"])
storage = S3StorageProvider()


def _attachment_headers(filename: str, *, inline: bool = False) -> dict[str, str]:
    safe = Path(filename or "arquivo").name.replace('"', "")[:180] or "arquivo"
    disposition = "inline" if inline else "attachment"
    return {
        "Content-Disposition": f'{disposition}; filename="{safe}"',
        "Cache-Control": "private, no-store, max-age=0",
        "Pragma": "no-cache",
        "X-Content-Type-Options": "nosniff",
    }


@router.get("/documents/{document_id}/download")
async def download_document(
    document_id: UUID,
    inline: bool = False,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("documents.read")),
    session: AsyncSession = Depends(get_tenant_db),
) -> Response:
    document = await session.get(Document, document_id)
    if document is None:
        raise APIError("DOCUMENT_NOT_FOUND", "Documento não encontrado.", 404)
    if document.company_id is not None:
        ensure_company_access(user, document.company_id)
    content = await storage.get_bytes(context.storage_bucket, document.object_key)
    return Response(
        content=content,
        media_type=document.mime_type or "application/octet-stream",
        headers=_attachment_headers(document.filename, inline=inline),
    )


@router.get("/exports/{export_id}/download")
async def download_export(
    export_id: UUID,
    inline: bool = False,
    context: TenantContext = Depends(get_tenant_context_dep),
    _: AuthUser = Depends(require_permission("reports.view")),
    session: AsyncSession = Depends(get_tenant_db),
) -> Response:
    export = await session.get(ExportJob, export_id)
    if export is None:
        raise APIError("EXPORT_NOT_FOUND", "Exportação não encontrada.", 404)
    if export.status != "COMPLETED" or not export.object_key:
        raise APIError("EXPORT_NOT_READY", "A exportação ainda não está disponível para download.", 409)
    content = await storage.get_bytes(context.storage_bucket, export.object_key)
    filename = Path(export.object_key).name or f"exportacao-{export.id}.{export.format.lower()}"
    media_types = {
        "PDF": "application/pdf",
        "XLSX": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "CSV": "text/csv; charset=utf-8",
        "JSON": "application/json",
    }
    return Response(
        content=content,
        media_type=media_types.get(export.format.upper(), "application/octet-stream"),
        headers=_attachment_headers(filename, inline=inline),
    )


@router.get("/cnab/remittances/{remittance_id}/download")
async def download_cnab_remittance(
    remittance_id: UUID,
    context: TenantContext = Depends(get_tenant_context_dep),
    user: AuthUser = Depends(require_permission("cnab.generate")),
    session: AsyncSession = Depends(get_tenant_db),
) -> Response:
    remittance = await session.get(CNABRemittance, remittance_id)
    if remittance is None:
        raise APIError("CNAB_REMITTANCE_NOT_FOUND", "Remessa CNAB não encontrada.", 404)

    ensure_company_access(user, remittance.company_id)
    content = await storage.get_bytes(context.storage_bucket, remittance.object_key)
    filename = Path(remittance.object_key).name or f"remessa-{remittance.sequence:06d}.REM"

    return Response(
        content=content,
        media_type="text/plain; charset=latin-1",
        headers=_attachment_headers(filename),
    )
