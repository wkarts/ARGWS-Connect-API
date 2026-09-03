from __future__ import annotations

import re
from datetime import UTC, datetime
from typing import Any

import httpx
from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.banking_platform import BankInstitution
from app.providers.banking.registry import banking_providers

BCB_DATASET_URL = "https://dadosabertos.bcb.gov.br/dataset/dados-cadastrais-de-entidades-autorizadas"
BCB_CKAN_PACKAGE_URL = "https://dadosabertos.bcb.gov.br/api/3/action/package_show"
BCB_DATASET_ID = "dados-cadastrais-de-entidades-autorizadas"


def _digits(value: Any) -> str | None:
    raw = re.sub(r"\D", "", str(value or ""))
    return raw or None


def _first(record: dict[str, Any], *keys: str) -> Any:
    folded = {str(key).casefold().replace("_", "").replace(" ", ""): value for key, value in record.items()}
    for key in keys:
        normalized = key.casefold().replace("_", "").replace(" ", "")
        if normalized in folded and folded[normalized] not in (None, ""):
            return folded[normalized]
    return None


class BankInstitutionCatalogService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def ensure_manifest_seeds(self) -> int:
        """Sementes mínimas para UX antes do primeiro sync BCB.

        Não são tratadas como fonte oficial: o campo ``source`` deixa explícita a
        origem e a sincronização BCB sobrescreve/atualiza os registros compatíveis.
        """
        created = 0
        for manifest in banking_providers.manifests():
            ref = manifest.institution
            if ref is None:
                continue
            filters = []
            if ref.ispb:
                filters.append(BankInstitution.ispb == ref.ispb)
            if ref.bank_code:
                filters.append(BankInstitution.bank_code == ref.bank_code)
            existing = await self.session.scalar(select(BankInstitution).where(or_(*filters))) if filters else None
            if existing:
                continue
            self.session.add(
                BankInstitution(
                    bank_code=ref.bank_code,
                    ispb=ref.ispb,
                    cnpj=ref.cnpj,
                    legal_name=ref.name,
                    short_name=manifest.name,
                    active=True,
                    source="PROVIDER_MANIFEST",
                    metadata_json={"provider": manifest.code, "provisional": True},
                )
            )
            created += 1
        if created:
            await self.session.flush()
        return created

    async def discover_official_resource(self) -> str:
        async with httpx.AsyncClient(timeout=30, follow_redirects=True) as client:
            response = await client.get(BCB_CKAN_PACKAGE_URL, params={"id": BCB_DATASET_ID})
            response.raise_for_status()
            package = response.json()
        resources = list((package.get("result") or {}).get("resources") or [])
        scored: list[tuple[int, str]] = []
        for item in resources:
            url = str(item.get("url") or "").strip()
            if not url.startswith("https://"):
                continue
            text = f"{item.get('name','')} {item.get('description','')} {item.get('format','')}".casefold()
            score = 0
            if "entidades supervisionadas" in text:
                score += 10
            if "json" in text:
                score += 5
            if "odata" in text or "api" in text:
                score += 3
            if score:
                scored.append((score, url))
        if not scored:
            raise RuntimeError("O catálogo BCB não publicou recurso de entidades supervisionadas reconhecível.")
        scored.sort(reverse=True)
        return scored[0][1]

    @staticmethod
    def _records(payload: Any) -> list[dict[str, Any]]:
        if isinstance(payload, list):
            return [item for item in payload if isinstance(item, dict)]
        if isinstance(payload, dict):
            for key in ("value", "data", "items", "results", "result"):
                value = payload.get(key)
                if isinstance(value, list):
                    return [item for item in value if isinstance(item, dict)]
                if isinstance(value, dict):
                    nested = BankInstitutionCatalogService._records(value)
                    if nested:
                        return nested
        return []

    async def sync_from_bcb(self, *, resource_url: str | None = None) -> dict[str, int | str]:
        url = resource_url or await self.discover_official_resource()
        if not url.startswith("https://") or "bcb.gov.br" not in httpx.URL(url).host:
            raise ValueError("A sincronização oficial aceita somente recurso HTTPS do domínio bcb.gov.br.")
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            response = await client.get(url, headers={"Accept": "application/json"})
            response.raise_for_status()
            payload = response.json()
        records = self._records(payload)
        if not records:
            raise RuntimeError("O recurso oficial BCB não retornou registros reconhecíveis.")

        now = datetime.now(UTC)
        created = 0
        updated = 0
        ignored = 0
        for record in records:
            ispb = _digits(_first(record, "ispb", "codigoispb", "cod_ispb"))
            cnpj = _digits(_first(record, "cnpj", "cnpjentidade", "cnpj_entidade"))
            legal_name = str(_first(record, "nome", "nomeentidade", "razaosocial", "nome_instituicao") or "").strip()
            if not legal_name or not (ispb or cnpj):
                ignored += 1
                continue
            bank_code = _digits(_first(record, "codigobanco", "codigocompe", "compe", "codigo_compensacao"))
            if bank_code:
                bank_code = bank_code[-3:].zfill(3)
            short_name = str(_first(record, "nomefantasia", "nomeabreviado", "nome_reduzido") or legal_name).strip()
            institution_type = str(_first(record, "tipoentidade", "segmento", "tipo_instituicao") or "").strip() or None
            active_raw = str(_first(record, "situacao", "status", "situacaopj") or "ATIVA").casefold()
            active = not any(marker in active_raw for marker in ("cancel", "liquid", "inativ", "encerr"))

            filters = []
            if ispb:
                filters.append(BankInstitution.ispb == ispb)
            if cnpj:
                filters.append(BankInstitution.cnpj == cnpj)
            item = await self.session.scalar(select(BankInstitution).where(or_(*filters)))
            if item is None:
                item = BankInstitution(
                    bank_code=bank_code,
                    ispb=ispb,
                    cnpj=cnpj,
                    legal_name=legal_name,
                    short_name=short_name,
                    institution_type=institution_type,
                    active=active,
                    source=BCB_DATASET_URL,
                    source_updated_at=now,
                    metadata_json={"bcb": record},
                )
                self.session.add(item)
                created += 1
            else:
                item.bank_code = bank_code or item.bank_code
                item.ispb = ispb or item.ispb
                item.cnpj = cnpj or item.cnpj
                item.legal_name = legal_name
                item.short_name = short_name
                item.institution_type = institution_type
                item.active = active
                item.source = BCB_DATASET_URL
                item.source_updated_at = now
                item.metadata_json = {**dict(item.metadata_json or {}), "bcb": record, "provisional": False}
                updated += 1
        await self.session.commit()
        return {"created": created, "updated": updated, "ignored": ignored, "resource_url": url}
