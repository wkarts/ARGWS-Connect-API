from __future__ import annotations

from email.message import EmailMessage
from email.utils import formataddr
from html import escape
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

import aiosmtplib
import structlog

from app.core.config import Settings, settings
from app.core.errors import APIError

logger = structlog.get_logger(__name__)


class InternalMailService:
    """Transporte SMTP canônico dos e-mails internos da Platform."""

    def __init__(self, config: Settings = settings) -> None:
        self.config = config

    def ensure_configured(self) -> None:
        if not self.config.smtp_enabled:
            raise APIError(
                "SMTP_DISABLED",
                "O serviço de e-mail da plataforma ainda não está habilitado.",
                503,
            )
        if not self.config.smtp_host.strip() or not self.config.smtp_from_email.strip():
            raise APIError(
                "SMTP_NOT_CONFIGURED",
                "O serviço de e-mail da plataforma está incompleto.",
                503,
            )

    @staticmethod
    def _header(value: str) -> str:
        if "\r" in value or "\n" in value:
            raise ValueError("Cabeçalho de e-mail inválido.")
        return value.strip()

    @staticmethod
    def _append_query(url: str, key: str, value: str) -> str:
        parts = urlsplit(url)
        query = parse_qsl(parts.query, keep_blank_values=True)
        query.append((key, value))
        return urlunsplit((parts.scheme, parts.netloc, parts.path, urlencode(query), parts.fragment))

    def password_reset_link(self, token: str) -> str:
        return self._append_query(self.config.password_reset_public_url, "token", token)

    def _message(self, *, recipient: str, subject: str, text: str, html: str) -> EmailMessage:
        message = EmailMessage()
        message["From"] = formataddr(
            (
                self._header(self.config.smtp_from_name),
                self._header(self.config.smtp_from_email),
            )
        )
        message["To"] = self._header(recipient)
        message["Subject"] = self._header(subject)
        message.set_content(text)
        message.add_alternative(html, subtype="html")
        return message

    async def send(self, message: EmailMessage) -> None:
        self.ensure_configured()
        await aiosmtplib.send(
            message,
            hostname=self.config.smtp_host,
            port=self.config.smtp_port,
            username=self.config.smtp_username or None,
            password=self.config.smtp_password or None,
            use_tls=self.config.smtp_security == "ssl",
            start_tls=self.config.smtp_security == "starttls",
            timeout=self.config.smtp_timeout_seconds,
        )

    async def send_password_reset(self, *, name: str, email: str, token: str) -> None:
        link = self.password_reset_link(token)
        safe_name = escape(name or "usuário")
        safe_link = escape(link, quote=True)
        ttl = self.config.password_reset_token_ttl_minutes
        text = (
            f"Olá, {name or 'usuário'}.\n\n"
            "Recebemos uma solicitação para redefinir sua senha do Connect|API Control Plane.\n"
            f"Use este link em até {ttl} minutos:\n{link}\n\n"
            "Se você não solicitou a alteração, ignore esta mensagem."
        )
        html = f"""<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #e2e8f0;border-radius:18px;overflow:hidden">
<tr><td style="padding:28px 32px;background:#eff6ff;border-bottom:1px solid #dbeafe"><strong style="font-size:20px;color:#175197">Connect|API Platform</strong><br><span style="font-size:12px;color:#64748b">Control Plane</span></td></tr>
<tr><td style="padding:32px"><h1 style="font-size:24px;margin:0 0 18px">Recuperação de senha</h1><p style="line-height:1.6">Olá, {safe_name}.</p><p style="line-height:1.6">Recebemos uma solicitação para redefinir sua senha. O link abaixo é individual, de uso único e expira em <strong>{ttl} minutos</strong>.</p><p style="margin:28px 0"><a href="{safe_link}" style="display:inline-block;background:#175197;color:#fff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:bold">Definir nova senha</a></p><p style="font-size:13px;line-height:1.6;color:#64748b">Se você não solicitou essa alteração, ignore este e-mail. Sua senha atual continuará válida.</p></td></tr>
</table></td></tr></table></body></html>"""
        await self.send(
            self._message(
                recipient=email,
                subject="Recuperação de senha — Connect|API Platform",
                text=text,
                html=html,
            )
        )

    async def send_password_changed(self, *, name: str, email: str) -> None:
        safe_name = escape(name or "usuário")
        access_ttl = self.config.access_token_minutes
        text = (
            f"Olá, {name or 'usuário'}.\n\n"
            "Sua senha do Connect|API Control Plane foi alterada com sucesso.\n"
            "As renovações de sessão anteriores foram revogadas. "
            f"Uma sessão já aberta pode permanecer ativa até o token de acesso expirar, em no máximo {access_ttl} minutos.\n\n"
            "Caso não reconheça esta alteração, contate o administrador da plataforma imediatamente."
        )
        html = f"""<!doctype html>
<html lang="pt-BR"><body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0"><tr><td align="center" style="padding:32px 16px">
<table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:600px;background:#fff;border:1px solid #e2e8f0;border-radius:18px"><tr><td style="padding:32px"><strong style="font-size:20px;color:#175197">Connect|API Platform</strong><h1 style="font-size:24px;margin:24px 0 18px">Senha alterada</h1><p style="line-height:1.6">Olá, {safe_name}.</p><p style="line-height:1.6">Sua senha foi alterada com sucesso. As renovações de sessão anteriores foram revogadas.</p><p style="font-size:13px;line-height:1.6;color:#64748b">Uma sessão já aberta pode permanecer ativa até o token de acesso expirar, em no máximo {access_ttl} minutos. Caso não reconheça esta alteração, contate o administrador da plataforma imediatamente.</p></td></tr></table>
</td></tr></table></body></html>"""
        await self.send(
            self._message(
                recipient=email,
                subject="Senha alterada — Connect|API Platform",
                text=text,
                html=html,
            )
        )


async def send_password_reset_safely(*, name: str, email: str, token: str) -> None:
    try:
        await InternalMailService().send_password_reset(name=name, email=email, token=token)
    except Exception as exc:  # A resposta pública já foi emitida; não expor token/endereço no log.
        logger.error("password_reset_email_failed", error=type(exc).__name__)


async def send_password_changed_safely(*, name: str, email: str) -> None:
    try:
        await InternalMailService().send_password_changed(name=name, email=email)
    except Exception as exc:
        logger.error("password_changed_email_failed", error=type(exc).__name__)
