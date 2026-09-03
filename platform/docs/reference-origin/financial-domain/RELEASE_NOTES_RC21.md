# Release Notes — v1.0.0-rc.21

A rc.21 endurece a autenticação do Control Plane. Usuários humanos da administração da plataforma passam a usar a mesma tecnologia TOTP já adotada nos tenants, porém com política obrigatória e sem opção de desativação.

## Control Plane 2FA obrigatório

- TOTP compatível com Google Authenticator, Microsoft Authenticator, 1Password, Authy e equivalentes;
- segredo TOTP criptografado e armazenado fora do cadastro principal do usuário;
- QR Code e URI `otpauth://` gerados no primeiro acesso;
- primeiro login após a implantação entra imediatamente em modo `SETUP` quando ainda não há autenticador confirmado;
- logins seguintes entram em modo `VERIFY` e exigem o código atual do autenticador;
- senha nunca satisfaz o segundo fator;
- tokens de acesso e refresh do Control Plane carregam explicitamente `mfa_verified`;
- tokens emitidos apenas com senha permanecem restritos aos endpoints de MFA e logout;
- todas as rotas administrativas humanas ficam bloqueadas com HTTP 428 até a confirmação do segundo fator;
- refresh de uma sessão ainda não validada não eleva privilégio e continua produzindo token não verificado;
- sessões antigas armazenadas no navegador são redirecionadas para o fluxo de 2FA ao primeiro HTTP 428;
- chaves de API da plataforma continuam sendo autenticação máquina-a-máquina e seguem sua política própria de escopo/IP/expiração.

## Persistência

Nova tabela da plataforma:

`platform_user_mfa_states`

Campos principais:

- `user_id` único;
- `totp_secret_encrypted`;
- `totp_enabled`;
- `confirmed_at`;
- `last_verified_at`.

Migration: `0005_control_plane_mfa`.

## UX

A mesma página de autenticação em duas etapas é reutilizada para tenant e Control Plane. No domínio administrativo ela adapta textos, issuer e endpoints, deixando explícito que o 2FA administrativo é obrigatório.

## Versão

`1.0.0-rc.21`
