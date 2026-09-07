# Connect|API Manager — Validação da entrega profissional

## Escopo validado

Esta entrega reconstrói a camada administrativa sem alterar a tecnologia do Engine.

```text
Manager Web   -> JavaScript moderno / ES Modules / HTML / CSS
Manager API   -> Node.js
Engine        -> Node.js + TypeScript (preservado)
```

A Manager não depende de conceitos de administração central de clientes. Cada instalação administra apenas o ambiente local do Connect|API.

## Testes automatizados executados

### Manager Web

```bash
cd manager
npm test
```

Resultado desta entrega:

```text
OK: 21 módulos JS da Manager validados.
Manager deterministic ES-module build generated at dist/
Manager Web SMOKE OK
```

O check também impede que a interface operacional volte a expor termos e referências que não pertencem ao produto atual, incluindo `Tenant`, `Partner`, `Control Plane`, `Connect|API Platform`, GitHub público, Postman, Discord e Suporte Premium.

### Manager API / BFF

```bash
cd manager/api
npm test
```

Resultado desta entrega:

```text
TOKEN COMPAT OK: Global API Key + tokens de instância preservados
Manager API SMOKE OK: auth + mandatory 2FA + recovery + RBAC
```

O smoke cobre configuração inicial, autenticação por senha, exigência de 2FA para administrador, TOTP, códigos de recuperação, cookie de sessão, CSRF e criação de usuário com RBAC.

### Integração local Manager API -> Engine

Foi executado um Engine simulado localmente com instâncias Baileys, Zapo e Meta. Foram validados:

- login administrativo;
- sessão assinada;
- dashboard agregado;
- leitura das instâncias pelo BFF;
- remoção do token de cada instância antes da resposta ao navegador;
- estado `not_configured` para licença, telemetria e releases quando os respectivos serviços externos não estão configurados;
- bloqueio de envio de telemetria sem configuração externa.

Exemplo de dashboard retornado no teste:

```json
{
  "engine": {"status":"ok","version":"1.0.21","uptime":86400},
  "instances": {"total":3,"connected":2,"disconnected":1},
  "totals": {"contacts":5759,"chats":19421,"messages":108358}
}
```

## Segurança validada na nova Manager

- Global API Key não é solicitada no login;
- URL interna do Engine não é solicitada no login;
- Global API Key não é persistida no navegador;
- credencial do Engine fica no Manager API por variável de ambiente;
- sessão administrativa via cookie `HttpOnly`;
- cookie `Secure` configurável e habilitado por padrão;
- `SameSite=Strict`;
- CSRF obrigatório em alterações autenticadas;
- senha armazenada com `scrypt` e salt individual;
- senha nova com mínimo de 12 caracteres;
- TOTP compatível com autenticadores padrão;
- segredo TOTP criptografado em repouso com AES-256-GCM;
- códigos de recuperação de uso único, armazenados somente como HMAC;
- proteção contra replay do mesmo time-step TOTP;
- rate limiting e bloqueio temporário após falhas repetidas de senha/2FA;
- 2FA obrigatório para administradores em produção por padrão;
- segredo de sessão mínimo de 32 caracteres em `NODE_ENV=production`;
- revogação de sessões por `sessionVersion`;
- RBAC validado no backend;
- respostas de listagem/detalhe de instância usam whitelist explícita e não vazam tokens/configurações internas;
- Global API Key e token de instância permanecem suportados diretamente pelo Engine;
- auditoria local de operações administrativas relevantes.

## Compose e automação

Foram validados por parser YAML os Compose atualizados e os workflows GitHub alterados para publicação do `manager-api`.

A distribuição passa a possuir imagens independentes:

```text
ghcr.io/wkarts/argws-connect-api
ghcr.io/wkarts/argws-connect-manager
ghcr.io/wkarts/argws-connect-manager-api
```

O Manager legado embutido no Engine fica desabilitado por padrão nas configurações de deploy atualizadas (`SERVER_DISABLE_MANAGER=true`).

## Preservação funcional durante a migração

Os módulos funcionais existentes na Manager anterior que ainda não possuem paridade comprovada foram restaurados e permanecem em `manager/src`. Eles não são importados pelo `main.js` da nova Manager e o build de produção os exclui de `manager/dist`, evitando regressão no repositório sem distribuir código legado inativo ao navegador.

A validação automatizada falha caso qualquer um dos módulos preservados seja removido prematuramente. Consulte `manager/LEGACY-MIGRATION.md`.

## Limites objetivos da validação neste ambiente

O ZIP original não contém `node_modules` do projeto raiz. Por isso a compilação TypeScript completa do Engine não foi refeita neste runtime. A implementação não refatorou o código funcional do Engine; as alterações de integração concentram-se em Manager, Compose, exemplos de ambiente, documentação e CI.

O navegador Chromium disponível neste ambiente bloqueia acesso HTTP a `127.0.0.1` por política administrativa (`ERR_BLOCKED_BY_ADMINISTRATOR`), portanto a validação visual automatizada via Playwright não pôde ser concluída aqui. Os endpoints HTTP foram testados diretamente e os smoke tests do frontend passaram.

Os serviços externos de licença, telemetria e distribuição de releases não estão implementados no ZIP original. A entrega contém os adapters/configurações para integração com esses serviços, sem inventar contratos externos inexistentes.


## Teste de compatibilidade dos tokens

`manager/api/scripts/token-compat.mjs` valida que a camada administrativa não quebrou o contrato de autenticação existente:

```text
TOKEN COMPAT OK: Global API Key + tokens de instância preservados
```

O teste verifica `AUTHENTICATION_API_KEY`, o caminho global do `authGuard`, o token individual da instância, o header `apikey` usado pelo BFF e o vínculo `MANAGER_ENGINE_API_KEY <- AUTHENTICATION_API_KEY` no Compose.
