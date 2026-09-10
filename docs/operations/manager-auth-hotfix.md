# Correção pontual: autenticação do painel operacional no Manager

## Causa e escopo

Na 1.0.22, o login por código de acesso valida a chave em `/verify-creds` e a mantém somente em memória. Entretanto, `manager/src/services/operations.ts` ainda consultava `sessionStorage`. Após autenticar, o painel exibia "Este painel exige acesso administrativo com a chave global." antes de enviar a requisição a `/operations/snapshot`.

O problema é o desacordo entre os dois serviços do frontend. Esta correção não altera `.env`, Compose, credenciais, banco, migrations, volumes, sessões WhatsApp ou documentação interna. Não exige trocar a chave global nem o token interno do agente.

## Alteração mínima

`current.ts` exporta `getCurrentAccessCode(): string`, que retorna a credencial mantida pelo login. `operations.ts` consulta esse accessor dentro de cada requisição, sem capturar a chave no carregamento do módulo e sem restaurar persistência no navegador. Logout e `clearCurrentAccess()` invalidam o acesso das próximas consultas; um novo login fornece a nova credencial.

A develop ainda mantinha a implementação anterior de persistência. Somente a inicialização e a gravação da credencial foram alinhadas ao código já publicado na main/1.0.22; os demais métodos de `current.ts` permanecem iguais. Na promoção para main, a mudança funcional é apenas o accessor e seu uso pelo serviço operacional.

O navegador continua enviando `apikey` para a API. A autorização administrativa permanece no backend: uma chave aceita no login não recebe acesso global apenas por existir em memória. O `OPERATIONS_INTERNAL_TOKEN` continua exclusivo da comunicação API/agente; não é enviado ao Manager.

Este ajuste trata o modo de acesso direto por API key. Não implementa autenticação operacional por conta/cookie, nem muda seu contrato. Recarregar o documento continua exigindo novo login no modo de acesso direto.

## Regressão automatizada

```bash
npm --prefix manager run test:operations-auth
npm --prefix manager run test
```

Os testes executam os módulos reais `current.ts` e `operations.ts`, com I/O do navegador simulado. Cobrem login validado, login pendente/rejeitado, snapshot, estatísticas, arquivos, histórico, exportação, logout, novo login, recarregamento, limpeza de credenciais antigas, armazenamento indisponível e respostas HTTP 403/429/503. Não simulam autenticação substituindo o accessor por uma chave fixa.

O teste já faz parte de `npm --prefix manager run test`, executado pelo CI existente. Não foram adicionadas dependências, alterados locks ou modificados workflows.

## Validação na develop antes da promoção

1. Implantar a imagem develop corrigida em homologação, sem substituir a instalação da cliente por uma versão de desenvolvimento.
2. Entrar no Manager com a chave global válida, abrir Visão Geral e conferir `/operations/snapshot` e `/operations/statistics` na aba Rede do navegador. Não copiar ou compartilhar o valor do header de autenticação.
3. Abrir histórico/arquivos e exportar um dia disponível. A resposta depende do agente habilitado e saudável; 503 de configuração/indisponibilidade não deve ser confundido com a regressão de autenticação corrigida.
4. Sair, recarregar e confirmar a exigência de novo login; autenticar novamente e consultar o painel. A chave não deve aparecer no armazenamento local ou de sessão.
5. Validar os checks e o comportamento em homologação antes de abrir a PR de promoção para main. A futura versão estável deve ser gerada pelo versionador existente, sem regravar a tag ou as imagens 1.0.22.

Testes automatizados de frontend não comprovam o funcionamento do agente ou da instalação real da cliente. Esta entrega não executa deploy na VPS nem migração de dados.
