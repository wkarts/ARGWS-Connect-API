# Connect|API Manager — Segurança e 2FA

## Escopo

Esta implementação protege o acesso **humano** à Connect|API Manager sem alterar o contrato de autenticação por token do Connect|API Engine.

## Autenticação preservada no Engine

Permanecem suportados:

- `AUTHENTICATION_API_KEY`: chave global do Engine;
- token individual de cada instância;
- header HTTP `apikey` para chamadas diretas ao Engine;
- WebSocket e integrações que já usam `apikey` conforme os contratos existentes.

O 2FA **não é aplicado às chamadas diretas da API autenticadas por token**. Ele protege somente as contas humanas da Manager.

```text
Integração externa/SDK
        |
        | apikey global OU token da instância
        v
Connect|API Engine

Usuário humano
        |
        | e-mail + senha + 2FA
        v
Connect|API Manager API
        |
        | Global API Key interna
        v
Connect|API Engine
```

## 2FA

Implementado TOTP padrão RFC 6238 compatível com:

- Google Authenticator;
- Microsoft Authenticator;
- 1Password;
- Authy e demais aplicativos compatíveis com `otpauth://`.

Características:

- segredo TOTP de 160 bits;
- SHA-1, 6 dígitos, janela de 30 segundos;
- tolerância de ±1 janela para relógio;
- proteção contra replay do mesmo contador TOTP;
- segredo criptografado em repouso com AES-256-GCM;
- 10 códigos de recuperação de uso único;
- códigos de recuperação armazenados somente como HMAC;
- regeneração dos códigos invalida todos os anteriores;
- reset administrativo do 2FA de outro usuário;
- administradores exigem 2FA em produção por padrão.

## Sessões e login

- cookie `HttpOnly`;
- `SameSite=Strict`;
- `Secure` habilitado por padrão;
- CSRF obrigatório em operações mutáveis;
- sessão assinada com HMAC-SHA256;
- revogação via `sessionVersion`;
- desafio 2FA separado e curto;
- rate limiting por IP/e-mail/usuário;
- bloqueio temporário progressivo após falhas repetidas;
- auditoria de login, falha, 2FA e alterações de segurança.

## Senhas

Novas senhas exigem:

- mínimo de 12 caracteres;
- máximo de 128 caracteres;
- bloqueio de algumas senhas previsíveis;
- armazenamento com `scrypt` + salt individual.

Alterar a senha revoga as sessões existentes.

## Whitelist de instâncias

A Manager não devolve diretamente o objeto completo retornado por `fetchInstances` ao navegador. A listagem/detalhe usa whitelist de campos de apresentação para impedir vazamento acidental de:

- tokens;
- configurações internas;
- credenciais de providers;
- configurações de mensageria;
- estruturas privadas que o Engine possa acrescentar futuramente.

Isso **não remove os tokens do Engine**. Apenas evita exposição automática no frontend da Manager.

## Variáveis

```env
# Global API Key existente do Connect|API Engine
AUTHENTICATION_API_KEY=GERAR_CHAVE_GLOBAL_FORTE

# Manager
MANAGER_SESSION_SECRET=GERAR_SEGREDO_ALEATORIO_COM_32_OU_MAIS_CARACTERES
MANAGER_COOKIE_SECURE=true

# Recomenda-se usar uma chave separada para permitir rotação independente do segredo de sessão.
MANAGER_MFA_ENCRYPTION_KEY=GERAR_OUTRO_SEGREDO_ALEATORIO_COM_32_OU_MAIS_CARACTERES

# Em produção: true recomendado/definido nos Compose desta entrega.
MANAGER_2FA_REQUIRED_FOR_ADMIN=true
MANAGER_MFA_CHALLENGE_TTL_SECONDS=300
```

Se `MANAGER_MFA_ENCRYPTION_KEY` ficar vazia, o backend usa `MANAGER_SESSION_SECRET` como chave de proteção dos segredos TOTP. Em produção, prefira uma chave exclusiva e persistente.

## Validação

```bash
cd manager
npm test

cd api
npm test
```

O teste da API cobre:

- bootstrap;
- login por senha;
- bloqueio da administração até configurar 2FA quando obrigatório;
- ativação TOTP;
- códigos de recuperação;
- login em duas etapas;
- RBAC;
- compatibilidade da Global API Key e token por instância.
