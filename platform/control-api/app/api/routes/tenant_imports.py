from __future__ import annotations

import asyncio
import tempfile
from pathlib import Path
from uuid import UUID

import structlog
from fastapi import APIRouter, Depends, File, Form, UploadFile
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.api.deps import ensure_company_access, get_tenant_db, require_permission
from app.core.errors import APIError
from app.legacy import FinancialVitorImporter
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.services.audit import tenant_audit

router = APIRouter(prefix="/api/v1/imports", tags=["Importações"])
logger = structlog.get_logger(__name__)
MAX_IMPORT_BYTES = 100 * 1024 * 1024


async def save_upload(file: UploadFile) -> Path:
    if not file.filename or not file.filename.lower().endswith(".zip"):
        raise APIError("IMPORT_FILE_INVALID", "Envie um arquivo ZIP válido.", 422)
    temp = tempfile.NamedTemporaryFile(prefix="financial-import-", suffix=".zip", delete=False)
    path = Path(temp.name)
    size = 0
    try:
        while chunk := await file.read(1024 * 1024):
            size += len(chunk)
            if size > MAX_IMPORT_BYTES:
                raise APIError("IMPORT_FILE_TOO_LARGE", "Arquivo excede o limite de 100 MB.", 413)
            temp.write(chunk)
        temp.close()
        return path
    except Exception:
        temp.close()
        path.unlink(missing_ok=True)
        raise


@router.post("/financial-vitor/preview", response_model=SuccessResponse[dict])
async def preview_financial_vitor(
    file: UploadFile = File(...),
    _: AuthUser = Depends(require_permission("imports.read")),
) -> SuccessResponse[dict]:
    path = await save_upload(file)
    try:
        report = await asyncio.to_thread(FinancialVitorImporter().preview, path)
        return SuccessResponse(data=report.to_dict())
    except ValueError as exc:
        raise APIError("IMPORT_FILE_INVALID", str(exc), 422) from exc
    finally:
        path.unlink(missing_ok=True)


@router.post("/financial-vitor", response_model=SuccessResponse[dict], status_code=201)
async def import_financial_vitor(
    company_id: UUID = Form(...),
    service_id: UUID = Form(...),
    create_contracts: bool = Form(True),
    create_receivables: bool = Form(True),
    file: UploadFile = File(...),
    user: AuthUser = Depends(require_permission("imports.manage")),
    session: AsyncSession = Depends(get_tenant_db),
) -> SuccessResponse[dict]:
    ensure_company_access(user, company_id)
    path = await save_upload(file)
    try:
        # As PKs do banco usam UUID(as_uuid=True). Passar strings aqui provoca
        # falha de bind no driver PostgreSQL durante session.get().
        stats = await FinancialVitorImporter().import_into(
            session,
            path,
            company_id=company_id,  # type: ignore[arg-type]
            service_id=service_id,  # type: ignore[arg-type]
            create_contracts=create_contracts,
            create_receivables=create_receivables,
        )
        await tenant_audit(
            session,
            action="legacy.financial_vitor.imported",
            entity_type="LegacyImport",
            actor_id=user.id,
            company_id=str(company_id),
            after={**stats, "filename": file.filename},
        )
        await session.commit()
        return SuccessResponse(data=stats)
    except ValueError as exc:
        await session.rollback()
        raise APIError("IMPORT_FAILED", str(exc), 422) from exc
    except SQLAlchemyError as exc:
        await session.rollback()
        logger.exception(
            "legacy_import_database_failed",
            company_id=str(company_id),
            service_id=str(service_id),
            error=type(exc).__name__,
        )
        raise APIError(
            "IMPORT_DATABASE_FAILED",
            "Não foi possível gravar a importação. Revise a empresa e o serviço selecionados e tente novamente.",
            409,
        ) from exc
    finally:
        path.unlink(missing_ok=True)
