from __future__ import annotations

import json
import os
import sys
from collections.abc import Mapping
from urllib.parse import unquote, urlsplit

_ALLOWED_SMTP_SECURITY = {"none", "starttls", "ssl"}
_PLACEHOLDER_MARKERS = ("CHANGE_ME", "development-only", "__CONFIGURE_")


def _value(env: Mapping[str, str], key: str, default: str = "") -> str:
    return str(env.get(key, default)).strip()


def _truthy(value: str) -> bool:
    return value.lower() in {"1", "true", "yes", "on"}


def _unsafe_secret(value: str, *, minimum: int = 12) -> bool:
    return len(value) < minimum or any(marker in value for marker in _PLACEHOLDER_MARKERS)


def _url_password(url: str) -> str | None:
    try:
        parsed = urlsplit(url)
    except ValueError:
        return None
    if parsed.password is None:
        return None
    return unquote(parsed.password)


def validate_environment(env: Mapping[str, str] | None = None) -> list[str]:
    values = os.environ if env is None else env
    errors: list[str] = []

    app_env = _value(values, "APP_ENV", "development").lower()
    smtp_security = _value(values, "SMTP_SECURITY", "starttls").lower()
    if smtp_security not in _ALLOWED_SMTP_SECURITY:
        errors.append(
            "SMTP_SECURITY inválido; use apenas none, starttls ou ssl "
            f"(recebido: {smtp_security or '<vazio>'})."
        )

    postgres_user = _value(values, "POSTGRES_USER", "connect_api_admin")
    postgres_password = _value(values, "POSTGRES_PASSWORD")
    postgres_admin_user = _value(values, "POSTGRES_ADMIN_USER", postgres_user)
    postgres_admin_password = _value(values, "POSTGRES_ADMIN_PASSWORD", postgres_password)
    if postgres_admin_user == postgres_user and postgres_admin_password != postgres_password:
        errors.append(
            "POSTGRES_ADMIN_USER é igual a POSTGRES_USER, portanto "
            "POSTGRES_ADMIN_PASSWORD precisa ser igual a POSTGRES_PASSWORD."
        )

    rabbitmq_url = _value(values, "RABBITMQ_URL")
    celery_broker_url = _value(values, "CELERY_BROKER_URL")
    rabbitmq_password = (
        _value(values, "RABBITMQ_PASSWORD")
        or _url_password(rabbitmq_url)
        or _url_password(celery_broker_url)
        or ""
    )
    for name, url in (("RABBITMQ_URL", rabbitmq_url), ("CELERY_BROKER_URL", celery_broker_url)):
        if any(marker in url for marker in _PLACEHOLDER_MARKERS):
            errors.append(f"{name} ainda contém placeholder inseguro.")
        parsed_password = _url_password(url) if url else None
        if rabbitmq_password and parsed_password is not None and parsed_password != rabbitmq_password:
            errors.append(f"A senha embutida em {name} não corresponde à credencial RabbitMQ efetiva.")

    s3_endpoint = _value(values, "S3_ENDPOINT_URL", "http://connect-minio:9000")
    s3_access_key = _value(values, "S3_ACCESS_KEY")
    s3_secret_key = _value(values, "S3_SECRET_KEY")
    minio_root_user = _value(values, "MINIO_ROOT_USER")
    minio_root_password = _value(values, "MINIO_ROOT_PASSWORD")
    if "connect-minio" in s3_endpoint:
        if minio_root_user and minio_root_password and s3_access_key == minio_root_user and s3_secret_key != minio_root_password:
            errors.append(
                "S3_ACCESS_KEY usa o mesmo usuário do MINIO_ROOT_USER; nesse modo "
                "S3_SECRET_KEY precisa ser igual a MINIO_ROOT_PASSWORD."
            )
        if minio_root_password and _unsafe_secret(minio_root_password):
            errors.append("MINIO_ROOT_PASSWORD precisa ter ao menos 12 caracteres e não pode ser placeholder.")

    cloudflare_enabled = _truthy(_value(values, "CLOUDFLARE_ENABLED", "false"))
    cloudflare_mode = _value(values, "CLOUDFLARE_PROVISIONING_MODE", "wildcard").lower()
    if cloudflare_enabled:
        if _unsafe_secret(_value(values, "CLOUDFLARE_API_TOKEN")):
            errors.append("CLOUDFLARE_ENABLED=true exige CLOUDFLARE_API_TOKEN válido.")
        if _unsafe_secret(_value(values, "CLOUDFLARE_ZONE_ID"), minimum=8):
            errors.append("CLOUDFLARE_ENABLED=true exige CLOUDFLARE_ZONE_ID válido.")
        if cloudflare_mode == "wildcard":
            if not _value(values, "CLOUDFLARE_TENANT_RECORD_TARGET"):
                errors.append("Wildcard gerenciado exige CLOUDFLARE_TENANT_RECORD_TARGET.")
            for key in ("ACME_DOMAIN", "ACME_EMAIL", "CLOUDPANEL_SITE_DOMAIN", "CLOUDPANEL_WILDCARD_DOMAIN"):
                if not _value(values, key):
                    errors.append(f"Wildcard automático exige {key}.")

    if _truthy(_value(values, "SMTP_ENABLED", "false")):
        smtp_host = _value(values, "SMTP_HOST")
        if not smtp_host:
            errors.append("SMTP_ENABLED=true exige SMTP_HOST.")
        elif "@" in smtp_host:
            errors.append("SMTP_HOST deve ser hostname do servidor SMTP, não endereço de e-mail.")
        smtp_port = _value(values, "SMTP_PORT", "587")
        if smtp_port == "465" and smtp_security != "ssl":
            errors.append("SMTP_PORT=465 exige SMTP_SECURITY=ssl.")

    if _truthy(_value(values, "EVOLUTION_ENABLED", "false")):
        for key in ("EVOLUTION_BASE_URL", "EVOLUTION_API_KEY", "EVOLUTION_WEBHOOK_SECRET"):
            invalid = _unsafe_secret(_value(values, key)) if key != "EVOLUTION_BASE_URL" else not _value(values, key)
            if invalid:
                errors.append(f"{key} obrigatório/seguro quando EVOLUTION_ENABLED=true.")

    if app_env == "production":
        required_secrets = {
            "APP_SECRET_KEY": (32, _value(values, "APP_SECRET_KEY")),
            "FIELD_ENCRYPTION_KEY": (32, _value(values, "FIELD_ENCRYPTION_KEY")),
            "POSTGRES_PASSWORD": (12, postgres_password),
            "POSTGRES_ADMIN_PASSWORD": (12, postgres_admin_password),
            "RABBITMQ_PASSWORD": (12, rabbitmq_password),
            "S3_SECRET_KEY": (12, s3_secret_key),
            "PLATFORM_ADMIN_PASSWORD": (12, _value(values, "PLATFORM_ADMIN_PASSWORD")),
            "DOMAIN_RECONCILIATION_TOKEN": (12, _value(values, "DOMAIN_RECONCILIATION_TOKEN")),
            "BANKING_WEBHOOK_SECRET": (12, _value(values, "BANKING_WEBHOOK_SECRET")),
        }
        for key, (minimum, value) in required_secrets.items():
            if _unsafe_secret(value, minimum=minimum):
                errors.append(f"{key} ausente, curto ou ainda com placeholder de desenvolvimento.")

    return sorted(set(errors))


def main() -> int:
    errors = validate_environment()
    report = {"status": "PASS" if not errors else "FAIL", "checks": "runtime-environment", "errors": errors}
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0 if not errors else 2


if __name__ == "__main__":
    sys.exit(main())
