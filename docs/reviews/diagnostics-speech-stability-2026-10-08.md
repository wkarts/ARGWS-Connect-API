# Diagnóstico e correção de estabilidade — 08/10/2026

## Escopo e evidência

Esta correção trata o ciclo ocioso dos workers de ditado/transcrição, o histórico e o download do Centro de Diagnóstico e uma rejeição de inicialização SQS. A base analisada é o merge de `develop` `3f8788d59a992fd541a12fd6ca5d39ffc8d7ba81`, posterior à PR #222. Não há refatoração dos providers ZAPO/Baileys, da fachada Meta Compatible, dos contratos de mensagens/PTT, das sessões ou dos bancos.

Foram analisados dois arquivos gzip/JSONL exportados pela instalação e dois trechos de log de containers. Os arquivos originais não fazem parte deste repositório. Os horários abaixo estão em America/Bahia (UTC−3), salvo indicação expressa de UTC.

| Arquivo fornecido | Integridade e conteúdo |
| --- | --- |
| `connect-diagnostico-2026-10-08.jsonl.gz` | 92.971 bytes comprimidos; um manifesto e 1.658 eventos; nenhuma linha JSON inválida. Filtro de 08/10, 10:37:33 a 11:37:33. |
| `connect-diagnostico-2026-10-08.jsonl (1).gz` | 830.725 bytes comprimidos; um manifesto e 13.791 eventos; nenhuma linha JSON inválida. Filtro de 01/10, 11:38:12 a 08/10, 11:38:12. |
| Log de containers capturado às 11:31 | 438 linhas; 36 conexões AMQP aceitas, 37 fechamentos, 37 anúncios de coordenador e 21 erros `resource_locked`, no trecho de aproximadamente 3 minutos e 24 segundos. O recorte começa/termina no meio de ciclos. |
| Segundo log de containers | Mais nove conexões/fechamentos e quatro erros `resource_locked`, confirmando repetição posterior. O trecho mistura timestamps UTC e locais; não se calcula taxa a partir do menor/maior horário bruto. |

SHA-256 dos gzip, para identificar a evidência usada:

```text
última hora: aabfaf26cffdb5780245b73bfff8c60aa8e2310a6d5cbfc031ea5d9a252f826b
sete dias:  0cc6d653c01bee43075edffa9df83e51d63d89a368aba6d3328f321e79fb7892
```

O filtro de sete dias não implica sete dias completos de registros. O primeiro evento disponível é de 07/10 às 11:52:44, e o último é de 08/10 às 11:38:04. O manifesto registra 5.328.423 bytes em disco, limite de 128 MiB, `persistent=true`, `storageError=false` e `dropped=0`. Isso não aponta para corrupção ou crescimento descontrolado do armazenamento. Eventos suprimidos antes do store não estão abrangidos por `dropped`.

## Achados confirmados

### 1. A consulta expirava e bloqueava o caminho de download

Cinco eventos HTTP com rota sanitizada `/events` têm `aborted=true`, entre 11:32:34 e 11:36:31. As durações são 19.883, 19.991, 20.601, 20.304 e 19.982 ms. O status nominal 200 nesses registros é o valor da resposta ainda não concluída; não comprova entrega bem-sucedida.

O cliente do Manager já tinha prazo de 20 segundos para consultas e 120 segundos para exportação. Portanto, não se atribui a falha à ausência de timeout. O botão **Baixar diagnóstico** era desabilitado por `loading`, ausência de `loadedAt` ou erro da tabela. O endpoint de exportação era independente, mas a interface impedia usá-lo na situação em que mais era necessário.

A consulta de eventos e o estado do armazenamento também eram combinados em um único `Promise.all`: a falha de um descartava a resposta válida do outro. O backend não recebia o sinal de cancelamento da consulta, podendo continuar a varredura após o navegador desistir. A reserva de leitura era liberada no fechamento HTTP antes de esse trabalho realmente terminar.

O evento `diagnostics.exported` registra que a exportação da última hora concluiu com 1.658 eventos em 14.870 ms. Não existe, dentro do próprio arquivo de sete dias, um evento posterior que permita medir a conclusão dessa segunda exportação.

### 2. Workers separados disputavam residência mesmo sem áudio

O coordenador anterior adquiria a fila exclusiva `speech.residency.v2.<pool>.<slot>` no `connect()`. Em modo separado e sem modelo carregado, o timer de cinco segundos liberava a residência por meio do encerramento da conexão. Outro timer de cinco segundos reconectava. Com transcrição e ditado no mesmo pool, isso criava alternância de posse, canais `resource_locked`, autenticações repetidas e disponibilidade instável, mesmo com filas vazias.

