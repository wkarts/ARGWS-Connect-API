# Connect|API Manager — Arquitetura

A Manager é a interface administrativa do Connect|API instalado no ambiente do cliente.

```text
Connect|API Manager Web
        |
        v
Connect|API Manager API / BFF
        |
        +---- Engine Node.js/TypeScript
        +---- Calls / VoIP
        +---- Studio / Integrations
        +---- License Service (externo, opcional/configurado)
        +---- Telemetry Service (externo, somente dados técnicos)
        +---- Release Service (externo)
```

## Limites

- O Engine continua Node.js/TypeScript e mantém Baileys/Zapo/Meta e demais integrações.
- A Manager não administra ambientes de outros clientes.
- Dados operacionais permanecem na infraestrutura local.
- Somente licença, telemetria técnica e metadados de releases podem utilizar serviços externos configurados.
- Credenciais do Engine existem apenas no BFF.
- Termos internos de arquitetura não são expostos como linguagem de produto no frontend.


## Segurança administrativa

```text
Usuário humano
  -> e-mail + senha
  -> 2FA TOTP quando habilitado/obrigatório
  -> sessão HttpOnly + CSRF
  -> Manager API

Integração/API
  -> apikey global OU token de instância
  -> Engine
```

O 2FA é uma proteção da Manager e não altera o contrato de autenticação do Engine. A Global API Key (`AUTHENTICATION_API_KEY`) e os tokens por instância permanecem válidos para integrações externas.

Segredos TOTP são criptografados em repouso com AES-256-GCM. Códigos de recuperação são armazenados somente como HMAC e consumidos uma única vez. Em produção, administradores exigem 2FA por padrão (`MANAGER_2FA_REQUIRED_FOR_ADMIN=true`).
