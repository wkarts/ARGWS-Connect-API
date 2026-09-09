# Connect|API — ZAPO parity + frontend atual integrado

## Base funcional

Esta entrega parte do backend ZAPO/Baileys enviado pelo usuário e incorpora a interface principal atual.

## Backend preservado e alinhamentos adicionais

A implementação de paridade ZAPO, snapshot/migração de sessão e rotas existentes foi preservada.

Alterações adicionais fora da pasta do frontend são limitadas a:

1. `Dockerfile` — instala/valida o frontend antes de gerar o bundle servido em `/manager/`;
2. arquivos `env.example` — deixam os módulos opcionais disponíveis para configuração, mas sem criar/ativar integrações de instância;
3. `src/api/services/voice-media.service.ts` — permite ao gateway de áudio de teste autenticar com token da instância **ou** com a chave administrativa global já usada pelo frontend.

Não houve refatoração do Engine, Prisma, migrations ou contrato de sessão ZAPO/Baileys.

## Frontend integrado

- Vue 3 + TypeScript + Vite;
- providers Baileys, ZAPO e Business explícitos;
- QR Code e pareamento;
- migração Baileys <-> ZAPO com dry-run;
- capacidades do provider;
- conversas, mensagens, contatos;
- integrações n8n, Typebot, Dify, Flowise, OpenAI, ConnectAI e ConnectBot;
- Webhooks, WebSocket, RabbitMQ, NATS, SQS, Kafka, Pusher, Chatwoot e Proxy;
- chamadas WhatsApp ZAPO para validação, incluindo áudio bidirecional no navegador;
- identidade visual existente do projeto, sem criação de novos logos ou favicons.

## Estado padrão das integrações

Módulo disponível não significa integração ativa. Novas configurações são criadas com `enabled=false` por padrão e os cards sem configuração aparecem como **Desativado**.

## Observações de implantação

Para instalações já existentes, confirme no `.env` real:

```env
TYPEBOT_ENABLED=true
CHATWOOT_ENABLED=true
OPENAI_ENABLED=true
DIFY_ENABLED=true
N8N_ENABLED=true
CONNECT_AI_ENABLED=true
FLOWISE_ENABLED=true
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false
```

O domínio da API deve aceitar WebSocket em `/voice/media` para o áudio de teste.
