# Autenticação operacional e validação de segurança

## Correção do alerta CodeQL 63 na PR 77

O check de resultados `CodeQL` reprovou o commit `72fa619580abf351920531a6c411537f5c71538d` com `js/insufficient-password-hash` em `src/api/routes/operations.router.ts`. O workflow `Security Scan` havia terminado com sucesso, mas o check independente de resultados registrava um alerta de severidade alta. Aprovação do workflow de análise não equivale à aprovação dos resultados de segurança.

A fachada operacional fazia SHA-256 da chave global configurada e do header `apikey` para comparar digests de tamanho fixo. Nenhum desses digests era persistido como senha. A correção remove essa etapa de hashing: compara os bytes UTF-8 das duas chaves diretamente com `crypto.timingSafeEqual`, somente depois de verificar que ambos os buffers têm o mesmo tamanho em bytes. Chaves ausentes, vazias, diferentes ou configuração sem uma string válida são recusadas com HTTP 403. O comprimento da chave não é ocultado por essa checagem; o conteúdo de buffers de mesmo tamanho é comparado pela primitiva nativa.

A resposta de autorização, inclusive a negativa, recebe `Cache-Control: no-store` e não revela a chave. Não foi acrescentado bcrypt, scrypt ou PBKDF2 por requisição. Este é um verificador de API key configurada, não um armazenamento de senhas de usuários; essa correção não altera a política de criação ou rotação dos segredos.

## Contrato preservado

As quatro rotas `/operations/snapshot`, `/operations/history`, `/operations/archives` e `/operations/export` continuam registradas depois do middleware administrativo e exigem a chave global. Chaves de instância não adquirem acesso administrativo. O token interno do agente permanece no backend. Não há mudanças de endpoints, payloads, ENV, Compose, dependências, migrations, sessões WhatsApp, catálogo, JIDs ou chamadas nesta correção.

## Regressões

`node --test test/operations-resilience.test.cjs` mantém os três testes anteriores e acrescenta quatro casos. Eles executam o middleware real com a primitiva criptográfica nativa: ordem de registro das quatro rotas, chave exata, alterações de cada posição da chave, entrada ausente/vazia/mais curta/mais longa, configuração inválida e diferenças de comprimento UTF-8. Também verificam que não ocorre hashing no caminho de autenticação e que respostas negativas não refletem os segredos.

## Critério de validação da PR

Consultar os `check-runs` do HEAD atual, os status de commit e, quando existirem, os checks do commit de merge de teste. Conferir todos os resultados, inclusive os de `github-advanced-security`, e não somente a coleção de workflows de `github-actions`. Distinguir aprovação, falha, execução pendente e etapa explicitamente ignorada. Não ignorar alertas, reduzir sua severidade, desabilitar CodeQL nem substituir o resultado com um status manual.

## Gate automático quando o serviço Code scanning está indisponível

O workflow local `.github/workflows/security.yml` mantém `init`, `autobuild` e `analyze` do CodeQL, com as consultas padrão. A análise grava SARIF local com `upload: never` e `upload-database: false`; publicação é uma etapa separada. Não há `continue-on-error` no job CodeQL. O workflow não usa o core remoto `ci-core@main`.

`scripts/codeql-sarif-gate.cjs` verifica todos os resultados presentes no SARIF, sem allowlist, supressão, filtro de baseline ou exclusão por arquivo. Reprova qualquer resultado com nível `error` ou `security-severity` de 7,0 a 10,0 (alto/crítico), em linha com o critério padrão de bloqueio de PR do GitHub. Resultados médios, baixos, avisos e notas permanecem integralmente na evidência; aprovação do gate não significa ausência de achados. O nível `error` também bloqueia quando existe um score de segurança menor, de forma conservadora. Esse critério local não lê nem substitui uma política mais restritiva que possa existir nas configurações de Code scanning.

O gate resolve regras tanto do driver quanto das extensions, incluindo referências por índice. SARIF ausente, inválido, sem metadados de regras, com referências ambíguas, score de segurança ausente/inválido, invocação incompleta ou erro de execução reprova o job. A etapa `analyze` também precisa ter concluído com sucesso. O escopo da análise continua sendo o produzido pelo CodeQL padrão: PRs podem usar `diff-informed`/`overlay`. Esse modo e os metadados da execução são preservados no relatório; o gate não deve ser descrito como uma varredura obrigatoriamente completa da árvore.

Depois da análise, uma requisição limitada a 15 segundos consulta a disponibilidade do Code scanning com o token do próprio job. HTTP 200 com a coleção esperada torna obrigatório o `upload-sarif`, aguardando o processamento. Somente HTTP 403 com mensagem explícita de Code scanning, Code Security ou Advanced Security desabilitado permite operar apenas com o gate local. Erros de rede, autenticação, permissão genérica, 404, rate limit ou falha do servidor reprovam o job; não são convertidos em indisponibilidade opcional. Se o serviço estiver disponível, seus checks independentes continuam obrigatórios na revisão da PR.

O resumo e os logs registram a decisão automática, o checkout analisado (que pode ser o merge sintético da PR), SHA do evento e head da PR, ID/tentativa do run, versão/escopo do CodeQL, todos os achados com regras e fluxos completos e SHA-256 do SARIF e dos arquivos fonte envolvidos que pertencem ao checkout. O SARIF original também aparece comprimido em gzip e codificado em base64 entre `CODEQL_SARIF_BEGIN`, `CODEQL_SARIF_DATA` e `CODEQL_SARIF_END`. Isso mantém a evidência recuperável sem depender da quota de artifacts; a retenção é a dos logs do Actions. Para preservar o relatório antes da expiração, baixe os logs do job. Se o relatório exceder o limite do resumo, os logs continuam contendo o conteúdo completo. Se a entrada exceder o orçamento de evidência recuperável, o gate falha explicitamente.

Para recuperar um SARIF dos logs baixados, selecione o bloco `BEGIN`/`END` correspondente, concatene apenas os valores após `CODEQL_SARIF_DATA `, decodifique base64 e descomprima gzip. Confirme o SHA-256 dos bytes resultantes com o valor em `BEGIN`/`END`. O formato preserva o SARIF integral, inclusive diagnósticos e metadados, sem interpretar mensagens como comandos do workflow.

Regressão offline: `node --test test/codeql-sarif-gate.test.cjs`. Os casos cobrem bloqueio alto/crítico/error, manutenção de achados médios/baixos, metadados de extensions, ambiguidade, análise incompleta, ausência de bypass por supressão, fallback estrito e recuperação byte a byte da evidência dos logs.

Referências oficiais:
- https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b
- https://codeql.github.com/codeql-query-help/javascript/js-insufficient-password-hash/
- https://docs.github.com/en/code-security/how-tos/manage-security-alerts/manage-code-scanning-alerts/triage-alerts-in-pull-requests
- https://github.com/github/codeql-action/blob/v3/analyze/action.yml
- https://github.com/github/codeql-action/blob/v3/src/api-client.ts
