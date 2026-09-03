from __future__ import annotations

import asyncio
import hashlib
from dataclasses import dataclass
from pathlib import Path
from typing import BinaryIO

import boto3
from botocore.client import BaseClient
from botocore.exceptions import ClientError

from app.core.config import settings


@dataclass(frozen=True, slots=True)
class StoredObject:
    bucket: str
    key: str
    size: int
    sha256: str
    content_type: str


class S3StorageProvider:
    def __init__(self) -> None:
        self.client: BaseClient = boto3.client(
            "s3",
            endpoint_url=settings.s3_endpoint_url,
            region_name=settings.s3_region,
            aws_access_key_id=settings.s3_access_key,
            aws_secret_access_key=settings.s3_secret_key,
            use_ssl=settings.s3_use_ssl,
        )
        self.public_client: BaseClient | None = None
        if settings.s3_public_endpoint_url:
            self.public_client = boto3.client(
                "s3",
                endpoint_url=settings.s3_public_endpoint_url,
                region_name=settings.s3_region,
                aws_access_key_id=settings.s3_access_key,
                aws_secret_access_key=settings.s3_secret_key,
                use_ssl=settings.s3_public_endpoint_url.lower().startswith("https://"),
            )

    async def ensure_bucket(self, bucket: str) -> None:
        def action() -> None:
            try:
                self.client.head_bucket(Bucket=bucket)
            except ClientError:
                self.client.create_bucket(Bucket=bucket)

        await asyncio.to_thread(action)

    async def put_bytes(
        self, bucket: str, key: str, content: bytes, content_type: str = "application/octet-stream"
    ) -> StoredObject:
        digest = hashlib.sha256(content).hexdigest()
        await asyncio.to_thread(
            self.client.put_object,
            Bucket=bucket,
            Key=key,
            Body=content,
            ContentType=content_type,
            Metadata={"sha256": digest},
        )
        return StoredObject(bucket=bucket, key=key, size=len(content), sha256=digest, content_type=content_type)

    async def upload_file(
        self, bucket: str, key: str, path: Path, content_type: str = "application/octet-stream"
    ) -> StoredObject:
        content = await asyncio.to_thread(path.read_bytes)
        return await self.put_bytes(bucket, key, content, content_type)

    async def get_bytes(self, bucket: str, key: str) -> bytes:
        def action() -> bytes:
            response = self.client.get_object(Bucket=bucket, Key=key)
            body: BinaryIO = response["Body"]
            return body.read()

        return await asyncio.to_thread(action)

    async def delete_object(self, bucket: str, key: str) -> None:
        await asyncio.to_thread(self.client.delete_object, Bucket=bucket, Key=key)

    async def presigned_url(self, bucket: str, key: str, expires: int = 900) -> str:
        """Gera URL somente quando existe endpoint S3 explicitamente público.

        O endpoint interno do Docker nunca deve aparecer em respostas destinadas ao
        navegador. Downloads autenticados da aplicação devem usar os endpoints proxy
        da API, como /api/v1/cnab/remittances/{id}/download.
        """
        if self.public_client is None:
            return ""
        return await asyncio.to_thread(
            self.public_client.generate_presigned_url,
            "get_object",
            Params={"Bucket": bucket, "Key": key},
            ExpiresIn=expires,
        )
