# Voz: disponibilidade sob demanda após a retomada de 8 de outubro

## Escopo e evidências

Revisão do código na árvore `1fdcc6072b924bc8cf78a9b3c644245e498d36e0`,
correspondente ao `develop` em `152ba6ac554b533d845d5052eb637080b56db84c`.
A alteração corrige a apresentação de disponibilidade no Manager. Não modifica
contratos dos providers, motores/modelos, filas, esquema ou execução de jobs.

Evidências fornecidas pelo operador:

- Imagem do Dockge às 17:38:45: API e worker de transcrição com estado `healthy`.
- Configurações às 17:40:08: serviço habilitado, modos de transcrição e ditado
  apresentados como indisponíveis.
- Transcrições às 17:40:28: modelo instalado, um job registrado como `processing`,
  etapa `loading_model`, criado em 07/10 às 11:42:31; nenhum reconhecimento
  concluído informado pela execução atual.
- Exportação JSONL/Gzip às 17:40:50, com 1 manifesto e 1.901 eventos válidos,
  referente ao intervalo 16:40:44–17:40:44 em America/Bahia.

Os horários das imagens são os dos nomes dos arquivos enviados, não um relógio
interno dos serviços. O relatório não incorpora áudios, transcrições, contatos,
credenciais, ambiente completo ou os anexos brutos ao repositório.

## Retomada da API

O manifesto informa início do processo às 17:34:03.921; o marcador de início do
diagnóstico aparece às 17:35:09.137. Depois desse marcador foram observados:

| Evidência | Resultado |
| --- | --- |
| Healthchecks concluídos | 28 respostas HTTP 200, entre 19,9 ms e 2.329 ms |
| Conexão ZAPO | Estado `open` às 17:35:21.416 |
| Webhooks | 5 entregas concluídas com HTTP 200 após a retomada |
| Erros técnicos | Nenhum novo `runtime.error` após 17:35:17.716 até 17:40:42.708 |
| Memória da API | RSS final 312,30 MiB; máximo pós-retomada 337,96 MiB |

Na hora completa foram registrados 205 inícios e 205 conclusões bem-sucedidas de
webhooks. Os 410 eventos não representam 410 entregas diferentes. O manifesto
contabiliza 7.841 eventos no armazenamento total; esse número não é a quantidade
de eventos da exportação filtrada.

Os seis `runtime.error` incluem dois erros (Redis e SQS) e quatro advertências do
controlador RabbitMQ, concentrados na inicialização. As advertências RabbitMQ não
têm detalhes suficientes para atribuir uma causa específica. O atraso máximo do
event loop ainda atingiu 4,899 s em uma amostra após o reinício. Essas métricas são
do processo da API, não da CPU ou memória total da VPS nem do worker.

A observação depois do último erro cobre aproximadamente cinco minutos. Não há
registro explícito de transcrição concluída no arquivo; essa amostra não valida
estabilidade prolongada ou reconhecimento de áudio.

## Falha de apresentação reproduzida

O coordenador pode ter `processAlive`, `brokerConnected`, `modelVerified` e
`acceptingJobs` verdadeiros, com `engineReady` falso. Nesse estado normal, a API
expõe capacidade para admitir um trabalho e carregar o motor sob demanda.

A versão anterior de Configurações reduzia o estado de cada modo a `workerReady`
ou `dictationWorkerReady`: qualquer valor falso se tornava **Indisponível**.
Além disso, a consulta era feita apenas ao abrir a página. O banner agregado de
`warming` também afirmava que o modelo já estava sendo carregado, mesmo sem job.

A correção interpreta os sinais existentes por modo, distingue capacidade de
admissão de prontidão do motor e permite atualizar a leitura explicitamente.
O texto de `busy` descreve trabalhos registrados em processamento, sem tratar
essa contagem como prova de inferência ou avanço do motor.

## Job antigo: limite do diagnóstico

A data exibida na atividade é `createdAt`. Retries preservam essa data; não é
possível concluir, só pela imagem, que o motor executou continuamente desde o dia
anterior. O retorno público já permite observar geração, tentativas, início,
última atualização, progresso, heartbeat de controle, lease e prazo absoluto.

Foi identificada uma lacuna defensiva no reconciliador: um registro de protocolo
2 em `processing`, sem lease e sem prazo, não atende às comparações temporais
atuais. Não há evidência de que o registro do VPS tenha essa forma. Esta alteração
não transforma essa hipótese em alteração de dados ou reenvio automático.

Antes de uma correção operacional desse job, ler seus metadados de execução e,
se necessário, sua versão de protocolo no banco. Uma lease válida e renovada
exige investigação diferente de um registro sem autoridade de execução.

## Identidade do RabbitMQ

O inspect atual informa hostname `872088f15839`, mesma imagem efetiva informada
anteriormente e bind persistente em `/var/lib/rabbitmq`. A lista Mnesia contém
36 identidades históricas e suas expansões de plugins. Esses são diretórios,
não uma contagem de brokers ativos nem prova de perda de mensagens.

O hostname atual deve ser preservado no Compose efetivamente usado pela
instalação antes de uma próxima recriação. Não aplicar a antiga sobreposição que
fixava outro hostname. O nodename em execução não foi retornado pela leitura do
PID 1; a correspondência com o hostname é esperada pelo padrão da imagem, mas
ainda não foi observada diretamente.

Como o broker foi recriado entre as coletas, os antigos limites e healthcheck não
podem ser atribuídos ao contêiner atual sem uma nova inspeção. Nenhuma alteração
no broker ou nos seus dados foi executada durante esta revisão.

## Validação

Os testes de apresentação cobrem disponibilidade sob demanda, prontidão por modo,
ausência de conexão/modelo, capacidade ocupada e estados de processamento sem
inventar conclusão. A atualização de Configurações é exercitada executando a
função real extraída do componente, com promessas controladas para verificar
substituição do snapshot, bloqueio de consultas concorrentes e falha de consulta.

Validação local executada:

| Comando/cenário | Resultado |
| --- | --- |
| Suíte ampliada antes da correção | 5 testes aprovados e 7 falhos |
| `node --test manager/scripts/speech-status.test.mjs` após a correção | 12 aprovados, 0 falhos |
| `npm run check:language --prefix manager` | Aprovado |
| `npm run check:sfc --prefix manager` | Aprovado |
| `npm run typecheck --prefix manager` | Aprovado |
| `npm run build --prefix manager` | Aprovado |
| `npm run docs:check` | Contratos sincronizados |
| `git diff --check` | Aprovado |

O workflow existente `Speech Integrity` já executa a suíte modificada, as
verificações de idioma/estrutura, o build do Manager e a integridade documental.
O resultado remoto é registrado na Pull Request correspondente.

A validação no VPS continua exigindo um áudio curto com resultado correto,
seguido de teste de ditado e medição simultânea dos recursos. Nenhum resultado
de inferência real é atribuído a este ambiente de desenvolvimento.
