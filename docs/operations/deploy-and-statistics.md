# Implantação completa e gráficos operacionais

## Escopo dos modelos

Os sete modelos ativos de API incluem o serviço operacional privado, suas variáveis, o volume de histórico e os limites de recursos:

| Modelo | Serviço operacional |
|---|---|
| `docker-compose.yaml` | `operations` |
| `docker-compose.dev.yaml` | `operations` (verifica somente a API desta stack reduzida) |
| `deploy/develop/compose.yaml` | `operations-argws-connect-develop` |
| `deploy/production/compose.yaml` | `operations-argws-connect-production` |
| `deploy/homologation/compose.yaml` | `operations` |
| `deploy/cloudpanel/docker-compose.yml` | `operations` |
| `deploy/dockge/compose.yaml` | `operations` |

Todos mantêm alias interno `operations`, nenhuma porta pública do agente, nenhuma montagem de docker.sock e nenhuma dependência da API no agente. Os serviços existentes, nomes de projeto, redes e caminhos de persistência não são renomeados por esta correção.

`deploy/canonical/` permanece congelado com a imagem antiga 1.0.21, que não contém o agente; não recebe um comando incompatível com aquela imagem. `deploy/docs/` e `deploy/docs-develop/` são documentação independente, não uma API, e não recebem o agente. Uma futura nova canonical deverá ser baseada em uma versão de API que contenha o serviço.

## Ambiente pronto, sem regenerar credenciais existentes

Os modelos `env.example`/`.env.example` ativos incluem `COMPOSE_PROFILES=operations`, `OPERATIONS_ENABLED=true`, `OPERATIONS_AGENT_URL`, `OPERATIONS_INTERNAL_TOKEN`, `ARGWS_CONNECT_OPERATIONS_DATA_PATH`, `OPERATIONS_HOT_DAYS` e `OPERATIONS_RETENTION_DAYS`.

O `.env` é a única fonte de configuração da instalação. Em um ambiente novo, o
operador define `OPERATIONS_INTERNAL_TOKEN` forte diretamente nele; em um ambiente
existente, o valor já configurado é preservado. Não há preparador distribuído na
stack e nenhuma credencial é rotacionada automaticamente.

```bash
# Dentro do diretório atual da stack:
docker compose --env-file .env -f compose.yaml pull
docker compose --env-file .env -f compose.yaml up -d --pull never
```

Uma opção `OPERATIONS_ENABLED=false` já gravada é preservada. Para habilitá-la conscientemente:

Defina `OPERATIONS_ENABLED=true` e inclua `operations` em `COMPOSE_PROFILES` no
`.env`, depois execute o mesmo `docker compose up -d`.

Perfis como `nats` e `kafka` são declarados no próprio `.env`. Não é necessário
colocar blocos manuais diferentes em cada service ou executar auxiliares antes do
Compose.

No Dockge, atualize o `compose.yaml` e mantenha o `.env`/volumes existentes, não
somente a imagem. `docker compose pull` não modifica esses arquivos. Não execute
`down -v`. Recriar a API interrompe chamadas em andamento, portanto utilize janela
sem chamadas.

Para imagens antigas sem `operations-agent/server.cjs`, use uma versão compatível antes de selecionar o perfil. Esta correção não altera tags já publicadas nem faz deploy remoto.

## Contrato dos gráficos

`GET /operations/statistics?from=AAAA-MM-DD&to=AAAA-MM-DD` usa o mesmo guard de API key global das outras rotas operacionais. O token privado do agente não é entregue ao navegador. O período é inclusivo e limitado a 31 dias.

- Requisições: soma dos campos `count` de `http.summary` no período inteiro.
- Erros HTTP 5xx: soma de `errors`; não contabiliza mensagem não lida ou chamada perdida.
- Tempo médio HTTP: `soma(durationMs) / soma(count)`, e não média das médias. Não mede latência do WhatsApp ou áudio.
- Tamanho dos arquivos por dia: bytes atualmente retidos para os arquivos recentes/compactados daquele dia. Não é uma série histórica de ocupação total do disco.

Um dia é agrupado por hora local; mais dias, por dia. O fuso da instalação é retornado e identificado na tela. Em fusos com horário de verão, horários locais repetidos são agregados na mesma hora local. A coleta ocorre em lotes: a atribuição ao intervalo usa a hora do registro do lote.

Sem amostras, os campos estatísticos são `null`; não há linhas de demonstração, preenchimento de lacunas ou indicadores de SLA inventados. Zero só aparece quando existem amostras que mediram zero. Lacunas conhecidas de coleta geram aviso. A coleta é de melhor esforço e não é auditoria financeira nem evidência de cobertura integral.

## Custo limitado

Gráficos SVG nativos, sem nova biblioteca. Sem polling adicional no navegador: carregar, atualizar e consultar período são ações pontuais. Estatísticas são calculadas pelo agente, fora do processo WhatsApp, consultando registros permitidos em JSONL/GZIP sem reimportar dados no banco.

O agente mantém cache por dia (máximo 32 entradas), 30 segundos para arquivos recentes e cinco minutos para arquivos compactados, com reaproveitamento de consultas simultâneas. A leitura é limitada a 120 mil linhas novas/10 segundos por solicitação, com liberação periódica do event loop. Limite atingido ou corrupção causa erro explícito, nunca totais parciais apresentados como completos. Continua valendo uma leitura histórica/exportação por vez e os limites de CPU/memória da stack.

## Manutenção dos modelos

`scripts/sync-operations-deployments.py` é manutenção interna do repositório e
sincroniza somente templates versionados. CI usa `--check`, sem modificar
instalações. Ele não é entregue nem necessário no host de deployment.

Validação: preparação nova e atualização idempotente, preservação de credenciais/perfis/volumes, rejeição de configuração inconsistente, Compose com perfil ativado/desativado, autorização de estatísticas, agregação ponderada, privacidade, fuso, arquivos compactados e estados sem dados.

A CI gera `Connect-API-Deployments-Operations.zip` com
`scripts/package-operations-deployments.py`, tanto em PRs quanto em pushes. O
empacotador exclui `.env`, arquivos `.lock`, caches Python e volumes; recusa links
simbólicos; verifica o CRC do ZIP e compara cada entrada com os arquivos de
origem. O log e o resumo da execução registram o commit, SHA-256 do ZIP e um
inventário dos arquivos com tamanho e SHA-256. Falhas de integridade interrompem
o job.

Em PRs, os arquivos são gerados e verificados no runner e a evidência fica no log
e no resumo, sem upload para o armazenamento de artefatos. Em pushes para
`develop`/`main`, o upload do pacote continua obrigatório, com retenção de sete
dias. Assim, a validação da PR não depende da quota de armazenamento; falta de
quota em um fluxo que distribui arquivos continua sendo uma falha de entrega.
