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

Cada diretório de implantação recebe `prepare-env.sh` e uma cópia sincronizada do preparador Python, de modo que o diretório também funciona isoladamente. O preparador cria um ambiente novo ou completa somente as variáveis operacionais ausentes no ambiente existente. O token dedicado é aleatório (32 bytes), gerado localmente; não é a API key global. Reexecuções não trocam esse token ou outras credenciais. O arquivo é escrito atomicamente com permissão 0600. Não é executado como shell.

```bash
# Dentro do diretório ATUAL da stack, com os arquivos atualizados:
./prepare-env.sh
./preflight.sh
./deploy.sh
```

Uma opção `OPERATIONS_ENABLED=false` já gravada é preservada. Para habilitá-la conscientemente:

```bash
./prepare-env.sh --enable
./deploy.sh
```

Perfis salvos como `nats` e `kafka` são preservados; perfis informados pelo shell são somados apenas na execução. `deploy.sh` e `update.sh` preparam os parâmetros antes de invocar Compose. Não é necessário colocar blocos manuais diferentes em cada serviço.

No Dockge, atualize também o YAML e os arquivos de preparação da stack, não somente a imagem. Execute o preparador uma vez antes de aplicar o Compose pela interface. `docker compose pull` não modifica o Compose nem o `.env` existentes. Não execute `down -v`. Recriar a API interrompe chamadas em andamento, portanto utilize janela sem chamadas. O comando de atualização existente continua realizando backup consistente, que pode parar a API durante a captura.

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

`scripts/sync-operations-deployments.py` sincroniza somente arquivos versionados de implantação. CI usa `--check`, sem modificar arquivos. `scripts/prepare-operations-env.py` é o preparador de ambientes da instalação; não são o mesmo comando.

Validação: preparação nova e atualização idempotente, preservação de credenciais/perfis/volumes, rejeição de configuração inconsistente, Compose com perfil ativado/desativado, autorização de estatísticas, agregação ponderada, privacidade, fuso, arquivos compactados e estados sem dados.
