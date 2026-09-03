from __future__ import annotations

from uuid import UUID

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.tenant import Document
from app.providers.storage import S3StorageProvider


class DocumentService:
    def __init__(self, session: AsyncSession, *, bucket: str) -> None:
        self.session = session
        self.bucket = bucket
        self.storage = S3StorageProvider()

    async def store(
        self,
        *,
        company_id: UUID | None,
        entity_type: str,
        entity_id: str,
        document_type: str,
        filename: str,
        content: bytes,
        content_type: str,
        folder: str,
        immutable: bool = True,
    ) -> Document:
        prefix = f"companies/{company_id}" if company_id else "tenant"
        key = f"{prefix}/{folder.strip('/')}/{entity_id}/{filename}"
        stored = await self.storage.put_bytes(self.bucket, key, content, content_type)
        item = Document(
            company_id=company_id,
            entity_type=entity_type,
            entity_id=entity_id,
            document_type=document_type,
            object_key=stored.key,
            filename=filename,
            mime_type=content_type,
            size_bytes=stored.size,
            sha256=stored.sha256,
            version=1,
            is_immutable=immutable,
        )
        self.session.add(item)
        await self.session.flush()
        return item

    async def signed_url(self, document: Document, expires: int = 900) -> str:
        return await self.storage.presigned_url(self.bucket, document.object_key, expires=expires)
