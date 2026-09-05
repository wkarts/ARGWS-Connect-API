from __future__ import annotations

from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import EmailStr, Field, field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict
from sqlalchemy.engine import URL

from app.version import get_app_version


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=(".env", "../.env"),
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    app_name: str = "Connect|API Platform"
    enable_reference_financial_domain: bool = False
    app_env: Literal["development", "testing", "staging", "production"] = "development"
    app_debug: bool = False
    app_version: str = get_app_version()
    app_timezone: str = "America/Bahia"
    app_secret_key: str = Field(min_length=32, default="development-only-change-this-secret-key")
    field_encryption_key: str = ""
    internal_services_password: str = ""
    log_level: str = "INFO"
    log_agent_url: str = "http://connect-log-agent:8091"
    observability_tail_max_lines: int = 5000
    observability_bundle_max_mb: int = 100
    runtime_log_retention_days: int = 30

    platform_domain: str = "localhost"
    control_plane_host: str = "control.localhost"
    api_host: str = "api.localhost"
    tenant_domain_root: str = "localhost"
    public_scheme: Literal["http", "https"] = "http"
    trusted_hosts: str = "localhost,127.0.0.1,.localhost"
    cors_origins: str = "http://localhost:5173,http://localhost:8800"

    postgres_host: str = "localhost"
    postgres_port: int = 5432
    postgres_db: str = "connect_api_platform"
    postgres_user: str = "connect_api_admin"
    postgres_password: str = "connect_api_admin"
    postgres_admin_user: str = "connect_api_admin"
    postgres_admin_password: str = "connect_api_admin"
    postgres_pool_size: int = Field(default=5, ge=1, le=100)
    postgres_max_overflow: int = Field(default=0, ge=0, le=20)
    postgres_pool_timeout: int = Field(default=5, ge=1, le=60)
    postgres_connect_timeout: int = Field(default=5, ge=1, le=60)
    postgres_command_timeout: int = Field(default=60, ge=5, le=3600)
    postgres_pgbouncer_enabled: bool = False
    postgres_runtime_host: str = "connect-platform-pgbouncer"
    postgres_runtime_port: int = Field(default=6432, ge=1, le=65535)
    tenant_pool_size: int = Field(default=1, ge=1, le=10)
    tenant_engine_cache_size: int = Field(default=16, ge=1, le=1024)
    database_max_concurrent_requests: int = Field(default=16, ge=1, le=1000)
    tenant_db_prefix: str = "connect_api_tenant"
    tenant_db_user_prefix: str = "connect_api_t"

    redis_url: str = "redis://localhost:6379/0"
    redis_cache_ttl_seconds: int = 300
    rabbitmq_url: str = "amqp://guest:guest@localhost:5672//"
    celery_broker_url: str = "amqp://guest:guest@localhost:5672//"
    celery_result_backend: str = "redis://localhost:6379/1"
    celery_task_always_eager: bool = False
    provisioning_async: bool = False

    s3_endpoint_url: str = "http://localhost:9000"
    s3_public_endpoint_url: str = ""
    s3_region: str = "us-east-1"
    s3_access_key: str = "connectapi"
    s3_secret_key: str = "connectapi-development-secret"
    s3_use_ssl: bool = False
    s3_bucket_prefix: str = "connect-api-tenant"

    platform_admin_name: str = "Administrador da Plataforma"
    platform_admin_email: EmailStr = "admin@example.com"
    platform_admin_password: str = "ChangeMe123!"
    bootstrap_demo_tenant: bool = True
    demo_tenant_name: str = "Empresa Demonstração"
    demo_tenant_slug: str = "demo"
    demo_tenant_admin_name: str = "Administrador Demo"
    demo_tenant_admin_email: EmailStr = "admin.demo@example.com"
    demo_tenant_admin_password: str = "ChangeMe123!"

    platform_tls_automation_enabled: bool = False
    platform_tls_status_dir: Path = Path("/tls-status")
    platform_tls_receipt_max_age: int = Field(default=600, ge=60, le=86400)
    platform_dns_receipt_max_age: int = Field(default=90000, ge=60, le=172800)

    cloudflare_enabled: bool = False
    cloudflare_api_token: str = ""
    cloudflare_account_id: str = ""
    cloudflare_zone_id: str = ""
    cloudflare_zone_name: str = ""
    cloudflare_proxied: bool = True
    cloudflare_tenant_record_target: str = ""
    cloudflare_provisioning_mode: Literal["wildcard", "records"] = "wildcard"
    domain_reconciliation_token: str = ""

    smtp_enabled: bool = False
    smtp_host: str = ""
    smtp_port: int = Field(default=587, ge=1, le=65535)
    smtp_username: str = ""
    smtp_password: str = ""
    smtp_security: Literal["none", "starttls", "ssl"] = "starttls"
    smtp_from_email: str = ""
    smtp_from_name: str = "Connect|API Platform"
    smtp_timeout_seconds: int = Field(default=30, ge=1, le=300)
    password_reset_url: str = ""
    password_reset_token_ttl_minutes: int = Field(default=30, ge=5, le=1440)
    password_reset_requests_per_account_hour: int = Field(default=5, ge=1, le=100)
    password_reset_requests_per_ip_hour: int = Field(default=30, ge=1, le=1000)
    password_reset_attempts_per_ip_hour: int = Field(default=30, ge=1, le=1000)

    evolution_enabled: bool = False
    evolution_base_url: str = ""
    evolution_api_key: str = ""
    evolution_instance: str = "connect-api-platform"
    evolution_send_text_path: str = "/message/sendText/{instance}"
    evolution_send_media_path: str = "/message/sendMedia/{instance}"
    evolution_webhook_secret: str = ""
    evolution_timeout_seconds: int = 30

    # Connect|API Engine bridge. The Platform never exposes this key to browsers.
    connect_engine_base_url: str = "http://connect-engine:8080"
    connect_engine_api_key: str = ""
    connect_engine_timeout_seconds: int = 30
    connect_engine_verify_tls: bool = False

    banking_webhook_secret: str = ""

    backup_enabled: bool = True
    backup_dir: Path = Path("/data/backups")
    backup_cron: str = "0 2 * * *"
    backup_keep_daily: int = 14
    backup_keep_weekly: int = 8
    backup_keep_monthly: int = 12
    backup_compress_level: int = 9
    backup_encryption_recipient: str = ""
    backup_encryption_identity: Path = Path("/run/secrets/backup_age_identity")
    maintenance_file: Path = Path("/data/maintenance.flag")
    backup_upload_s3: bool = True
    backup_s3_bucket: str = "connect-api-backups"
    backup_rclone_config: Path = Path("/run/secrets/rclone_config")
    backup_google_drive_enabled: bool = False
    backup_google_drive_remote: str = "gdrive:connect-api-platform"
    backup_dropbox_enabled: bool = False
    backup_dropbox_remote: str = "dropbox:connect-api-platform"

    access_token_minutes: int = 30
    refresh_token_days: int = 14
    password_min_length: int = 12
    login_max_attempts: int = 8
    login_lock_minutes: int = 15
    rate_limit_default: str = "120/minute"
    webhook_max_age_seconds: int = 300
    allow_dev_tenant_header: bool = False

    prometheus_enabled: bool = True
    prometheus_base_url: str = "http://connect-prometheus:9090"
    prometheus_lifecycle_enabled: bool = False
    grafana_base_url: str = "http://connect-grafana:3000"
    grafana_service_account_token: str = ""
    grafana_org_id: int = 1

    @field_validator("app_env", mode="before")
    @classmethod
    def normalize_app_environment(cls, value: object) -> object:
        # Os deployments históricos usam PLATFORM_APP_ENV=develop. Mantemos
        # compatibilidade e normalizamos para o valor canônico do Settings.
        if isinstance(value, str) and value.strip().lower() == "develop":
            return "development"
        return value

    @field_validator("trusted_hosts", "cors_origins")
    @classmethod
    def strip_csv(cls, value: str) -> str:
        return ",".join(item.strip() for item in value.split(",") if item.strip())

    @model_validator(mode="after")
    def validate_smtp(self) -> "Settings":
        if not self.smtp_enabled:
            return self
        missing: list[str] = []
        if not self.smtp_host.strip():
            missing.append("SMTP_HOST")
        if not self.smtp_from_email.strip() or "@" not in self.smtp_from_email:
            missing.append("SMTP_FROM_EMAIL")
        if bool(self.smtp_username.strip()) != bool(self.smtp_password):
            missing.append("SMTP_USERNAME/SMTP_PASSWORD")
        if self.app_env == "production" and not self.password_reset_public_url.startswith("https://"):
            missing.append("PASSWORD_RESET_URL(HTTPS)")
        if missing:
            raise ValueError("Configuração SMTP inválida: " + ", ".join(missing))
        return self

    @model_validator(mode="after")
    def reject_unsafe_production_secrets(self) -> "Settings":
        if self.app_env != "production":
            return self
        required = {
            "APP_SECRET_KEY": self.app_secret_key,
            "FIELD_ENCRYPTION_KEY": self.field_encryption_key,
            "POSTGRES_PASSWORD": self.postgres_password,
            "POSTGRES_ADMIN_PASSWORD": self.postgres_admin_password,
            "S3_SECRET_KEY": self.s3_secret_key,
            "PLATFORM_ADMIN_PASSWORD": self.platform_admin_password,
            "DOMAIN_RECONCILIATION_TOKEN": self.domain_reconciliation_token,
        }
        invalid = [
            name
            for name, value in required.items()
            if len(value) < 12 or value.startswith("CHANGE_ME") or "development-only" in value
        ]
        if self.internal_services_password and (
            len(self.internal_services_password) < 12 or self.internal_services_password.startswith("CHANGE_ME")
        ):
            invalid.append("INTERNAL_SERVICES_PASSWORD")
        if "CHANGE_ME" in self.rabbitmq_url or "CHANGE_ME" in self.celery_broker_url:
            invalid.append("RABBITMQ_URL/CELERY_BROKER_URL")
        if self.evolution_enabled and (
            len(self.evolution_webhook_secret) < 12
            or self.evolution_webhook_secret.startswith("CHANGE_ME")
        ):
            invalid.append("EVOLUTION_WEBHOOK_SECRET")
        if not self.connect_engine_api_key or len(self.connect_engine_api_key) < 12 or self.connect_engine_api_key.startswith("CHANGE_ME"):
            invalid.append("CONNECT_ENGINE_API_KEY")
        if self.enable_reference_financial_domain and (
            len(self.banking_webhook_secret) < 12 or self.banking_webhook_secret.startswith("CHANGE_ME")
        ):
            invalid.append("BANKING_WEBHOOK_SECRET")
        if invalid:
            raise ValueError(
                "Segredos de produção ausentes ou inseguros: " + ", ".join(sorted(set(invalid)))
                + ". Configure os segredos no .env ou no gerenciador de segredos da stack."
            )
        return self

    @property
    def trusted_host_list(self) -> list[str]:
        return [item for item in self.trusted_hosts.split(",") if item]

    @property
    def cors_origin_list(self) -> list[str]:
        return [item for item in self.cors_origins.split(",") if item]

    @property
    def password_reset_public_url(self) -> str:
        configured = self.password_reset_url.strip()
        if configured:
            return configured
        return f"{self.public_scheme}://{self.control_plane_host}/reset-password"

    def _database_url(self, driver: str) -> str:
        return URL.create(
            drivername=driver,
            username=self.postgres_user,
            password=self.postgres_password,
            host=self.postgres_host,
            port=self.postgres_port,
            database=self.postgres_db,
        ).render_as_string(hide_password=False)

    @property
    def platform_database_url(self) -> str:
        return self._database_url("postgresql+asyncpg")

    @property
    def platform_runtime_database_url(self) -> str:
        if not self.postgres_pgbouncer_enabled:
            return self.platform_database_url
        return URL.create(
            drivername="postgresql+asyncpg", username=self.postgres_user,
            password=self.postgres_password, host=self.postgres_runtime_host,
            port=self.postgres_runtime_port, database=self.postgres_db,
        ).render_as_string(hide_password=False)

    @property
    def platform_database_url_sync(self) -> str:
        return self._database_url("postgresql+psycopg")

    def tenant_hostname(self, slug: str) -> str:
        return f"{slug}.{self.tenant_domain_root}".lower().strip(".")


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
