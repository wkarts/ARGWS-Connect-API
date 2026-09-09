# Estado da integração do frontend

## Base utilizada

A interface atual foi integrada sobre o pacote `ARGWS-Connect-API-develop-Zapo-Parity-Session-Migration.zip` enviado pelo usuário.

A implementação preserva a evolução do backend ZAPO/Baileys e adiciona a interface Vue atual sem reintroduzir o frontend legado.

## Providers

A criação e a administração de instâncias distinguem explicitamente:

- `WHATSAPP-BAILEYS` — Baileys;
- `WHATSAPP-ZAPO` — ZAPO;
- `WHATSAPP-BUSINESS` — WhatsApp Business / Cloud API.

A tela da instância também apresenta as capacidades do provider, incluindo mensagens, contatos, conversas, grupos, Status, presença, estado de conversa, PN/LID, mensagens interativas, mídia, perfil, perfil comercial, catálogo, privacidade, marcadores, confirmações e chamadas quando suportadas.

## Migração de provider

A interface usa o endpoint do backend:

```text
POST /instance/migrateProvider/{instanceName}
```

O fluxo executa primeiro `dryRun`, mostra o resultado da validação e somente depois oferece a confirmação da troca Baileys <-> ZAPO.

A migração continua sendo responsabilidade do backend: snapshot, preflight, tentativa de subida do provider de destino e rollback em caso de falha.

## Integrações

A nova interface recupera os recursos presentes no frontend anterior, usando os endpoints existentes do backend:

- n8n;
- Typebot;
- Dify;
- Flowise;
- OpenAI;
- ConnectAI;
- ConnectBot;
- Webhooks;
- WebSocket;
- RabbitMQ;
- NATS;
- SQS;
- Kafka;
- Pusher;
- Chatwoot;
- Proxy;
- comportamento da instância.

Integrações sem configuração aparecem como **Desativado**, mas continuam acessíveis para configuração. Novas configurações também nascem inativas por padrão; nada externo é acionado sem o usuário habilitar explicitamente.

Os exemplos de ambiente desta entrega deixam habilitados os módulos opcionais do backend (`TYPEBOT_ENABLED`, `CHATWOOT_ENABLED`, `OPENAI_ENABLED`, `DIFY_ENABLED`, `N8N_ENABLED`, `CONNECT_AI_ENABLED`, `FLOWISE_ENABLED`) para que a interface consiga configurá-los. Isso não cria contas nem ativa uma integração em uma instância.

## Chamadas WhatsApp — validação

A interface inclui uma área de chamadas exclusivamente para validação:

- efetuar chamada de teste;
- detectar chamadas recebidas;
- atender;
- recusar;
- silenciar/reativar o microfone;
- encerrar;
- áudio bidirecional pelo navegador quando o provider oferecer a capacidade.

Nesta entrega, chamadas/áudio são apresentadas para o provider ZAPO. Baileys continua sem chamada híbrida/fallback no frontend.

O gateway de mídia aceita a credencial da instância ou a chave administrativa já usada na sessão do frontend. Assim, o áudio de teste não depende de expor tokens individuais em `fetchInstances`.

## Segurança e identidade visual

- não foi criada marca, logo, favicon ou ícone de produto novo;
- foram reutilizados os assets existentes do projeto;
- a interface não exibe licenciamento, telemetria, tenant, partner, nomes de frameworks ou arquitetura interna;
- o termo `manager` continua restrito a caminhos/arquivos internos e não é usado como nome do produto na interface.
