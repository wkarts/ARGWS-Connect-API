# Integração técnica da interface principal

Este arquivo é documentação interna do projeto e não faz parte da interface apresentada ao usuário.

## Arquitetura de compatibilidade

```text
Telas Vue
  -> contrato estável do frontend
  -> src/services/connect.ts
  -> src/services/current.ts
  -> API Connect|API
```

As telas não consomem diretamente estruturas brutas do backend. Mudanças futuras devem ser absorvidas prioritariamente na camada de serviços/normalização.

## Compatibilidade com a evolução ZAPO

A camada atual conhece:

- `WHATSAPP-BAILEYS`;
- `WHATSAPP-ZAPO`;
- `WHATSAPP-BUSINESS`;
- capabilities por provider;
- migração Baileys <-> ZAPO por `migrateProvider`;
- chamadas ZAPO e gateway de áudio `/voice/media`;
- integrações chatbot e eventos do backend atual.

## Módulos opcionais

Os módulos opcionais são habilitados globalmente nos `env.example` para que suas rotas e controladores possam ser usados pela interface. A ativação operacional continua por configuração de instância.

```env
TYPEBOT_ENABLED=true
CHATWOOT_ENABLED=true
OPENAI_ENABLED=true
DIFY_ENABLED=true
N8N_ENABLED=true
CONNECT_AI_ENABLED=true
FLOWISE_ENABLED=true
```

Em instalações já existentes, revise o `.env` real: atualizar somente o arquivo de exemplo não altera variáveis já persistidas.

## Chamadas de teste

A sinalização usa os endpoints `/call/*`. O áudio usa WebSocket binário em:

```text
/voice/media
```

O reverse proxy do domínio da API precisa permitir Upgrade/WebSocket nesse caminho.

A autenticação do gateway aceita o token da instância ou a chave administrativa global, usando comparação segura. Isso permite manter:

```env
AUTHENTICATION_EXPOSE_IN_FETCH_INSTANCES=false
```

sem impedir os testes de áudio no frontend.

## Build

O Dockerfile raiz continua compilando o frontend antes do build da API porque o backend serve `manager/dist` em `/manager/`.

O Dockerfile standalone da interface executa o mesmo `npm run test` do build embutido.
