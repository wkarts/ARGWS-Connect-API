from __future__ import annotations

import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import AsyncIterator


@asynccontextmanager
async def temporary_client_certificate(
    certificate: str,
    private_key: str,
    *,
    prefix: str = "connect-api-bank",
) -> AsyncIterator[tuple[str, str]]:
    """Materializa certificado/chave apenas durante a chamada mTLS.

    As credenciais continuam pertencendo ao BankConnection e nunca são
    persistidas em arquivos definitivos. Os arquivos temporários usam permissão
    0600 e são removidos ao final da operação.
    """

    cert_file = tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", prefix=f"{prefix}-cert-", suffix=".pem", delete=False
    )
    key_file = tempfile.NamedTemporaryFile(
        "w", encoding="utf-8", prefix=f"{prefix}-key-", suffix=".pem", delete=False
    )
    cert_path = Path(cert_file.name)
    key_path = Path(key_file.name)
    try:
        cert_file.write(certificate)
        key_file.write(private_key)
        cert_file.flush()
        key_file.flush()
        cert_file.close()
        key_file.close()
        os.chmod(cert_path, 0o600)
        os.chmod(key_path, 0o600)
        yield str(cert_path), str(key_path)
    finally:
        try:
            cert_file.close()
        except Exception:
            pass
        try:
            key_file.close()
        except Exception:
            pass
        cert_path.unlink(missing_ok=True)
        key_path.unlink(missing_ok=True)
