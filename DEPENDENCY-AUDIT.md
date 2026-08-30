# ARGWS Connect API — Auditoria de Dependências

## Resultado executivo

- Dependências de runtime: **60** (mesma quantidade da base original).
- Dependências de desenvolvimento: **27** (mesma quantidade da base original).
- Removidas nesta revisão: **0**.
- Adicionadas nesta revisão: **0**.
- Versões declaradas alteradas nesta revisão: **0**.

A atualização de identidade e nomenclatura foi deliberadamente separada da modernização de dependências para reduzir risco de regressão.

## Decisões sugeridas

### CANDIDATO A REMOÇÃO

- `@sentry/node` — Sentry foi removido do runtime; manter somente nesta revisão para preservar o conjunto de dependências.

### REVISAR PARA REMOÇÃO

- `@adiwajshing/keyed-db` — Nenhum import direto encontrado no código atual. Pode ser resíduo histórico; confirmar integração WhatsApp/Baileys em testes.
- `@types/uuid` — Está em dependencies, não possui uso direto e uuid atual já publica tipos. Validar TypeScript antes de retirar.
- `audio-decode` — Nenhum import direto encontrado no código atual.
- `link-preview-js` — Nenhum import direto encontrado no código atual.
- `mime` — Nenhum import direto encontrado; o código ativo usa mime-types.
- `swagger-ui-express` — Nenhum import direto encontrado; a documentação atual não instancia Swagger UI.
- `tsconfig-paths` — Nenhum carregamento explícito encontrado nos scripts atuais; tsx/tsup já tratam paths. Confirmar build antes de remover.

### MIGRAR PARA devDependencies

- `tsup` — Usado no build (tsup.config.ts / npm run build), não como dependência de runtime da API.

### REVISAR JUNTO COM mime

- `@types/mime` — Só faz sentido enquanto o pacote mime/tipos forem necessários; o runtime ativo usa mime-types.

## Matriz completa

