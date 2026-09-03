from __future__ import annotations

import json
import tempfile
from pathlib import Path
from datetime import UTC, datetime, timedelta
from uuid import UUID, uuid4

from sqlalchemy import or_, select
from sqlalchemy.dialects.postgresql import insert as pg_insert
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import settings
from app.core.errors import APIError
from app.core.idempotency import compact_idempotency_key
from app.core.secrets import secret_cipher
from app.core.tenant_context import get_tenant_context
from app.db.platform import PlatformSessionLocal
from app.models.platform import PlatformIntegration
from app.models.tenant import Company, IntegrationSetting, Notification
from app.providers.evolution import EvolutionConfig, EvolutionWhatsAppProvider
from app.providers.smtp import SMTPConfig, SMTPProvider
from app.providers.storage import S3StorageProvider
from app.services.managed_whatsapp import managed_whatsapp
from app.services.observability import record_runtime_log
from app.services.phones import normalize_brazil_phone


class NotificationService:
    def __init__(self, session: AsyncSession) -> None:
        self.session = session

    async def _integration(self, provider: str, company_id: str | None) -> IntegrationSetting | None:
        clauses = [IntegrationSetting.provider == provider, IntegrationSetting.is_enabled.is_(True)]
        if company_id:
            stmt = (
                select(IntegrationSetting)
                .where(*clauses, or_(IntegrationSetting.company_id == company_id, IntegrationSetting.company_id.is_(None)))
                .order_by(IntegrationSetting.company_id.desc().nullslast())
            )
        else:
            stmt = select(IntegrationSetting).where(*clauses, IntegrationSetting.company_id.is_(None))
        return (await self.session.execute(stmt)).scalars().first()

    @staticmethod
    def _secrets(item: IntegrationSetting | None) -> dict[str, str]:
        if item is None or not item.encrypted_secrets:
            return {}
        return json.loads(secret_cipher.decrypt(item.encrypted_secrets))

    @staticmethod
    async def _platform_integration(provider: str) -> tuple[dict, dict[str, str]]:
        async with PlatformSessionLocal() as platform_session:
            item = await platform_session.scalar(
                select(PlatformIntegration).where(
                    PlatformIntegration.provider == provider,
                    PlatformIntegration.is_enabled.is_(True),
                )
            )
            if item is None:
                return {}, {}
            public = dict(item.public_config or {})
            secrets_data = (
                json.loads(secret_cipher.decrypt(item.encrypted_secrets))
                if item.encrypted_secrets
                else {}
            )
            return public, secrets_data

    @staticmethod
    def _uses_external_whatsapp(item: IntegrationSetting | None) -> bool:
        """Só permite substituir o WhatsApp gerenciado por escolha explícita.

        Antes, qualquer IntegrationSetting legado chamado EVOLUTION tinha
        precedência sobre a instância gerenciada do tenant. Isso fazia o teste
        do Control Plane funcionar e o mesmo tenant falhar no worker, pois cada
        caminho acabava usando uma configuração diferente. A partir daqui o
        serviço gerenciado é a fonte de verdade; integração externa precisa
        declarar ``delivery_mode=EXTERNAL``.
        """
        if item is None:
            return False
        config = dict(item.public_config or {})
        return str(config.get("delivery_mode") or "").strip().upper() == "EXTERNAL"

    async def _emitting_company(self, company_id: UUID | None) -> Company | None:
        if company_id is not None:
            return await self.session.get(Company, company_id)
        return await self.session.scalar(
            select(Company).where(Company.is_active.is_(True)).order_by(Company.created_at, Company.id).limit(1)
        )

    @staticmethod
    def _friendly_failure(exc: Exception, channel: str) -> str:
        label = "WhatsApp" if channel == "WHATSAPP" else "e-mail"
        if isinstance(exc, APIError):
            remote_status = exc.details.get("status_code")
            suffix = f" (HTTP {remote_status})" if remote_status else ""
            return f"{exc.message.rstrip('.')} {suffix}.".replace("  ", " ")[:2000]
        return f"Falha técnica no envio por {label}. Consulte o diagnóstico da plataforma."[:2000]

    @staticmethod
    async def _record_dispatch_failure(notification: Notification, exc: Exception) -> None:
        try:
            context = get_tenant_context()
            details: dict[str, object] = {
                "notification_id": str(notification.id),
                "channel": notification.channel,
                "provider": notification.provider,
                "attempt": notification.attempts,
                "destination_suffix": notification.destination[-4:] if notification.destination else None,
                "exception_type": type(exc).__name__,
            }
            if isinstance(exc, APIError):
                details.update(
                    {
                        "error_code": exc.code,
                        "remote_status": exc.details.get("status_code"),
                        "provider_message": exc.details.get("provider_message"),
                        "provider_operation": exc.details.get("operation"),
                    }
                )
            async with PlatformSessionLocal() as platform_session:
                await record_runtime_log(
                    platform_session,
                    source="integration",
                    service="whatsapp" if notification.channel == "WHATSAPP" else "email",
                    level="ERROR",
                    event="notification_delivery_failed",
                    message=(
                        "Falha ao entregar mensagem pelo WhatsApp."
                        if notification.channel == "WHATSAPP"
                        else "Falha ao entregar mensagem por e-mail."
                    ),
                    tenant_id=context.tenant_id,
                    details=details,
                )
                await platform_session.commit()
        except Exception:
            return

    async def queue(
        self,
        *,
        channel: str,
        destination: str,
        body: str,
        subject: str | None = None,
        company_id: str | None = None,
        customer_id: str | None = None,
        receivable_id: str | None = None,
        idempotency_key: str | None = None,
        attachment_keys: list[str] | None = None,
        scheduled_at: datetime | None = None,
        commit: bool = True,
    ) -> Notification:
        normalized_channel = channel.strip().upper()
        if normalized_channel not in {"EMAIL", "WHATSAPP"}:
            raise APIError("UNSUPPORTED_NOTIFICATION_CHANNEL", "Canal de comunicação não suportado.", 422)
        normalized_destination = destination.strip()
        if not normalized_destination:
            raise APIError("NOTIFICATION_DESTINATION_REQUIRED", "Destino da comunicação é obrigatório.", 422)
        company_uuid = UUID(company_id) if company_id else None
        if normalized_channel == "WHATSAPP":
            company = await self._emitting_company(company_uuid)
            normalized_destination = normalize_brazil_phone(
                normalized_destination,
                company=company,
                field_name="número do destinatário do WhatsApp",
            )
        raw_key = idempotency_key or f"manual:{normalized_channel}:{normalized_destination}:{uuid4()}"
        key = compact_idempotency_key(raw_key)
        values = {
            "company_id": company_uuid,
            "customer_id": UUID(customer_id) if customer_id else None,
            "receivable_id": UUID(receivable_id) if receivable_id else None,
            "channel": normalized_channel,
            "provider": normalized_channel,
            "destination": normalized_destination,
            "subject": subject,
            "body": body,
            "attachment_keys": attachment_keys or [],
            "status": "PENDING",
            "idempotency_key": key,
            "scheduled_at": scheduled_at or datetime.now(UTC),
        }
        statement = (
            pg_insert(Notification)
            .values(**values)
            .on_conflict_do_nothing(index_elements=[Notification.idempotency_key])
            .returning(Notification.id)
        )
        notification_id = await self.session.scalar(statement)
        if notification_id is None:
            notification = await self.session.scalar(select(Notification).where(Notification.idempotency_key == key))
            if notification is None:
                raise RuntimeError("Não foi possível recuperar a notificação idempotente.")
        else:
            notification = await self.session.get(Notification, notification_id)
            if notification is None:
                raise RuntimeError("Notificação inserida não pôde ser carregada.")
        if commit:
            await self.session.commit()
            await self.session.refresh(notification)
        return notification

    async def dispatch(self, notification: Notification) -> Notification:
        if notification.status in {"SENT", "DELIVERED", "READ"}:
            return notification
        notification.attempts += 1
        try:
            if notification.channel == "EMAIL":
                item = await self._integration("SMTP", str(notification.company_id) if notification.company_id else None)
                if item:
                    public = dict(item.public_config or {})
                    secrets_data = self._secrets(item)
                else:
                    public, secrets_data = await self._platform_integration("SMTP")
                host = str(public.get("host") or settings.smtp_host)
                if not host:
                    raise APIError("EMAIL_NOT_CONFIGURED", "Serviço de e-mail da plataforma não está configurado.", 503)
                provider = SMTPProvider(
                    SMTPConfig(
                        host=host,
                        port=int(public.get("port") or settings.smtp_port),
                        username=secrets_data.get("username", settings.smtp_username),
                        password=secrets_data.get("password", settings.smtp_password),
                        security=str(public.get("security") or settings.smtp_security),
                        from_email=str(public.get("from_email") or settings.smtp_from_email),
                        from_name=str(public.get("from_name") or settings.smtp_from_name),
                        timeout=settings.smtp_timeout_seconds,
                    )
                )
                attachments: list[Path] = []
                with tempfile.TemporaryDirectory(prefix="financial-notification-") as temp_dir:
                    if notification.attachment_keys:
                        context = get_tenant_context()
                        storage = S3StorageProvider()
                        for index, key in enumerate(notification.attachment_keys):
                            filename = Path(key).name or f"anexo-{index + 1}"
                            target = Path(temp_dir) / filename
                            target.write_bytes(await storage.get_bytes(context.storage_bucket, key))
                            attachments.append(target)
                    external = await provider.send(
                        to=notification.destination,
                        subject=notification.subject or settings.app_name,
                        html=notification.body,
                        attachments=attachments,
                    )
                notification.external_id = external[:180]
            elif notification.channel == "WHATSAPP":
                company = await self._emitting_company(notification.company_id)
                normalized_destination = normalize_brazil_phone(
                    notification.destination,
                    company=company,
                    field_name="número do destinatário do WhatsApp",
                )
                if normalized_destination != notification.destination:
                    notification.destination = normalized_destination

                item = await self._integration("EVOLUTION", str(notification.company_id) if notification.company_id else None)
                if self._uses_external_whatsapp(item):
                    public = dict(item.public_config or {}) if item else {}
                    secrets_data = self._secrets(item)
                    base_url = str(public.get("base_url") or settings.evolution_base_url)
                    api_key = secrets_data.get("api_key", settings.evolution_api_key)
                    instance = str(public.get("instance") or settings.evolution_instance)
                    if not base_url or not api_key or not instance:
                        raise APIError("WHATSAPP_NOT_CONFIGURED", "WhatsApp externo não está configurado.", 503)
                    provider = EvolutionWhatsAppProvider(
                        EvolutionConfig(
                            base_url=base_url,
                            api_key=api_key,
                            instance=instance,
                            send_text_path=str(public.get("send_text_path") or settings.evolution_send_text_path),
                            send_media_path=str(public.get("send_media_path") or settings.evolution_send_media_path),
                            timeout=settings.evolution_timeout_seconds,
                        )
                    )
                    notification.provider = "EVOLUTION_EXTERNAL"
                else:
                    managed = await managed_whatsapp(get_tenant_context())
                    provider = managed.provider
                    notification.provider = "EVOLUTION_MANAGED"
                    snapshot = await provider.connection_snapshot()
                    if snapshot["state"] not in {"CONNECTED", "RECONNECTING"} or not snapshot["session_exists"]:
                        raise APIError(
                            "WHATSAPP_NOT_CONNECTED",
                            "O WhatsApp da conta não está conectado. Conecte a instância antes de enviar mensagens.",
                            409,
                        )

                result = await provider.send_text(normalized_destination, notification.body)
                notification.external_id = result.external_id
                if notification.attachment_keys:
                    context = get_tenant_context()
                    storage = S3StorageProvider()
                    for key in notification.attachment_keys:
                        media_url = await storage.presigned_url(context.storage_bucket, key, expires=1800)
                        if not media_url:
                            raise APIError(
                                "WHATSAPP_MEDIA_ENDPOINT_NOT_CONFIGURED",
                                "Envio de anexos pelo WhatsApp ainda não está disponível.",
                                503,
                            )
                        media = await provider.send_media(
                            normalized_destination,
                            media_url,
                            caption=notification.subject or "Documento financeiro",
                            filename=Path(key).name or "documento.pdf",
                        )
                        if not notification.external_id and media.external_id:
                            notification.external_id = media.external_id
            else:
                raise APIError("UNSUPPORTED_NOTIFICATION_CHANNEL", "Canal de comunicação não suportado.", 422)
            notification.status = "SENT"
            notification.sent_at = datetime.now(UTC)
            notification.last_error = None
        except Exception as exc:  # noqa: BLE001 - persistir falha operacional para retry/DLQ
            notification.status = "FAILED" if notification.attempts >= 4 else "RETRY"
            notification.failed_at = datetime.now(UTC)
            notification.last_error = self._friendly_failure(exc, notification.channel)
            await self._record_dispatch_failure(notification, exc)
            if notification.status == "RETRY":
                notification.scheduled_at = datetime.now(UTC) + timedelta(minutes=min(2 ** notification.attempts, 60))
        await self.session.commit()
        return notification

    async def dispatch_pending(self, limit: int = 100) -> int:
        processed = 0
        for _ in range(limit):
            stmt = (
                select(Notification)
                .where(
                    Notification.status.in_(["PENDING", "RETRY"]),
                    Notification.scheduled_at <= datetime.now(UTC),
                )
                .order_by(Notification.scheduled_at)
                .with_for_update(skip_locked=True)
                .limit(1)
            )
            item = (await self.session.execute(stmt)).scalar_one_or_none()
            if item is None:
                await self.session.rollback()
                break
            await self.dispatch(item)
            processed += 1
        return processed
