# Connect|API Manager — Preservação do legado durante a migração

## Regra

A nova Manager é evolutiva. Nenhum módulo funcional da Manager anterior deve ser removido do repositório antes de existir paridade funcional comprovada, com teste do recurso equivalente na nova Manager.

Os módulos abaixo foram restaurados do `develop` original e permanecem preservados em `manager/src`:

```text
api/calls.js
api/chat.js
api/client.js
api/configuration.js
api/instances.js
api/integrations.js

core/chat-preferences.js
core/runtime-config.js

pages/calls.js
pages/chat.js
pages/config.js
pages/integration.js
pages/status.js
pages/voip.js
```

## Estado de execução

Esses arquivos **não são importados pelo `manager/src/main.js` atual**. Portanto, não existem duas Managers executando em paralelo.

A aplicação ativa continua usando:

```text
manager/src/main.js
        ↓
manager/src/api/manager.js
        ↓
Manager API / BFF
        ↓
Connect|API Engine
```

Os módulos preservados servem como fonte funcional para migração e comparação até que cada recurso antigo tenha equivalente validado.

## Distribuição

O build de produção preserva os arquivos no repositório, mas os remove de `manager/dist/assets/app` porque eles não fazem parte da aplicação ativa. Isso evita distribuir código legado desnecessário no navegador sem destruir a referência funcional no código-fonte.

## Critério para remoção futura

Um arquivo legado só poderá ser removido quando todos os itens abaixo forem verdadeiros:

1. funcionalidades e contratos do arquivo foram inventariados;
2. cada funcionalidade possui equivalente na nova Manager;
3. operações de leitura e escrita foram testadas;
4. permissões/RBAC foram testadas;
5. responsividade e erros foram validados;
6. nenhum outro módulo ativo depende dele;
7. a remoção foi aprovada como parte de uma entrega específica.

## Recursos que ainda exigem atenção de paridade

Principalmente:

- envio de mídia e recursos avançados de Chat;
- foto de perfil e Status;
- preferências de Chat;
- fluxos completos de chamadas/VoIP;
- configurações avançadas da instância;
- integrações existentes e seus formulários/configurações;
- recursos presentes em `pages/integration.js` e `pages/status.js`.
