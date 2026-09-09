# Connect|API — Implementação do provider Zapo

## Base analisada

Entrega construída sobre o pacote `1.0.21` enviado para esta revisão. O código existente já possuía Baileys, Meta, lifecycle de instâncias, EventManager, Prisma, PostgreSQL/Redis/RabbitMQ/MinIO e Manager.


## Linha canônica sem Platform

Esta revisão foi portada para o pacote correto enviado posteriormente pelo usuário. Ela **não contém nem reintroduz** o diretório/módulo `platform/` da linha descontinuada. O Zapo é integrado diretamente ao core da Connect|API e ao Manager existente.

## O que foi implementado

- novo provider nativo `WHATSAPP-ZAPO`;
- autenticação por QR Code e código de pareamento usando `@innovatorssoft/zapo-js`;
- estado de autenticação, Signal, sender keys, app-state e caches persistidos no PostgreSQL;
- mensagens de texto, localização, contato, mídia, áudio/PTT, PTV, sticker, reação e enquete;
- chamadas de voz WhatsApp diretamente por `@innovatorssoft/voip`;
- operações de chamada: originar, aceitar, rejeitar, encerrar, mutar e listar;
- eventos de chamada normalizados no `Events.CALL`;
- áudio recebido em PCM 16 kHz mono exposto apenas internamente para a futura ponte PBX;
- limpeza completa do estado Zapo quando uma instância é excluída.

## O que foi removido

- provider `CONNECT`;
- `ConnectStartupService`, controller/router correspondentes;
- bridge `useVoiceCallsBaileys`/`voiceCalls`;
- acesso a `devices.wavoip.com`;
- `wavoipToken` de DTOs, settings e schemas atuais;
- `socket.io-client`, que ficou sem uso após a remoção do bridge.

As migrations históricas que adicionavam `wavoipToken` foram preservadas para manter a cadeia de migrations íntegra. Uma nova migration remove a coluna no estado atual.

## Migração de instalações existentes

- `Instance.integration = CONNECT` é convertido para `WHATSAPP-ZAPO`;
- a conexão é marcada `close`, exigindo pareamento explícito com o Zapo;

## Runtime de voz

A imagem da API utiliza Node 22 sobre Debian Bookworm Slim. O motivo é `@roamhq/wrtc`, necessário para chamadas reais do plugin VoIP, que utiliza binários Linux glibc pré-compilados.

## Limites desta primeira entrega

- chamadas de vídeo não são expostas como funcionais: o plugin sinaliza vídeo, mas não implementa encoding de vídeo;
- botões, listas e templates ainda retornam erro explícito de recurso não exposto pelo adapter Zapo;
- o store persistente Zapo desta primeira entrega exige PostgreSQL;
- PBX/FreeSWITCH não fazem parte desta etapa. A API interna de PCM já deixa preparado o próximo passo.

## Validações executadas

- `npm run test:zapo`;
- `npm --prefix manager test` (check, build, 100 chamadas de smoke e runtime smoke);
- `npm run docs:check`;
- parse de todos os JSON;
- parse dos YAML de workflows/deploy;
- `bash -n` em todos os scripts shell após normalização LF;
- parse sintático de todos os arquivos TypeScript em `src/` e `test/`;
- `npm ci --offline --dry-run --ignore-scripts` para validar a consistência do lockfile;
- auditoria de resíduos `CONNECT`/WavoIP.

A instalação completa de dependências não foi executada neste ambiente porque o cache local de npm não contém todos os tarballs exigidos pelo lockfile. O `npm ci --offline --dry-run` confirmou a resolução do lock; o build oficial deve ocorrer no GitHub Actions/Docker com acesso ao registry.