O Docker mostrava os processos saudáveis enquanto o Manager mostrava os dois workers indisponíveis. São sinais diferentes: liveness do processo não comprova heartbeat recente, capacidade de admissão ou motor pronto. A correção mantém essa distinção.

O erro `RESOURCE_LOCKED` significa que uma conexão tentou acessar uma fila exclusiva de outra conexão. Ele não demonstra, por si só, corrupção do RabbitMQ. A anomalia reproduzida foi a disputa e reconexão ociosa provocada pelo coordenador. A exclusividade permanece necessária e não deve ser removida para silenciar o erro.

### 3. Inicialização SQS gerava rejeição não observada

Os dois eventos de `unhandledRejection` de inicialização têm frames `index.js:103:15`, `index.js:88:42` e `index.js:2136:1`. O erro foi reproduzido offline com as dependências fixadas no lockfile: o construtor SQS recebe região vazia e o SDK lança `Region is missing`. Os sourcemaps locais também localizam os frames do bundle em `SqsController.init`, `EventManager.init` e no bootstrap.

`EventManager.init` iniciava `sqs.init()` sem observar a rejeição da Promise. A correção registra a indisponibilidade desse transporte e seus metadados de erro, mantendo o bootstrap da API. Não escolhe uma região, não cria credenciais e não transforma configuração inválida em integração saudável. Se SQS está habilitado, sua configuração ainda precisa fornecer a região correta.

### 4. Outros erros não devem ser atribuídos aos workers

Os pseudônimos de componentes foram comparados com SHA-256 dos nomes estáticos de logger presentes no código. Dos 67 eventos `runtime.error`:

| Componente localizado | Quantidade | Limite da conclusão |
| --- | ---: | --- |
| `PusherController` | 33 | Identifica o componente emissor; metadados genéricos não mostram a exceção original. |
| `MetaCloudMediaService` | 9 | Avisos não identificam por si só uma regressão de voz. |
| `MetaCloudWebhookDispatcher` | 5 | Não se alteram contratos de webhook com base apenas no agrupamento. |
| `ChannelStartupService` | 5 | O agrupamento não demonstra uma causa única. |
| `Redis` | 1 | O registro genérico não prova queda persistente do cache. |
| HTTP | 8 | Erros 400 registrados pelo tratamento HTTP. |
| Rejeições não observadas | 3 | Duas inicializações SQS e uma falha Prisma `P1001`. |
| Logger minificado `o` | 3 | O nome minificado não identifica o serviço com segurança. |

O fingerprint mais frequente é o hash de `{ "name": "Error" }`. Ele agrupa metadados iguais, não confirma que todos os registros tenham a mesma causa.

A falha Prisma `P1001`, às 09:23:38, ocorreu no acesso a contatos durante o recebimento de mensagem. A stack localiza o ponto que propagou a indisponibilidade SQL; não identifica o motivo de o banco estar inacessível. O código dos providers permanece preservado nesta entrega.

As entregas de webhook possuem 2.318 inícios e resultados correspondentes: 2.313 concluídos e cinco falhos. Não há suporte para afirmar que todas as integrações pararam. O snapshot mais recente também mostra API e documentação em execução, diferente da captura anterior em que nem haviam iniciado. O estado `unhealthy` do RabbitMQ requer conferência de seu probe e configuração efetivos na instalação; o histórico exportado pela API não contém esses dados.

## Recursos: o que as amostras mostram

`runtime.sample` mede o processo da API, não os workers, o broker nem todos os containers. As 860 amostras do histórico têm RSS entre 250,11 e 497,02 MiB. No processo atual, iniciado às 06:43:21 segundo o manifesto, o maior atraso de event loop registrado chegou a 11.207,18 ms.

| Métrica da última hora | Resultado |
| --- | ---: |
| Amostras | 60 |
| RSS mínimo / mediana / máximo | 271,65 / 321,72 / 374,33 MiB |
| Heap utilizado máximo | 140,38 MiB |
| Mediana dos maiores atrasos por minuto | 551,82 ms |
| Percentil 95 dos maiores atrasos por minuto | 1.792,02 ms |
| Maior atraso observado | 2.384,46 ms |
| CPU média entre amostras, mediana / máximo | 0,23 / 0,46 núcleo equivalente |

Os percentis de atraso são calculados sobre o máximo de cada janela de amostragem, pelo posto `ceil(0,95 × n)` para o percentil 95. Eles não equivalem aos percentis de latência de todas as requisições. A CPU usa a diferença de `cpuUserMicros + cpuSystemMicros`, dividida pela diferença de uptime, descartando intervalos que atravessam reinício.

