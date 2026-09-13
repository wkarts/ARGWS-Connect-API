# Direção das chamadas no Manager

## Problema e causa

Uma chamada efetuada pela Connect API ou pelo HUB aparecia como recebida ao consultar a lista no Manager. A tela também oferecia `Atender com áudio` e `Recusar` na instância originadora.

O backend entrega `direction: "outgoing"` corretamente. O normalizador do Manager verificava `includes('in')` antes de `includes('out')`. A palavra `outgoing` contém `in`, portanto era convertida para `incoming`. Valores como `ringing` e `connecting` também podiam ser confundidos com direção de entrada.

## Correção

A comparação usa valores completos, desconsiderando espaços externos e maiúsculas/minúsculas:

| Valor recebido | Direção no Manager |
| --- | --- |
| `incoming`, `inbound`, `in` | Recebida |
| `outgoing`, `outbound`, `out` | Efetuada |
| Sem direção reconhecida, `isIncoming: true` | Recebida |
| Sem direção reconhecida, `isIncoming: false` | Efetuada |
| Sem direção reconhecida e sem indicação booleana | Não identificada |

Uma direção explícita reconhecida tem precedência sobre `isIncoming`. Mantido o uso de `type` como alternativa quando `direction` está ausente. A classificação é refeita a partir da resposta da API em cada consulta, inclusive quando a chamada foi iniciada pelo HUB e o Manager é aberto depois.

## Escopo e validação

Alteração funcional somente em `manager/src/services/normalizers.ts`. Os testes de regressão estão na suíte existente `test/zapo-call-lifecycle.test.cjs`, executada por `npm run test:voip` no workflow de regressão.

O backend, os webhooks, o HUB, o aceite/encerramento Zapo e o atendimento pelo smartphone não foram modificados. Esta correção trata a direção e os botões exibidos pelo Manager; não comprova o estabelecimento de áudio nem resolve por si só uma falha de sinalização entre aparelhos.

```bash
npm run test:voip
npm --prefix manager test
```

## Aplicação

Base da correção: `develop` em `dca62500bf1a362f3ca5046d194ea252472f903c`, versão `1.0.29`, contendo a PR #100.

Após integrar a PR, publicar pelo fluxo habitual e atualizar a imagem do **Manager** (`argws-connect-manager`). Atualizar apenas a imagem da API não substitui o JavaScript da interface. Recarregar a página após a atualização para carregar os novos arquivos. Em instalação a partir do código, executar o build do Manager e publicar os arquivos gerados pelo procedimento existente.

O ZIP incremental contém somente os arquivos desta alteração e deve ser aplicado na raiz do repositório. Nenhuma migration, alteração de volumes, pareamento ou configuração é necessária.

## Conferência após atualização

1. Iniciar uma chamada no HUB/API e abrir ou atualizar a lista da instância originadora no Manager: deve constar `Efetuada`, sem `Atender com áudio` ou `Recusar`.
2. Abrir a instância de destino: deve constar `Recebida` e manter as ações de atendimento.
3. Aguardar as atualizações automáticas: a direção deve permanecer correta.
4. Atender no smartphone: conferir o comportamento já confirmado pelo usuário.
5. Revalidar separadamente o aceite pela API e o áudio nas duas pontas. Esse resultado depende de teste real e não pode ser inferido da correção visual.

Para desfazer exclusivamente esta mudança, reimplantar a imagem anterior do Manager; banco, sessões e volumes permanecem preservados.
