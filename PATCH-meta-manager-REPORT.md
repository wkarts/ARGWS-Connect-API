# Connect|API — correção Meta-compatible, visibilidade e envio de teste

## Base e situação da entrega

Aplicado exclusivamente ao arquivo **ARGWS-Connect-API-develop (15)(1).zip** fornecido nesta conversa.
Comentário original do ZIP: `9979157d040ef69f1318b5e861919a96379a316c`.
SHA-256 do ZIP de entrada: `48f990fb7b48028eb55b5c947e578af5b61568c87010215938f1bc42c0c26308`.

A entrega é um pacote de **código-fonte para revisão/homologação na develop**. Não é
uma imagem Docker já publicada. Não houve push, abertura de PR, merge, alteração de
main, nova release ou deploy na VPS. A numeração de versão do projeto foi preservada.
Nenhum arquivo original foi removido.

## 1. Correção genérica Meta-compatible

O serializer distingue o interlocutor do remetente. Em conversa individual recebida,
`contacts[].wa_id` e `messages[].from` identificam o interlocutor. Na saída,
`contacts[].wa_id` continua sendo o destinatário e `messages[].from` é o telefone
conhecido da própria instância. Um `false` explícito de fromMe não se perde na cadeia
de fallbacks. PN válido tem precedência sobre LID; um LID opaco não vira telefone.

A extensão opcional fica em
`entry[].changes[].value.messages[].connect_api`, preservando direção, JIDs originais,
participante, resolução do telefone e `source` somente quando a origem está no evento.
Não é uma alteração na API oficial da Meta nem um contrato específico para HUB/CRM.
Consumidores não devem inferir bot/dispositivo quando a origem não existir.

Nome/foto são enriquecidos por consulta limitada aos contatos persistidos da instância.
Não há consulta ao WhatsApp, varredura do histórico ou gravação de contatos pelo serializer.
Na entrada, os dados remotos do evento têm prioridade. Na saída, nome/foto do remetente
local não são atribuídos ao destinatário; usa-se o perfil remoto já persistido.

Quando não existe PN legítimo, `wa_id`/`from` telefônicos desconhecidos são omitidos,
não preenchidos com dígitos do LID ou identificador vazio. O JID permanece em `connect_api`
e `phone_resolved` fica false. Trata-se de uma extensão de compatibilidade, que deve ser
tratada pelo consumidor sem criar contatos com chave vazia. Status conservam sua estrutura;
`recipient_id` permanece vazio quando não há telefone legítimo. Consulte o guia completo
em `docs/guides/meta-compatible.md`.

Foram preservados o transporte oficial Meta, a autenticação Graph por token da instância,
as rotas de envio nativas e o processamento de mídia. O identificador de objeto
`phone_number_id` da Meta não é reinterpretado como telefone de origem. Testes locais
com payloads e I/O simulados cobrem esses limites; não são uma homologação externa da Meta.

## 2. ENV de visibilidade

Configuração preparada para produção:

```env
MANAGER_FEATURE_CONVERSATIONS=false
MANAGER_FEATURE_MESSAGES=false
MANAGER_FEATURE_CONTACTS=false
MANAGER_FEATURE_INSTANCE_TEST_MESSAGE=true
MANAGER_FEATURE_TEST_MESSAGE_CONTACTS=false
```

Nos modelos de develop/homologação, as três telas e a seleção de contato têm default
true. Valores explícitos no `.env` sempre prevalecem, inclusive para reabrir as telas
em produção. Arquivo `.env` real do cliente não foi criado nem substituído.

As flags controlam menus e acesso direto às rotas do Manager. **Não são RBAC ou revogação
de acesso à API.** Uma credencial que já autorize consultas nativas continua autorizada.
Não distribua API key global para operadores que não devem ter acesso administrativo.

A configuração cobre os sete Compose ativos e seus exemplos de ENV, além de runtime
servido pela API, Manager standalone e servidor Vite de desenvolvimento. O canonical
histórico e as stacks somente de documentação não foram modificados. A geração continua
sincronizada por `scripts/sync-operations-deployments.py`.

## 3. Mensagem de teste por instância

O botão **Enviar teste** existe no cartão de cada instância e nos detalhes. Abre um
modal isolado para informar telefone internacional e texto (até 4.096 caracteres).
O envio usa a API nativa existente, respeita a credencial corrente e exige conexão ativa.
Não carrega conversas ou histórico, não guarda o destinatário/texto no navegador e não
faz reenvio automático em caso de falha. Sucesso indica solicitação aceita, não entrega.

Para permitir escolher um contato sem reabrir a tela de Contatos:

```env
MANAGER_FEATURE_TEST_MESSAGE_CONTACTS=true
```

A agenda só é carregada após ação explícita, até 50 registros por página. Essa opção
expõe nomes/identificadores da página selecionada; mantenha-a false onde até essa
visualização não for permitida. Grupos/canais não são destinos do teste individual.
Para a Meta oficial, é necessário telefone conhecido e continuam valendo suas regras
de envio de texto e janela de atendimento; não há template ou bypass automático.

## 4. Validações efetivamente executadas

| Validação | Resultado |
|---|---:|
| Regressões Meta-compatible (módulos reais; banco/eventos simulados) | 48/48 |
| Manager: autenticação existente + privacidade/envio de teste | 25/25 |
| Operações: resiliência, autorização, estatísticas, grupos e catálogo | 24/24 |
| Preparação e sincronismo de deployments (Python) | 8/8 |
| **Total de casos das quatro linhas acima** | **105/105** |
| Foundation Meta existente | Aprovado |
| Parse/transpilação TypeScript | 248 unidades sem erro de sintaxe |
| Estrutura SFC e linguagem visível | Aprovados |
| Contratos OpenAPI/AsyncAPI e modelos de deploy sincronizados | Aprovados |
| Sintaxe do entrypoint shell e diff sem whitespace inválido | Aprovados |

