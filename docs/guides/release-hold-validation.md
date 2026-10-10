# Validação de código e suspensão de publicação

## Correção após a PR #227

O merge `31f4e4dd307384f3aa6371c7413a3f183af375e6` foi aceito em `main`.
O workflow `Release - Auto Version, Build and Publish` falhou na etapa
`Enforce release hold`, antes de instalar dependências ou executar testes.
A causa foi a presença deliberada de `.github/RELEASE_HOLD.md`, não a
sondagem TCP do RabbitMQ. Reexecutar o mesmo commit repete essa decisão.

## Comportamento

A política de publicação agora informa uma decisão explícita ao workflow:

| Contexto | Validação | Publicação |
| --- | --- | --- |
| Push/manual em main, com trava | Executada normalmente | Suspensa: `publish=false`, `reason=held` |
| Pull request, com ou sem trava | Executada normalmente | Sempre desabilitada |
| Push/manual em main, sem trava | Executada normalmente | Elegível somente após aprovação de todas as validações |
| Contexto inválido ou erro ao avaliar a política | Falha explícita | Negada |

A existência da trava não equivale à aprovação do código. Lint, build,
Prisma, operações, contratos, Manager e documentação continuam obrigatórios.
Não há `continue-on-error`, erro convertido em sucesso ou remoção da trava.
O resumo do job informa que a publicação permanece suspensa.

Planejamento de versão exige `needs.validate.result == 'success'` e
`needs.validate.outputs.publish == 'true'`, além de execução em main fora de PR.
Todos os jobs de escrita/publicação permanecem dependentes do planejamento;
a retenção exige sucesso da release e da sincronização. Quando há trava, não
há nova versão, tag, imagem, release, sincronização ou limpeza pós-publicação.
`force_bump` não remove nem contorna a trava. Somente ausência real do caminho
permite elegibilidade; arquivo vazio, diretório e symlink ainda suspendem.

O caminho real de validação de release também roda em PRs que alterem esse
workflow, a política, seus testes ou a trava. O job tem somente leitura e
concorrência separada das releases de main. FFmpeg e PyYAML são instalados
explicitamente para as validações já existentes de áudio e Compose.

## Limites

Esta correção não libera a release suspensa. Os critérios de homologação
operacional descritos em `.github/RELEASE_HOLD.md` permanecem inalterados.
Não modifica RabbitMQ, Compose, ambientes, workers, transcrição, providers,
filas, retries, dados ou código de execução da Connect API.
O run antigo continua como evidência histórica; um rerun usa a mesma revisão
antiga, não o workflow corrigido. A correção precisa ser incorporada em main
para valer nas próximas execuções pós-merge. Nenhum deploy é necessário para
corrigir esse controle de CI e nenhum deploy é executado por esta alteração.
