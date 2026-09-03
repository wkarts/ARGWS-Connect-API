from __future__ import annotations

from fastapi import APIRouter, Depends

from app.api.deps import current_connect_api_tser
from app.core.errors import APIError
from app.schemas.auth import AuthUser
from app.schemas.common import SuccessResponse
from app.services.company_registry import CompanyRegistryService

router = APIRouter(prefix="/api/v1/registry", tags=["Consulta cadastral"])
service = CompanyRegistryService()


@router.get("/cnpj/{cnpj}", response_model=SuccessResponse[dict])
async def lookup_cnpj(
    cnpj: str,
    user: AuthUser = Depends(current_connect_api_tser),
) -> SuccessResponse[dict]:
    permissions = set(user.permissions or [])
    allowed = (
        user.role == "TENANT_ADMIN"
        or "*" in permissions
        or bool(permissions.intersection({"companies.create", "companies.update", "customers.create", "customers.update"}))
    )
    if not allowed:
        raise APIError("FORBIDDEN", "Seu perfil não permite consulta cadastral.", 403)
    return SuccessResponse(data=await service.lookup(cnpj))
