# Connect|API Manager — fonte reconstruído e operacional

A aplicação foi reconstruída a partir da recuperação do bundle legado. O código operacional está em `src/`; `recovered/` permanece como trilha de auditoria.

## Sem dependências de frontend

O Manager usa módulos ES nativos do navegador. O build não depende de React/Vite nem de downloads externos:

```bash
npm run check
npm run build
```

O build copia os módulos para `dist/assets/app/` e gera o `dist/index.html` de produção.

## Runtime por ambiente

A imagem Nginx gera `/assets/runtime-config.js` no startup:

```env
MANAGER_API_URL=
ARGWS_CONNECT_DOCS_PUBLIC_URL=https://docs.exemplo.com.br
MANAGER_DEFAULT_LOCALE=pt-BR
MANAGER_ENABLE_EXTRA_LOCALES=false
MANAGER_EXTRA_LOCALES=en-US,es-ES,fr-FR
```

- `pt-BR` é obrigatório e único por padrão.
- Outros idiomas só são expostos com `MANAGER_ENABLE_EXTRA_LOCALES=true`.
- Documentação só aparece quando `ARGWS_CONNECT_DOCS_PUBLIC_URL`/`MANAGER_DOCUMENTATION_URL` existir ou a API raiz retornar `documentation`.
- Postman, Discord, GitHub e Suporte Premium não fazem parte da navegação reconstruída.

## Módulos operacionais

- autenticação por URL + API key;
- listagem/criação/exclusão de instâncias;
- dashboard, QR Code/código de pareamento, restart/logout;
- chat com atualização periódica e envio de texto/mídia;
- comportamento, proxy, Webhook, WebSocket, RabbitMQ e SQS;
- Chatwoot;
- Typebot, OpenAI, Dify, n8n, ConnectAI, ConnectBot e Flowise;
- configurações avançadas em JSON;
- tema claro padrão e dark opcional;
- runtime config para documentação e idiomas.


## Validação e execução local

```bash
npm test
npm run dev
```

O `npm test` valida sintaxe, gera o `dist` e executa o smoke de contratos HTTP. O servidor local abre o Manager em `http://127.0.0.1:4173/manager/login`.

Para a imagem standalone, o script de entrypoint gera `assets/runtime-config.js` no startup, portanto as URLs e a política de idioma podem mudar sem recompilar a imagem.
