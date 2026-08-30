from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    app_name: str = "ARGWS Connect Control Plane"
    app_env: str = "development"
    app_version: str = "0.1.0"
    database_url: str = "postgresql+asyncpg://argws_control:argws_control@postgres:5432/argws_control"
    redis_url: str = "redis://redis:6379/0"
    rabbitmq_url: str = "amqp://argws_control:argws_control@rabbitmq:5672/argws_control"
    nats_url: str = "nats://nats:4222"
    cloudflare_api_token: str = ""
    cloudflare_zone_id: str = ""
    connect_api_base_domain: str = "connect.argws.com.br"


settings = Settings()
