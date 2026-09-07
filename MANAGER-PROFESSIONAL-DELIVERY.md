# Connect|API — Manager Professional

## Objetivo

A Connect|API Manager é a administração local do Connect|API instalado na infraestrutura do cliente. Ela não é um produto separado acima do Connect|API e não administra ambientes de outros clientes.

```text
Usuário
   |
   v
Connect|API Manager Web
   |
   v
Connect|API Manager API / BFF
   |
   +---- Connect|API Engine
   +---- Chamadas / VoIP
   +---- Studio / integrações
   +---- Saúde e observabilidade local
   +---- Licenciamento (serviço externo configurável)
   +---- Telemetria técnica (serviço externo configurável)
   +---- Releases / atualização (serviço externo configurável)
```

## O que foi preservado

O Engine permanece Node.js + TypeScript, incluindo os providers e integrações existentes. A nova Manager foi construída ao redor dos contratos atuais para evitar uma migração desnecessária do motor de comunicação.

## Manager Web

A implementação preserva a tecnologia leve já embarcada no `develop`:

- JavaScript moderno;
- ES Modules nativos;
- HTML;
- CSS responsivo;
- PWA;
- light mode padrão;
- dark mode opcional;
- build determinístico sem download de dependências.

A imagem final contém somente `dist/`; o diretório de fonte da Manager não é copiado para o Nginx final.

### Navegação

```text
Visão Geral

Comunicação
├── Instâncias
├── Canais
└── Conversas

Voz
└── PBX / VoIP

Studio
├── Studio
└── Integrações

Administração
├── Segurança da conta
├── Usuários
└── Auditoria

Sistema
├── Saúde
├── Licença
└── Atualizações
```

A interface não usa `Tenant`, `Partner`, `Control Plane` ou `Platform` como linguagem operacional.

## Manager API / BFF

O BFF fica em `manager/api` e impede que o navegador precise conhecer a Global API Key ou o endereço interno do Engine.

```text
Browser
  | sessão HttpOnly + CSRF
  v
Manager API
  | credencial interna
  v
Engine
```

### Administração

- primeiro acesso por bootstrap seguro ou token de setup;
- login por e-mail/senha;
- 2FA TOTP com códigos de recuperação;
- exigência opcional/por padrão em produção para administradores;
- usuários locais;
- perfis e permissões;
- sessões revogáveis;
- auditoria.

### Engine

O BFF cobre:

- dashboard;
- listagem/criação/remoção de instâncias;
- restart/logout;
- QR Code e código de pareamento;
- chats;
- mensagens;
- chamadas compatíveis;
- configurações;
- integrações existentes.

## Perfis de acesso iniciais

```text
administrator
supervisor
operator
pbx_operator
studio_author
viewer
```

As permissões são verificadas no Manager API, não apenas ocultadas no frontend.

## Persistência administrativa

A Manager possui armazenamento local próprio em volume:

```text
/data/manager-data.json
```

A gravação é atômica. Esse armazenamento é dedicado a usuários, sessões lógicas e auditoria da Manager e não substitui o banco operacional do Engine.

## Instalação por Compose

A distribuição inclui três componentes de aplicação:

```text
api          -> Connect|API Engine
manager-api  -> API administrativa / BFF
manager      -> interface web
```

Exemplo de variáveis essenciais:

```env
AUTHENTICATION_API_KEY=GERAR_CHAVE_INTERNA_FORTE

MANAGER_SESSION_SECRET=GERAR_SEGREDO_ALEATORIO_COM_32_OU_MAIS_CARACTERES
MANAGER_MFA_ENCRYPTION_KEY=
MANAGER_2FA_REQUIRED_FOR_ADMIN=true
MANAGER_MFA_CHALLENGE_TTL_SECONDS=300
MANAGER_COOKIE_SECURE=true

MANAGER_BOOTSTRAP_NAME=Administrador
MANAGER_BOOTSTRAP_EMAIL=admin@empresa.com.br
MANAGER_BOOTSTRAP_PASSWORD=DEFINIR_SENHA_INICIAL_FORTE

MANAGER_INSTALLATION_ID=UUID_DA_INSTALACAO
```

Em produção, o bootstrap por senha deve ser usado apenas para criar o primeiro administrador; depois a senha inicial deve ser removida do `.env`/secret store.

## Licença, telemetria e releases

Os três pontos externos são opcionais e configuráveis:

```env
MANAGER_LICENSE_URL=
MANAGER_TELEMETRY_URL=
MANAGER_RELEASE_URL=
MANAGER_RELEASE_CHANNEL=stable
```

### Licença

O adapter consulta o endpoint configurado enviando o identificador técnico da instalação. A implementação do servidor de licenças não faz parte do ZIP original e deve ser integrada ao serviço oficial quando seu contrato estiver definido.

### Telemetria

O heartbeat da Manager envia somente dados técnicos agregados:

- `installationId`;
- timestamp;
- saúde/uptime do Engine;
- total de instâncias;
- total conectado/desconectado.

A Manager não envia conteúdo de mensagens, contatos, telefones, áudios, gravações, credenciais ou payloads operacionais.

### Releases

O adapter de updates consulta o serviço configurado. O fluxo completo de download assinado/rollback depende do contrato do serviço de releases e não foi inventado nesta entrega.

## Endereçamento recomendado

O cliente pode publicar o Manager em seu domínio, enquanto Engine e Manager API ficam atrás do proxy/rede interna.

```text
https://connect.cliente.com/          -> Manager Web
https://connect.cliente.com/manager/  -> Manager Web
/manager-api/*                        -> Manager API
```

O Engine pode continuar em endpoint próprio quando necessário para integrações externas.

## Deploys atualizados

Foram integrados Manager Web + Manager API aos arquivos:

- `docker-compose.yaml`;
- `deploy/develop/compose.yaml`;
- `deploy/production/compose.yaml`;
- `deploy/canonical/compose.yaml`;
- `deploy/homologation/compose.yaml`;
- `deploy/dockge/compose.yaml`;
- `deploy/cloudpanel/docker-compose.yml`.

## CI/CD

A automação passa a reconhecer e publicar também:

```text
argws-connect-manager-api
```

junto das imagens existentes do Engine e da Manager.

## Build e validação

```bash
cd manager
npm test

cd api
npm test
```

Consulte `manager/VALIDATION.md` para a matriz de validação executada nesta entrega.

## Decisão arquitetural

```text
Manager != Engine
```

A Manager administra e agrega. O Engine continua sendo o motor de comunicação.

```text
Manager Web
    |
Manager API
    |
    +---- Engine (Node.js/TypeScript)
    |       +---- Baileys
    |       +---- Zapo
    |       +---- Meta
    |       +---- demais providers
    |
    +---- Voz
    +---- Studio
    +---- Sistema
```

Essa separação permite evoluir a interface, usuários, segurança, PBX, Studio, licença e atualizações sem reescrever o Engine existente.


## Compatibilidade de autenticação por token

A segurança da Manager foi adicionada sem alterar o modelo de autenticação do Engine. Permanecem válidos:

```text
AUTHENTICATION_API_KEY  -> chave global do Engine
instance.token          -> token individual da instância
Manager session         -> autenticação humana separada
```

O 2FA não é aplicado às chamadas diretas de API autenticadas por `apikey`; ele protege somente contas humanas da Manager. Isso preserva automações, webhooks, SDKs e integrações que já utilizam o contrato de token.
