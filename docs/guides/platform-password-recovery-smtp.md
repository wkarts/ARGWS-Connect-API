# Recuperação de senha e SMTP interno da Platform

A recuperação de senha pertence ao **Connect|API Control Plane**. O Engine Node/TypeScript não é alterado por esse recurso.

## Fluxo

1. O usuário acessa **Esqueci minha senha** no login do Control Plane.
2. A API responde de forma neutra, sem confirmar se o endereço existe.
3. Para usuário ativo, a Platform cria um token aleatório de uso único.
4. Somente o SHA-256 do token é persistido em `platform_password_reset_tokens`.
5. O link expira conforme `PASSWORD_RESET_TOKEN_TTL_MINUTES`.
6. Ao definir a nova senha, todos os tokens de recuperação e refresh tokens do usuário são revogados.

A revogação é imediata para os refresh tokens persistidos. Como os access tokens atuais são JWTs stateless, um token de acesso já emitido pode permanecer válido até o TTL configurado em `ACCESS_TOKEN_MINUTES` — 30 minutos por padrão.

## Variáveis

```dotenv
SMTP_ENABLED=true
SMTP_HOST=smtp.example.com
SMTP_PORT=587
SMTP_USERNAME=usuario
SMTP_PASSWORD=senha-ou-app-password
SMTP_SECURITY=starttls
SMTP_FROM_EMAIL=nao-responda@connect.argws.com.br
SMTP_FROM_NAME=Connect|API Platform
SMTP_TIMEOUT_SECONDS=30
PASSWORD_RESET_URL=https://control.connect.argws.com.br/reset-password
PASSWORD_RESET_TOKEN_TTL_MINUTES=30
PASSWORD_RESET_REQUESTS_PER_ACCOUNT_HOUR=5
PASSWORD_RESET_REQUESTS_PER_IP_HOUR=30
PASSWORD_RESET_ATTEMPTS_PER_IP_HOUR=30
```

`SMTP_SECURITY` aceita `none`, `starttls` ou `ssl`. Em produção, `PASSWORD_RESET_URL` precisa usar HTTPS.

## Operação

Execute o script canônico do ambiente. Ele preserva o `.env` existente, adiciona somente as chaves novas que estiverem ausentes, baixa cada imagem individualmente e informa exatamente qual manifesto/tag falhou.

```bash
cd deploy/platform-develop
./update.sh
```

O mesmo contrato está disponível em `deploy/platform-production`.
