from __future__ import annotations

from app.preflight import validate_environment


def valid_env() -> dict[str, str]:
    password = "A-very-safe-password-123"
    return {
        "APP_ENV": "production",
        "APP_SECRET_KEY": "a" * 64,
        "FIELD_ENCRYPTION_KEY": "b" * 44,
        "POSTGRES_USER": "connect_api_admin",
        "POSTGRES_PASSWORD": password,
        "POSTGRES_ADMIN_USER": "connect_api_admin",
        "POSTGRES_ADMIN_PASSWORD": password,
        "RABBITMQ_PASSWORD": "rabbit-safe-password-123",
        "RABBITMQ_URL": "amqp://financial:rabbit-safe-password-123@connect-rabbitmq:5672/connectapi",
        "CELERY_BROKER_URL": "amqp://financial:rabbit-safe-password-123@connect-rabbitmq:5672/connectapi",
        "S3_ENDPOINT_URL": "http://connect-minio:9000",
        "S3_ACCESS_KEY": "connectapi",
        "S3_SECRET_KEY": "minio-safe-password-123",
        "MINIO_ROOT_USER": "connectapi",
        "MINIO_ROOT_PASSWORD": "minio-safe-password-123",
        "PLATFORM_ADMIN_PASSWORD": "admin-safe-password-123",
        "DOMAIN_RECONCILIATION_TOKEN": "domain-safe-token-123456",
        "BANKING_WEBHOOK_SECRET": "banking-safe-token-123456",
        "SMTP_ENABLED": "false",
        "SMTP_SECURITY": "starttls",
        "EVOLUTION_ENABLED": "false",
    }


def test_preflight_accepts_consistent_production_environment() -> None:
    assert validate_environment(valid_env()) == []


def test_preflight_reports_current_deploy_mistakes_without_leaking_secrets() -> None:
    env = valid_env()
    env.update(
        {
            "POSTGRES_ADMIN_PASSWORD": "different-admin-password",
            "RABBITMQ_PASSWORD": "CHANGE_ME_RABBITMQ_PASSWORD",
            "RABBITMQ_URL": "amqp://financial:CHANGE_ME_RABBITMQ_PASSWORD@connect-rabbitmq:5672/connectapi",
            "CELERY_BROKER_URL": "amqp://financial:CHANGE_ME_RABBITMQ_PASSWORD@connect-rabbitmq:5672/connectapi",
            "S3_SECRET_KEY": "different-s3-password-123",
            "SMTP_SECURITY": "startssl",
            "DOMAIN_RECONCILIATION_TOKEN": "CHANGE_ME_DOMAIN_AGENT_TOKEN",
            "BANKING_WEBHOOK_SECRET": "CHANGE_ME_BANKING_WEBHOOK_SECRET",
        }
    )
    errors = validate_environment(env)
    joined = "\n".join(errors)
    assert "POSTGRES_ADMIN_PASSWORD" in joined
    assert "RABBITMQ" in joined
    assert "S3_SECRET_KEY" in joined
    assert "SMTP_SECURITY" in joined
    assert "DOMAIN_RECONCILIATION_TOKEN" in joined
    assert "BANKING_WEBHOOK_SECRET" in joined
    assert "different-admin-password" not in joined


def test_preflight_requires_ssl_on_smtp_465_when_enabled() -> None:
    env = valid_env()
    env.update(
        {
            "SMTP_ENABLED": "true",
            "SMTP_HOST": "smtp.example.com",
            "SMTP_PORT": "465",
            "SMTP_SECURITY": "starttls",
        }
    )
    assert "SMTP_PORT=465 exige SMTP_SECURITY=ssl." in validate_environment(env)
