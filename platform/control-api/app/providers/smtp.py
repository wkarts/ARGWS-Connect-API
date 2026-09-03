from __future__ import annotations

from dataclasses import dataclass
from email.message import EmailMessage
from pathlib import Path

import aiosmtplib


@dataclass(frozen=True, slots=True)
class SMTPConfig:
    host: str
    port: int
    username: str = ""
    password: str = ""
    security: str = "starttls"
    from_email: str = ""
    from_name: str = ""
    timeout: int = 30


class SMTPProvider:
    def __init__(self, config: SMTPConfig) -> None:
        self.config = config

    async def send(
        self,
        *,
        to: str,
        subject: str,
        html: str,
        text: str | None = None,
        attachments: list[Path] | None = None,
    ) -> str:
        message = EmailMessage()
        message["From"] = f"{self.config.from_name} <{self.config.from_email}>".strip()
        message["To"] = to
        message["Subject"] = subject
        message.set_content(text or "Esta mensagem possui conteúdo em HTML.")
        message.add_alternative(html, subtype="html")
        for path in attachments or []:
            payload = path.read_bytes()
            message.add_attachment(payload, maintype="application", subtype="octet-stream", filename=path.name)

        use_tls = self.config.security == "ssl"
        start_tls = self.config.security == "starttls"
        response = await aiosmtplib.send(
            message,
            hostname=self.config.host,
            port=self.config.port,
            username=self.config.username or None,
            password=self.config.password or None,
            use_tls=use_tls,
            start_tls=start_tls,
            timeout=self.config.timeout,
        )
        return str(response)
