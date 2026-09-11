# Correção do build standalone do Manager

O build do Manager usa `manager/` como contexto Docker e copia seu conteúdo para
`/app`. Ele não contém a pasta `src/` da API. A suíte de privacidade introduzida
junto das flags de comunicação tentava carregar o módulo da API pelo diretório
pai e falhava com `ENOENT: /src/config/manager-features.config.ts`, antes de rodar
os testes. Os builds da imagem completa da API não tinham a mesma falha porque
incluem os dois projetos.

## Separação de testes, sem alteração funcional

`manager/scripts/privacy-test-message.test.mjs` agora lê somente arquivos dentro
do Manager. Continua validando menus, rotas diretas, modal de teste, paginação de
contatos, envio nativo, flags geradas pelo entrypoint e ausência de dados sensíveis.
Não há fallback para ignorar testes quando um arquivo não existe.

A comparação com o módulo real `src/config/manager-features.config.ts` fica em
`test/manager-feature-contract.test.cjs`, executado pelo `test:compat` da raiz.
Essa suíte preserva a validação do parser da API, compara todos os defaults e as
variantes de ENV com o entrypoint standalone e executa os testes do Manager numa
pasta temporária contendo somente o contexto `manager/`. Assim, uma nova
dependência acidental de arquivos do backend reprova o CI antes da publicação.

## Comandos de validação

Na raiz do repositório, com as dependências já instaladas:

```bash
npm run test:manager-contract
npm run test:compat
npm --prefix manager run test
npm run docs:check
```

O `npm run test` do Manager permanece completo, incluindo autenticação,
privacidade, linguagem, estrutura Vue, typecheck e build Vite. O Dockerfile e os
workflows não trocam esses gates por um build sem testes. O teste de contexto
isolado verifica arquivos/testes, mas não substitui o build Docker multi-arquitetura
executado pelo pipeline de publicação.

Nenhum código de runtime, provider, autenticação, contrato Meta-compatible,
variável de ambiente, Compose, migração ou sessão WhatsApp é modificado por esta
correção. Dependências, locks, versão do produto e tags de release são preservados.
Não é necessário alterar credenciais ou volumes na instalação.
