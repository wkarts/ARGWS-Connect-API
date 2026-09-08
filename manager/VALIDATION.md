# Validação da reconstrução do Connect|API Manager

## Fonte analisada

A reconstrução foi baseada no bundle recuperado existente em `manager/recovered/legacy` e nos contratos do backend presentes em `src/api`.

`manager/src` é o fonte operacional. `manager/recovered` permanece somente como trilha de auditoria e comparação.

## Validações executadas

A partir de `manager/`:

```bash
npm test
```

Resultado esperado e validado nesta entrega:

```text
OK: 17 módulos JS validados.
Manager build generated at manager/dist
SMOKE OK: 100 API contract calls validated.
RUNTIME SMOKE OK: docs URL and pt-BR-first locale policy validated.
```

A partir da raiz:

```bash
npm run manager:test
```

O check/build/smoke do Manager também passou pela integração dos scripts do projeto principal.

Também foram validados:

- `nginx -t` carregando `manager/nginx.conf` dentro de um contexto HTTP válido;
- servidor local do build: `/manager/login`, `/assets/app/main.js` e `/assets/runtime-config.js` retornando HTTP 200;
- runtime config standalone: `pt-BR` obrigatório quando idiomas extras estão desligados;
- runtime config standalone: idiomas extras somente com `MANAGER_ENABLE_EXTRA_LOCALES=true`;
- locale desconhecido é descartado;
- `ARGWS_CONNECT_DOCS_PUBLIC_URL` e `MANAGER_DOCUMENTATION_URL` alimentam o link condicional de documentação;
- ausência de referências ao bundle legado no novo `dist` operacional;
- ausência, no código operacional, de Postman, Discord, GitHub público e Suporte Premium;
- sintaxe YAML dos Compose estáveis alterados;
- `deploy/develop` idêntico ao diretório correspondente do ZIP fornecido;
- `npm run docs:check` sincronizado;
- sintaxe TypeScript dos pontos de integração do Manager no backend (`index.router.ts` e `view.router.ts`).

## Paridade funcional reconstruída

- login por URL da API + API key;
- sessão local e logout;
- lista, criação e exclusão de instâncias;
- dashboard da instância;
- QR Code e código de pareamento;
- restart e logout da instância;
- chat, atualização periódica e envio de texto/mídia;
- rota de chat embutido baseada na última instância selecionada;
- comportamento, proxy, webhook, websocket, RabbitMQ, SQS e Chatwoot;
- Typebot, OpenAI, Dify, n8n, ConnectAI, ConnectBot e Flowise;
- credenciais OpenAI;
- configurações globais e sessões dos bots;
- alteração de status de sessões e lista de JIDs ignorados;
- tema claro/dark;
- documentação condicional por runtime/API;
- pt-BR como idioma operacional padrão e único por padrão;
- build standalone Nginx e Manager embutido na API.

## Itens removidos do runtime reconstruído

- landing legado em `/`;
- Postman;
- Discord;
- GitHub público;
- Suporte Premium;
- dependência do bundle `index-*.js` legado.

## Build reproduzível

O Dockerfile do Manager compila o `dist` a partir do `src` em estágio separado. O Dockerfile principal também executa check/build/smoke do Manager antes do build da API, evitando publicar um `dist` legado por engano.

## Limite deste ambiente

A compilação completa da API (`npm run build` na raiz) não pôde ser certificada neste runtime porque o cache local `node_modules` estava incompleto e a reinstalação das dependências não concluiu dentro da janela disponível. Esse cache não faz parte do ZIP entregue. O código do Manager em si não depende desse cache e passou integralmente pelos testes acima.
