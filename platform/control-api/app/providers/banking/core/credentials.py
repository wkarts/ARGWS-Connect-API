from __future__ import annotations

import base64
import json
from dataclasses import dataclass
from datetime import UTC, datetime
from typing import Any

from cryptography import x509
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.serialization import pkcs12

from app.core.errors import APIError
from app.core.secrets import secret_cipher
from app.providers.banking.core.manifest import ProviderManifest


@dataclass(frozen=True, slots=True)
class CertificateMetadata:
    issuer: str
    subject: str
    serial: str
    not_before: datetime
    not_after: datetime
    fingerprint_sha256: str

    @property
    def days_until_expiry(self) -> int:
        return max(0, (self.not_after.astimezone(UTC) - datetime.now(UTC)).days)


def encrypt_credentials(credentials: dict[str, Any]) -> str:
    return secret_cipher.encrypt(json.dumps(credentials, ensure_ascii=False, separators=(",", ":"), default=str))


def decrypt_credentials(ciphertext: str | None) -> dict[str, Any]:
    if not ciphertext:
        return {}
    try:
        value = json.loads(secret_cipher.decrypt(ciphertext))
    except Exception as exc:
        raise APIError("BANK_INVALID_CREDENTIALS", "Não foi possível abrir as credenciais bancárias protegidas.", 422) from exc
    if not isinstance(value, dict):
        raise APIError("BANK_INVALID_CREDENTIALS", "Formato de credenciais bancárias inválido.", 422)
    return value


def validate_credentials(manifest: ProviderManifest, credentials: dict[str, Any]) -> None:
    missing = [field.label for field in manifest.authentication.fields if field.required and not credentials.get(field.key)]
    if missing:
        raise APIError(
            "BANK_INVALID_CREDENTIALS",
            "Preencha todas as credenciais obrigatórias para esta integração.",
            422,
            {"missing_fields": missing},
        )


def validate_provider_settings(manifest: ProviderManifest, settings: dict[str, Any]) -> None:
    """Valida somente os campos operacionais declarados pelo provider.

    Campos desconhecidos são preservados por compatibilidade com conexões antigas,
    porém os campos publicados em ``settings_schema`` passam por domínio e tipo.
    Isso permite evoluir providers sem transformar o cadastro numa estrutura
    hard-coded por instituição.
    """

    missing = [item.label for item in manifest.settings if item.required and settings.get(item.key) in (None, "")]
    if missing:
        raise APIError(
            "BANK_INVALID_SETTINGS",
            "Preencha todas as configurações operacionais obrigatórias para esta integração.",
            422,
            {"missing_fields": missing},
        )

    errors: dict[str, str] = {}
    for item in manifest.settings:
        value = settings.get(item.key)
        if value in (None, ""):
            continue
        field_type = item.field_type.lower()

        if item.options:
            allowed = {option_value for option_value, _ in item.options}
            if str(value) not in allowed:
                errors[item.key] = "valor fora do domínio permitido"
                continue

        if field_type == "integer":
            try:
                numeric = int(value)
            except (TypeError, ValueError):
                errors[item.key] = "deve ser um número inteiro"
                continue
            if item.minimum is not None and numeric < item.minimum:
                errors[item.key] = f"deve ser maior ou igual a {item.minimum}"
            elif item.maximum is not None and numeric > item.maximum:
                errors[item.key] = f"deve ser menor ou igual a {item.maximum}"
        elif field_type == "number":
            try:
                numeric_value = float(value)
            except (TypeError, ValueError):
                errors[item.key] = "deve ser numérico"
                continue
            if item.minimum is not None and numeric_value < item.minimum:
                errors[item.key] = f"deve ser maior ou igual a {item.minimum}"
            elif item.maximum is not None and numeric_value > item.maximum:
                errors[item.key] = f"deve ser menor ou igual a {item.maximum}"
        elif field_type == "boolean" and not isinstance(value, bool):
            errors[item.key] = "deve ser booleano"
        elif field_type == "json" and not isinstance(value, (dict, list)):
            errors[item.key] = "deve ser um objeto ou array JSON válido"

    if errors:
        raise APIError(
            "BANK_INVALID_SETTINGS",
            "Uma ou mais configurações operacionais do provider são inválidas.",
            422,
            {"fields": errors},
        )


def _decode_certificate(value: str) -> bytes:
    raw = value.strip()
    if "BEGIN CERTIFICATE" in raw:
        return raw.encode("utf-8")
    try:
        return base64.b64decode(raw, validate=True)
    except ValueError as exc:
        raise APIError("BANK_CERTIFICATE_INVALID", "Certificado bancário inválido.", 422) from exc


def certificate_metadata(
    certificate: str,
    *,
    password: str | None = None,
    container: str = "PEM",
) -> CertificateMetadata:
    try:
        blob = _decode_certificate(certificate)
        if container.upper() in {"PFX", "P12", "PKCS12"}:
            cert = pkcs12.load_key_and_certificates(blob, password.encode() if password else None)[1]
            if cert is None:
                raise ValueError("PKCS#12 sem certificado")
        elif b"BEGIN CERTIFICATE" in blob:
            cert = x509.load_pem_x509_certificate(blob)
        else:
            cert = x509.load_der_x509_certificate(blob)
    except Exception as exc:
        raise APIError("BANK_CERTIFICATE_INVALID", "Não foi possível validar o certificado bancário.", 422) from exc

    fingerprint = cert.fingerprint(hashes.SHA256()).hex()
    not_before = getattr(cert, "not_valid_before_utc", cert.not_valid_before.replace(tzinfo=UTC))
    not_after = getattr(cert, "not_valid_after_utc", cert.not_valid_after.replace(tzinfo=UTC))
    return CertificateMetadata(
        issuer=cert.issuer.rfc4514_string(),
        subject=cert.subject.rfc4514_string(),
        serial=f"{cert.serial_number:x}",
        not_before=not_before,
        not_after=not_after,
        fingerprint_sha256=fingerprint,
    )