Esses dados demonstram demora da API e não mostram RSS de vários gigabytes nesse processo. Eles não permitem atribuir toda a pressão da VPS ao Node, ao reconhecimento ou ao RabbitMQ. A remoção de trabalho ocioso e de varreduras residuais elimina custos concretos; a recuperação de capacidade do host deve ser verificada após a atualização.

## Correção e verificação

| Área | Comportamento corrigido | Regressões verificáveis |
| --- | --- | --- |
| Manager | Exportação independente; tabela e armazenamento independentes; filtros substituem a consulta anterior; cancelamento explícito e mensagens de prazo. | SFC real, atributos dos botões, respostas fora de ordem, falhas parciais, sessão alterada, cancelamento e polling durante download. |
| Store de diagnóstico | Metadados de segmentos reduzem leitura; cancelamento chega ao arquivo; leitores liberados após cleanup efetivo. | Empates de timestamp, cursores, eventos fora de ordem, reinício, filtros, gzip/JSONL, aborto antes dos headers e escrita preservada durante cancelamento. |
| Workers | Conexões persistentes dos modos separados; residência adquirida por demanda; cessão após parada confirmada; exclusividade v2 mantida. | Ociosidade, disputa real, parada, perda de conexão, controle e ausência de inferência concorrente no teste instrumentado. |
| Bootstrap | Rejeição SQS observada sem alterar seleção de região, credenciais ou envio de eventos. | SDK AWS real offline, configuração desabilitada, região inválida e inicialização válida. |

O replay local distribuiu os 13.791 eventos em 138 segmentos de 100 registros, sem reproduzir a distribuição física desconhecida da VPS. A consulta dos primeiros 100 eventos passou de 138 arquivos / 13.791 registros examinados para dois arquivos / 191 registros. Os IDs e o cursor permaneceram iguais. O tempo observado passou de 131,76 para 3,67 ms; com filtro `error`, de 80,86 para 14,59 ms, lendo 27 arquivos. São medições do fixture local, não promessa de latência na instalação.

As suítes reproduzíveis estão no workflow **Speech Integrity**, além das regressões nativas de diagnóstico já presentes. O ensaio de residência usa RabbitMQ real e motor instrumentado para verificar coordenação; os jobs nativos amd64/arm64 verificam o reconhecimento real separadamente. Os resultados de CI da revisão exata constam na Pull Request. Nenhum teste de bancada substitui a medição de recursos da VPS.

## Atualização e aceite na instalação

1. Registre os digests atuais. Mantenha o `.env`, os volumes e a topologia de serviços instalada. Esta alteração não adiciona migration ou variável obrigatória.
2. Após o merge e o build aprovado, atualize API/Manager e todos os workers de voz para a mesma revisão. Faça a troca em janela sem inferência ativa. Não misture coordenadores antigos e novos durante o aceite de estabilidade.
3. Confirme que os workers ociosos mantêm suas conexões, sem repetir anúncios de inicialização a cada cinco segundos. Verifique os modos em `/v1/speech/health`; motor frio pode aceitar trabalho sem estar pronto para inferência ainda.
4. Execute um ditado e uma transcrição curtos, incluindo demanda nas duas modalidades. Verifique conclusão, respeito ao prazo, ausência de resultado duplicado e liberação do modelo conforme o TTL.
5. Abra o histórico de sete dias, baixe durante a consulta, altere para a última hora e cancele uma exportação. A tabela deve continuar utilizável, sem confundir resultados de filtros diferentes.
6. Compare CPU, memória, event loop e estado do RabbitMQ com uma captura atual do [diagnóstico de inicialização](../guides/startup-recovery.md). Se SQS estiver habilitado, confira `SQS_REGION` conforme a instalação; o aviso de transporte indisponível não deve ser interpretado como integração recuperada.

Rollback consiste em restaurar os digests anteriores de API/Manager/worker de forma coordenada. Não há reversão de schema. Restaurar a versão anterior também restaura seus defeitos conhecidos; em instabilidade, a contenção de voz deve usar o procedimento operacional existente, preservando filas, volumes e sessões.

## Referências técnicas

- [RabbitMQ: filas exclusivas e RESOURCE_LOCKED](https://www.rabbitmq.com/docs/queues#exclusive-queues).
- [Prisma: código P1001 e erros de conectividade](https://docs.prisma.io/docs/orm/reference/error-reference#p1001).
- [Node.js 22: streams e cancelamento](https://nodejs.org/docs/latest-v22.x/api/stream.html).