**Limites da validação:** a instalação das dependências do Manager falhou com
`EAI_AGAIN registry.npmjs.org`. Não foi executado um build completo Vite/vue-tsc, ESLint,
build Docker ou CI remoto. O comando completo `npm run test:compat` também não pôde
prosseguir neste ambiente por ausência de `class-validator`; as regressões Meta e o
foundation acima foram executados isoladamente com o compilador TypeScript disponível.
Transpilação não é typecheck completo. Não foram realizadas chamadas/mensagens WhatsApp,
consulta a banco real nem teste de entrega oficial Meta. Não há declaração de CI verde.

Em ambiente com as dependências disponíveis, executar antes da publicação:

```bash
npm ci
npm run db:generate
npm run lint:check
npm run test:compat
npm --prefix manager install
npm --prefix manager run test
npm run docs:check
```

Defina `DATABASE_PROVIDER` e os parâmetros de testes conforme o pipeline já existente.
Os testes novos estão conectados às cadeias existentes de compatibilidade e Manager.

## 5. Preservação conferida contra o ZIP de entrada

| Área | Arquivos conferidos | Resultado |
|---|---:|---|
| Provider oficial Meta (integração e transportes) | 3 | Idênticos em bytes |
| Autenticação Graph, envio e rotas Graph | 18 | Idênticos em bytes |
| Rotas, controladores, DTOs e guards nativos | 50 | Idênticos em bytes |
| Schemas e migrations Prisma | 88 | Idênticos em bytes |
| Providers WhatsApp e sessões | 17 | Idênticos em bytes |
| Canonical histórico | 13 | Idênticos em bytes |
| Versão e dependências do backend | 3 | Idênticos em bytes |

As dependências do Manager também são iguais às originais; somente seus scripts de
regressão mudaram. Os dois arquivos de identidade/serialização Meta-compatible foram
alterados como solicitado; os demais arquivos dessa camada permanecem idênticos.
Isso comprova o escopo do diff, não uma garantia de funcionamento em produção.

## 6. Como utilizar a entrega

Extraia em uma cópia limpa da develop correspondente ao ZIP enviado. Revise o diff e
execute os testes/build no seu pipeline. Não mescle cegamente sobre uma branch com
alterações posteriores. O arquivo `.patch` acompanha a mesma alteração; pode ser
conferido com `git apply --check` antes de ser aplicado a uma base limpa correspondente.
A documentação e os testes estão incluídos no ZIP completo.

Após compilar/publicar uma imagem de homologação, testar login, menu/deep links com
flags false/true, envio pontual, seleção de contato e webhooks de entrada/saída. Ajuste
os valores explícitos do `.env` instalado; defaults de Compose não sobrepõem valores
existentes. Recriar o serviço para novas variáveis e recarregar o Manager é necessário.
Não use `down -v`, não troque secrets e não remova sessões WhatsApp por causa deste patch.
A promoção para main deve ocorrer em etapa separada após essa validação.

## Arquivos de código/configuração/documentação alterados ou adicionados

38 arquivos originais modificados e 8 novos arquivos de implementação,
testes ou documentação; além deste relatório incluído no pacote.

- `.env.example`
- `.gitignore`
- `deploy/cloudpanel/.env.example`
- `deploy/cloudpanel/docker-compose.yml`
- `deploy/cloudpanel/env.example`
- `deploy/develop/compose.yaml`
- `deploy/develop/env.example`
- `deploy/dockge/.env.example`
- `deploy/dockge/compose.yaml`
- `deploy/dockge/env.example`
- `deploy/homologation/compose.yaml`
- `deploy/homologation/env.example`
- `deploy/production/compose.yaml`
- `deploy/production/env.example`
- `docker-compose.dev.yaml`
- `docker-compose.yaml`
- `docs/guides/manager-communication-visibility.md`
- `docs/guides/meta-compatible.md`
- `docs/openapi/coverage.json`
- `docs/openapi/meta-compatible.openapi.json`
- `docs/scripts/meta-compatible-schemas.mjs`
- `env.example`
- `manager/Dockerfile`
- `manager/docker-entrypoint.d/40-manager-features.sh`
- `manager/nginx.conf`
- `manager/package.json`
- `manager/public/assets/feature-defaults.json`
- `manager/public/assets/runtime-config.js`
- `manager/scripts/privacy-test-message.test.mjs`
- `manager/src/components/TestMessageModal.vue`
- `manager/src/layouts/AppShell.vue`
- `manager/src/router/index.ts`
- `manager/src/services/connect.ts`
- `manager/src/services/current.ts`
- `manager/src/services/test-message-input.ts`
- `manager/src/views/InstanceView.vue`
- `manager/src/views/InstancesView.vue`
- `manager/src/views/VoiceView.vue`
- `manager/vite.config.ts`
- `scripts/sync-operations-deployments.py`
- `src/api/compat/meta-cloud/meta-cloud-identity.resolver.ts`
- `src/api/compat/meta-cloud/meta-cloud-webhook.serializer.ts`
- `src/api/routes/view.router.ts`
- `src/config/manager-features.config.ts`
- `test/meta-cloud/contract.test.ts`
- `test/meta-cloud/webhook-identity.test.ts`
