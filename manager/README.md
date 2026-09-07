# Connect|API Manager

Interface administrativa profissional do Connect|API. A Manager administra somente o ambiente local em que foi instalada e não representa uma camada SaaS central.

## Tecnologia

O frontend preserva a tecnologia já embarcada no `develop`: JavaScript moderno com ES Modules, HTML/CSS e build determinístico sem dependências de runtime. O backend administrativo fica em `manager/api` e usa Node.js.

```text
Browser
  -> Manager Web
  -> Manager API (BFF)
  -> Connect|API Engine
```

A Global API Key e a URL interna do Engine não são solicitadas nem persistidas no navegador. O BFF lê essas credenciais por variáveis de ambiente.

## Recursos

- Visão Geral e saúde do Engine;
- instâncias, QR Code e código de pareamento;
- canais e conversas;
- mensagens de texto;
- chamadas/VoIP para providers compatíveis;
- Studio com bots e automações existentes no Engine;
- Webhook, WebSocket, RabbitMQ, SQS, Proxy e Chatwoot;
- usuários, perfis de acesso e permissões;
- 2FA TOTP compatível com Google/Microsoft Authenticator, códigos de recuperação e reset administrativo;
- sessão administrativa com cookie HttpOnly, CSRF, rate limiting e bloqueio temporário por tentativas;
- auditoria local;
- licença, telemetria técnica e releases;
- light mode padrão e dark mode opcional;
- responsividade desktop/tablet/mobile.

## Build

```bash
cd manager
npm test
```

Não há download de dependências para construir o frontend.

## Manager API

```bash
cd manager/api
npm test
```

Variáveis obrigatórias em produção:

```env
MANAGER_ENGINE_URL=http://api:8080
MANAGER_ENGINE_API_KEY=<GLOBAL_API_KEY_INTERNA>
MANAGER_SESSION_SECRET=<segredo-aleatorio-com-32+-caracteres>
MANAGER_MFA_ENCRYPTION_KEY=<opcional; se vazio usa MANAGER_SESSION_SECRET>
MANAGER_2FA_REQUIRED_FOR_ADMIN=true
MANAGER_MFA_CHALLENGE_TTL_SECONDS=300
MANAGER_BOOTSTRAP_EMAIL=admin@empresa.com.br
MANAGER_BOOTSTRAP_PASSWORD=<senha-inicial-segura>
```

O instalador deve gerar o segredo e solicitar a credencial inicial do administrador.


## Autenticação humana x autenticação da API

O 2FA protege somente o login humano na Manager. Ele **não substitui nem desativa** a autenticação do Engine por `apikey`.

Continuam suportados simultaneamente:

- `AUTHENTICATION_API_KEY`: chave global capaz de administrar as rotas/instâncias protegidas do Engine conforme o guard existente;
- token individual da instância: continua válido nas rotas escopadas pela instância;
- sessão da Manager: cookie HttpOnly + CSRF + 2FA, utilizada apenas pela interface administrativa.

A Manager API recebe a Global API Key por `MANAGER_ENGINE_API_KEY=${AUTHENTICATION_API_KEY}` e nunca precisa expô-la ao navegador.

## Preservação funcional durante a migração

A nova Manager não remove módulos funcionais do frontend anterior antes de existir paridade comprovada. Os arquivos legados ainda necessários como referência foram restaurados em `manager/src`, permanecem fora do grafo ativo de `main.js` e são excluídos do `dist` de produção. Consulte `LEGACY-MIGRATION.md`.