| Tipo | Dependência | Declarada | Resolvida no lock | Decisão | Evidência |
|---|---|---:|---:|---|---|
| dependencies | `@adiwajshing/keyed-db` | `^0.2.4` | `0.2.4` | **REVISAR PARA REMOÇÃO** | Nenhum import direto encontrado no código atual. Pode ser resíduo histórico; confirmar integração WhatsApp/Baileys em testes. |
| dependencies | `@aws-sdk/client-sqs` | `^3.891.0` | `3.936.0` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/event/sqs/sqs.controller.ts` |
| dependencies | `@ffmpeg-installer/ffmpeg` | `^1.1.0` | `1.1.0` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` |
| dependencies | `@figuro/chatwoot-sdk` | `^1.1.16` | `1.1.17` | **MANTER** | Importado diretamente em 2 arquivo(s) ativo(s). Arquivos: `src/api/integrations/chatbot/chatwoot/services/chatwoot.service.ts, src/api/integrations/chatbot/chatwoot/utils/chatwoot-import-helper.ts` |
| dependencies | `@hapi/boom` | `^10.0.1` | `10.0.1` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` |
| dependencies | `@paralleldrive/cuid2` | `^2.2.2` | `2.3.1` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` |
| dependencies | `@prisma/client` | `^6.16.2` | `6.19.0` | **MANTER** | Importado diretamente em 30 arquivo(s) ativo(s). Arquivos: `src/api/controllers/chat.controller.ts, src/api/dto/instance.dto.ts, src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` (+27) |
| dependencies | `@sentry/node` | `^10.12.0` | `10.26.0` | **CANDIDATO A REMOÇÃO** | Sentry foi removido do runtime; manter somente nesta revisão para preservar o conjunto de dependências. |
| dependencies | `@types/uuid` | `^10.0.0` | `10.0.0` | **REVISAR PARA REMOÇÃO** | Está em dependencies, não possui uso direto e uuid atual já publica tipos. Validar TypeScript antes de retirar. |
| dependencies | `amqplib` | `^0.10.5` | `0.10.9` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/event/rabbitmq/rabbitmq.controller.ts` |
| dependencies | `audio-decode` | `^2.2.3` | `2.2.3` | **REVISAR PARA REMOÇÃO** | Nenhum import direto encontrado no código atual. |
| dependencies | `axios` | `^1.7.9` | `1.13.2` | **MANTER** | Importado diretamente em 20 arquivo(s) ativo(s). Arquivos: `src/api/controllers/proxy.controller.ts, src/api/integrations/channel/connect/connect.channel.service.ts, src/api/integrations/channel/meta/meta.controller.ts` (+17) |
| dependencies | `baileys` | `7.0.0-rc.9` | `7.0.0-rc.9` | **MANTER** | Importado diretamente em 21 arquivo(s) ativo(s). Arquivos: `src/api/controllers/instance.controller.ts, src/api/dto/chat.dto.ts, src/api/dto/instance.dto.ts` (+18) |
| dependencies | `class-validator` | `^0.14.1` | `0.14.3` | **MANTER** | Importado diretamente em 14 arquivo(s) ativo(s). Arquivos: `src/api/controllers/instance.controller.ts, src/api/controllers/sendMessage.controller.ts, src/api/integrations/channel/connect/connect.channel.service.ts` (+11) |
| dependencies | `compression` | `^1.7.5` | `1.8.1` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/main.ts` |
| dependencies | `cors` | `^2.8.5` | `2.8.5` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/main.ts` |
| dependencies | `dayjs` | `^1.11.13` | `1.11.19` | **MANTER** | Importado diretamente em 3 arquivo(s) ativo(s). Arquivos: `src/api/integrations/chatbot/chatwoot/services/chatwoot.service.ts, src/config/logger.config.ts, src/utils/onWhatsappCache.ts` |
| dependencies | `dotenv` | `^16.4.7` | `16.6.1` | **MANTER** | Importado diretamente em 2 arquivo(s) ativo(s). Arquivos: `runWithProvider.js, src/config/env.config.ts` |
| dependencies | `emoji-regex` | `^10.4.0` | `10.6.0` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/controllers/sendMessage.controller.ts` |
| dependencies | `eventemitter2` | `^6.4.9` | `6.4.9` | **MANTER** | Importado diretamente em 8 arquivo(s) ativo(s). Arquivos: `src/api/controllers/instance.controller.ts, src/api/integrations/channel/channel.controller.ts, src/api/integrations/channel/connect/connect.channel.service.ts` (+5) |
| dependencies | `express` | `^4.21.2` | `4.21.2` | **MANTER** | Importado diretamente em 41 arquivo(s) ativo(s). Arquivos: `src/api/abstract/abstract.router.ts, src/api/guards/auth.guard.ts, src/api/guards/instance.guard.ts` (+38) |
| dependencies | `express-async-errors` | `^3.1.1` | `3.1.1` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/abstract/abstract.router.ts` |
| dependencies | `fluent-ffmpeg` | `^2.1.3` | `2.1.3` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` |
| dependencies | `form-data` | `^4.0.1` | `4.0.5` | **MANTER** | Importado diretamente em 5 arquivo(s) ativo(s). Arquivos: `src/api/integrations/channel/connect/connect.channel.service.ts, src/api/integrations/channel/meta/whatsapp.business.service.ts, src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` (+2) |
| dependencies | `https-proxy-agent` | `^7.0.6` | `7.0.6` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/utils/makeProxyAgent.ts` |
| dependencies | `fetch-socks` | `^1.3.2` | `1.3.2` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/utils/makeProxyAgent.ts` |
| dependencies | `i18next` | `^23.7.19` | `23.16.8` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/utils/i18n.ts` |
| dependencies | `jimp` | `^1.6.0` | `1.6.0` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/chatbot/chatwoot/services/chatwoot.service.ts` |
| dependencies | `json-schema` | `^0.4.0` | `0.4.0` | **MANTER** | Importado diretamente em 25 arquivo(s) ativo(s). Arquivos: `src/api/abstract/abstract.router.ts, src/api/integrations/chatbot/chatwoot/validate/chatwoot.schema.ts, src/api/integrations/chatbot/connectAI/validate/connectAI.schema.ts` (+22) |
| dependencies | `jsonschema` | `^1.4.1` | `1.5.0` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/abstract/abstract.router.ts` |
| dependencies | `jsonwebtoken` | `^9.0.2` | `9.0.2` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/event/webhook/webhook.controller.ts` |
| dependencies | `kafkajs` | `^2.2.4` | `2.2.4` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/event/kafka/kafka.controller.ts` |
| dependencies | `libphonenumber-js` | `^1.12.25` | `1.12.29` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/chatbot/chatwoot/services/chatwoot.service.ts` |
| dependencies | `link-preview-js` | `^3.0.13` | `3.2.0` | **REVISAR PARA REMOÇÃO** | Nenhum import direto encontrado no código atual. |
| dependencies | `long` | `^5.2.3` | `5.3.2` | **MANTER** | Importado diretamente em 2 arquivo(s) ativo(s). Arquivos: `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts, src/api/integrations/chatbot/chatwoot/services/chatwoot.service.ts` |
| dependencies | `mediainfo.js` | `^0.3.4` | `0.3.6` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` |
| dependencies | `mime` | `^4.0.0` | `4.1.0` | **REVISAR PARA REMOÇÃO** | Nenhum import direto encontrado; o código ativo usa mime-types. |
| dependencies | `mime-types` | `^2.1.35` | `2.1.35` | **MANTER** | Importado diretamente em 5 arquivo(s) ativo(s). Arquivos: `src/api/integrations/channel/connect/connect.channel.service.ts, src/api/integrations/channel/meta/whatsapp.business.service.ts, src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` (+2) |
| dependencies | `minio` | `^8.0.3` | `8.0.6` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/storage/s3/libs/minio.server.ts` |
| dependencies | `multer` | `^2.0.2` | `2.0.2` | **MANTER** | Importado diretamente em 2 arquivo(s) ativo(s). Arquivos: `src/@types/express.d.ts, src/api/routes/sendMessage.router.ts` |
| dependencies | `nats` | `^2.29.1` | `2.29.3` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/event/nats/nats.controller.ts` |
| dependencies | `node-cache` | `^5.1.2` | `5.1.2` | **MANTER** | Importado diretamente em 2 arquivo(s) ativo(s). Arquivos: `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts, src/cache/localcache.ts` |
| dependencies | `node-cron` | `^3.0.3` | `3.0.3` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` |
| dependencies | `openai` | `^4.77.3` | `4.104.0` | **MANTER** | Importado diretamente em 2 arquivo(s) ativo(s). Arquivos: `src/api/integrations/chatbot/openai/controllers/openai.controller.ts, src/api/integrations/chatbot/openai/services/openai.service.ts` |
| dependencies | `pg` | `^8.13.1` | `8.16.3` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/chatbot/chatwoot/libs/postgres.client.ts` |
| dependencies | `pino` | `^9.10.0` | `9.14.0` | **MANTER** | Importado diretamente em 2 arquivo(s) ativo(s). Arquivos: `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts, src/api/integrations/chatbot/openai/services/openai.service.ts` |
| dependencies | `prisma` | `^6.1.0` | `6.19.0` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |
| dependencies | `pusher` | `^5.2.0` | `5.2.0` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/event/pusher/pusher.controller.ts` |
| dependencies | `qrcode` | `^1.5.4` | `1.5.4` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` |
| dependencies | `qrcode-terminal` | `^0.12.0` | `0.12.0` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` |
| dependencies | `redis` | `^4.7.0` | `4.7.1` | **MANTER** | Importado diretamente em 2 arquivo(s) ativo(s). Arquivos: `src/cache/rediscache.client.ts, src/cache/rediscache.ts` |
| dependencies | `rxjs` | `^7.8.2` | `7.8.2` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/channel/whatsapp/baileysMessage.processor.ts` |
| dependencies | `sharp` | `^0.34.2` | `0.34.5` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` |
| dependencies | `socket.io` | `^4.8.1` | `4.8.1` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/event/websocket/websocket.controller.ts` |
| dependencies | `socket.io-client` | `^4.8.1` | `4.8.1` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/api/integrations/channel/whatsapp/voiceCalls/useVoiceCallsBaileys.ts` |
| dependencies | `socks-proxy-agent` | `^8.0.5` | `8.0.5` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/utils/makeProxyAgent.ts` |
| dependencies | `swagger-ui-express` | `^5.0.1` | `5.0.1` | **REVISAR PARA REMOÇÃO** | Nenhum import direto encontrado; a documentação atual não instancia Swagger UI. |
| dependencies | `tsup` | `^8.3.5` | `8.5.1` | **MIGRAR PARA devDependencies** | Usado no build (tsup.config.ts / npm run build), não como dependência de runtime da API. Arquivos: `tsup.config.ts` |
| dependencies | `undici` | `^7.16.0` | `7.16.0` | **MANTER** | Importado diretamente em 1 arquivo(s) ativo(s). Arquivos: `src/utils/makeProxyAgent.ts` |
| dependencies | `uuid` | `^13.0.0` | `13.0.0` | **MANTER** | Importado diretamente em 28 arquivo(s) ativo(s). Arquivos: `src/api/controllers/instance.controller.ts, src/api/integrations/channel/connect/connect.channel.service.ts, src/api/integrations/channel/whatsapp/whatsapp.baileys.service.ts` (+25) |
| devDependencies | `@commitlint/cli` | `^19.8.1` | `19.8.1` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |
| devDependencies | `@commitlint/config-conventional` | `^19.8.1` | `19.8.1` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |
| devDependencies | `@types/compression` | `^1.7.5` | `1.8.1` | **MANTER** | Pacote de tipos TypeScript; import direto não é esperado. |
| devDependencies | `@types/cors` | `^2.8.17` | `2.8.19` | **MANTER** | Pacote de tipos TypeScript; import direto não é esperado. |
| devDependencies | `@types/express` | `^4.17.18` | `4.17.25` | **MANTER** | Pacote de tipos TypeScript; import direto não é esperado. |
| devDependencies | `@types/json-schema` | `^7.0.15` | `7.0.15` | **MANTER** | Pacote de tipos TypeScript; import direto não é esperado. |
| devDependencies | `@types/mime` | `^4.0.0` | `4.0.0` | **REVISAR JUNTO COM mime** | Só faz sentido enquanto o pacote mime/tipos forem necessários; o runtime ativo usa mime-types. |
| devDependencies | `@types/mime-types` | `^2.1.4` | `2.1.4` | **MANTER** | Pacote de tipos TypeScript; import direto não é esperado. |
| devDependencies | `@types/node` | `^24.5.2` | `24.10.1` | **MANTER** | Pacote de tipos TypeScript; import direto não é esperado. |
| devDependencies | `@types/node-cron` | `^3.0.11` | `3.0.11` | **MANTER** | Pacote de tipos TypeScript; import direto não é esperado. |
| devDependencies | `@types/qrcode` | `^1.5.5` | `1.5.6` | **MANTER** | Pacote de tipos TypeScript; import direto não é esperado. |
| devDependencies | `@types/qrcode-terminal` | `^0.12.2` | `0.12.2` | **MANTER** | Pacote de tipos TypeScript; import direto não é esperado. |
| devDependencies | `@typescript-eslint/eslint-plugin` | `^8.44.0` | `8.47.0` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |
| devDependencies | `@typescript-eslint/parser` | `^8.44.0` | `8.47.0` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |
| devDependencies | `commitizen` | `^4.3.1` | `4.3.1` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |
| devDependencies | `cz-conventional-changelog` | `^3.3.0` | `3.3.0` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |
| devDependencies | `eslint` | `^8.45.0` | `8.57.1` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |
| devDependencies | `eslint-config-prettier` | `^10.1.8` | `10.1.8` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |
| devDependencies | `eslint-plugin-import` | `^2.31.0` | `2.32.0` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |
| devDependencies | `eslint-plugin-prettier` | `^5.2.1` | `5.5.4` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |
| devDependencies | `eslint-plugin-simple-import-sort` | `^12.1.1` | `12.1.1` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |
| devDependencies | `husky` | `^9.1.7` | `9.1.7` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |
| devDependencies | `lint-staged` | `^16.1.6` | `16.2.7` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |
| devDependencies | `prettier` | `^3.4.2` | `3.6.2` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |
| devDependencies | `tsconfig-paths` | `^4.2.0` | `4.2.0` | **REVISAR PARA REMOÇÃO** | Nenhum carregamento explícito encontrado nos scripts atuais; tsx/tsup já tratam paths. Confirmar build antes de remover. |
| devDependencies | `tsx` | `^4.20.5` | `4.20.6` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |
| devDependencies | `typescript` | `^5.7.2` | `5.9.3` | **MANTER** | Ferramenta de build, qualidade ou fluxo de desenvolvimento. |

## Regras para a próxima etapa

1. Não remover nenhum candidato apenas por análise estática.
2. Primeiro obter `npm ci`, `prisma generate`, `tsc --noEmit`, build e testes de integração bem-sucedidos.
3. Remover/migrar dependências em lotes pequenos e independentes da identidade visual.
4. Manter Prometheus local; ele não representa a telemetria externa removida.
5. `@sentry/node` é o primeiro candidato lógico, pois o runtime Sentry já não é inicializado nesta revisão.
