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

Referências oficiais:
- https://nodejs.org/api/crypto.html#cryptotimingsafeequala-b
- https://codeql.github.com/codeql-query-help/javascript/js-insufficient-password-hash/
- https://docs.github.com/en/code-security/how-tos/manage-security-alerts/manage-code-scanning-alerts/triage-alerts-in-pull-requests
