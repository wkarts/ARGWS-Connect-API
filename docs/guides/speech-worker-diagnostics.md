# Diagnóstico e operação dos workers de fala

Este procedimento corresponde ao pool persistente com protocolo v2. A captura de 07/10/2026 analisada na auditoria mostrava workers de transcrição e ditado residentes e timeouts de heartbeat, mas não comprovava OOM nem um job concluído. Ela motivou o bloqueio de release. Não use aquela captura como medição do código atual nem atribua falhas criptográficas do WhatsApp ao reconhecimento sem evidência própria.

A [matriz da correção](../reviews/speech-correction-2026-10-07.md) relaciona os achados do PDF ao código e às validações. O [guia de fala](speech.md) descreve contratos e configurações; [deploy/speech](../../deploy/speech/README.md) contém o perfil canário e o teto agregado do host.

## Antes de atualizar o develop

1. Registre a imagem/digest e o `.env` atual de API, Manager e worker. Guarde as credenciais fora de logs e da PR. Faça backup do banco e preserve RabbitMQ, objetos de áudio, diretório de modelos e sessões WhatsApp.
2. Confira o projeto Compose e os containers efetivos. O pool novo usa uma réplica; pare os workers antigos de transcrição/ditado antes de iniciar o novo protocolo. Não misture APIs/controladores de versões diferentes apontando para o mesmo banco e exchange durante a transição.
3. Interrompa novas admissões na aplicação ou conclua a janela de manutenção. Liste os jobs ativos e registre seus IDs, modos, fontes e estados. Não purgue filas para esconder pendências.
4. Aplique a migration aditiva `20261007193000_speech_durable_pool` no provider correto, com a API antiga parada. Ela acrescenta controle de execução, outbox, reservas e saúde de workers. Em tabelas grandes, estime a duração dos índices na cópia de homologação antes da janela.
5. Provisione o modelo escolhido e valide a revisão/hash. O download no início é opt-in. API e worker devem compartilhar os mesmos parâmetros de motor/modelo e o volume correto.
6. Suba a API nova e o único pool usando as imagens da mesma revisão. A limpeza de serviços órfãos deve alcançar somente o projeto selecionado. Não use `down -v`.
7. Confira `/v1/speech/health`, envie um áudio curto e acompanhe até conclusão. Um pool frio pode aceitar o trabalho com `modelVerified=true`, embora `/ready` ainda seja `503`. Após a inferência inicial, verifique readiness de cada modo habilitado.

Comandos de banco, dentro do ambiente que contém a configuração real:

```bash
DATABASE_PROVIDER=postgresql npm run db:generate
DATABASE_PROVIDER=postgresql npm run db:deploy
```

Para MySQL, selecione `DATABASE_PROVIDER=mysql`. O processo normal da imagem pode executar a migration no startup; confirme o mecanismo usado pela instalação para não executar dois processos concorrentes. Os testes de CI exercitam os dois providers em bancos descartáveis.

## Recuperação dos trabalhos anteriores

O protocolo usa novas filas `.v2`. Não renomeie nem altere argumentos de uma fila existente: filas quorum têm contratos próprios. Mantenha as filas antigas preservadas até decidir o destino dos trabalhos pendentes.

O reconciliador marca jobs ativos do protocolo anterior como `failed` com `LEGACY_PROTOCOL_REQUIRES_RETRY`. A recuperação de uma transcrição persistida é explícita pelo endpoint de retry. Ele verifica que não há consumidores antigos, lê a fonte com prazo/limite, verifica integridade e prepara os metadados para a nova geração. Se o áudio expirou ou não existe, retorna `410`. Ditados antigos cujo áudio só existia inline precisam ser gravados novamente.

O retry não converte silenciosamente modelo ou idioma. Para recuperar um backlog que pede o modelo antigo, mantenha esse modelo durante a recuperação ou trate os trabalhos como novas solicitações depois de registrar a decisão. Uma geração antiga nunca deve substituir o resultado de uma nova execução.

Para jobs v2, o reconciliador usa leases e prazo absoluto. Queda do broker/controlador encerra a inferência; uma execução expirada pode gerar tentativa limitada com seu checkpoint. A outbox cobre queda entre gravação no banco e publicação. Mensagem repetida não é prova de nova tentativa: `generation` também muda ao ceder a vez entre janelas.

## Sinais de saúde e seu significado

| Sinal | O que comprova | O que conferir se falhar |
| --- | --- | --- |
| `processAlive` | Heartbeat recente do coordenador | Processo, reinícios, conexão e relógio do host |
| `brokerConnected` | Coordenador conectado ao broker | Vhost, exchange, credenciais e rede |
| `modelVerified` | Arquivos locais passaram na verificação | Manifesto, hash, revisão, permissão e volume |
| `engineReady` | Carga e uma inferência inicial concluídas | Falha nativa, prazo de carga, instruções de CPU e memória |
| `acceptingJobs` | Coordenador aceita trabalho | Cotas SQL, modo e estado de conexão |
| `lastSuccessfulInferenceAt` | Última inferência real bem-sucedida, incluindo smoke inicial | Distinguir atividade antiga de reconhecimento atual |
| `controlHeartbeatAt` | Supervisão da execução atual | Perda de lease e reconciliação |
| `engineProgressAt` / `processedDurationMs` | Evolução real de reconhecimento/checkpoint | Operação nativa bloqueada ou lenta |
| `deadlineAt` | Prazo final do job | Não estender por polling ou heartbeat |

`/ready?mode=dictation` não deve ficar saudável apenas porque existe consumidor de transcrição. O modo `all` exige os modos habilitados. O health considera identidade do motor/modelo/revisão. O Manager desacelera consultas sem mudança; um heartbeat sozinho não avança a barra.

O shutdown deixa de receber trabalho, tenta concluir a operação dentro da janela e encerra o grupo do motor quando precisa interromper. A confirmação de morte inclui processos descendentes; a vaga não é liberada apenas porque `kill` foi chamado. Falha em confirmar o encerramento impede que o coordenador carregue outro modelo. Um guardião IPC separado continua responsivo quando o processo de inferência bloqueia e encerra seu grupo se o coordenador desaparecer. O takeover AMQP após queda abrupta não tem handshake físico com o guardião antigo; o orçamento agregado do cgroup continua necessário, inclusive para processos presos no kernel.

## Coleta sem payloads nem segredos

Selecione os containers de API, pool, broker, banco e armazenamento. Use formatos restritos de `docker inspect`; um dump completo pode revelar o `.env`.

```bash
docker compose ps -a
docker stats --no-stream
docker inspect --format '{{.Name}} restart={{.RestartCount}} exit={{.State.ExitCode}} oom={{.State.OOMKilled}} started={{.State.StartedAt}} finished={{.State.FinishedAt}}' NOME_DO_CONTAINER
docker inspect --format '{{.Name}} parent={{.HostConfig.CgroupParent}} memory={{.HostConfig.Memory}} swap={{.HostConfig.MemorySwap}} cpus={{.HostConfig.NanoCpus}}' NOME_DO_CONTAINER
```

No host, capture no mesmo intervalo: `docker events`, mensagens do kernel, RAM/swap disponível, CPU, IO e métricas cgroup `memory.current`, `memory.peak`, `memory.events`, `cpu.stat` e `pids.current`. Registre o pai comum quando várias stacks compartilham a VPS.

Amostras do coordenador Node, processo de inferência e servidor whisper.cpp agora podem representar **processos diferentes**. Identifique PID, PPID, grupo e namespace antes de somar RSS; o cgroup é a referência do total. Threads do mesmo processo compartilham RSS, e page cache/tmpfs não aparecem integralmente numa soma ingênua de RSS. Não apresente o pico de memória do executor/runner inteiro como consumo do pool.

Compare as métricas com latência HTTP, atraso do event loop da API, tamanho/idade da fila e etapas dos jobs. O reconhecimento em outro processo evita trabalho de modelo dentro do event loop HTTP, mas o consumo de CPU/memória ainda compete no host e requer teto agregado.

## Falhas e ações concretas

| Sintoma | Ação |
| --- | --- |
| `429` com `Retry-After` | Esperar o intervalo; verificar cotas e trabalhos pendentes antes de aumentar limites |
| `503` e `modelVerified=false` | Conferir volume, catálogo e progresso do provisionamento; reparar com `force=true` se o hash falhou |
| Modelo pedido difere do efetivo | Alinhar API/worker/revisão e drenar o backlog do modelo anterior; não aceitar fallback |
| Heartbeat sem avanço de motor | Observar `engineProgressAt`, deadline e eventos do processo; não reiniciar todo o host por suposição |
| `JOB_DEADLINE_EXCEEDED` | Inspecionar espera em fila e custo frio; ajustar o perfil só após medir latência/qualidade |
| Lease perdida ou worker morto | Verificar reconciliação de geração e ausência de inferência sobreposta |
| Mensagem sem rota/outbox pendente | Conferir exchange, bindings `.v2`, argumentos iguais e capacidade do broker |
| Exclusão retorna `409` após cancelar | Esperar a confirmação de término/lease e repetir; a fonte não deve desaparecer durante o uso |
| Bucket privado indisponível | Conferir configuração e permissões; não publicar áudio em bucket público como contingência |
| Erros de sessão WhatsApp | Investigar provider/sessão separadamente; preservar credenciais e volumes |

## Critérios de homologação

O smoke local com JFK verifica o caminho nativo e a residência entre trabalhos. Ele não mede qualidade pt-BR, rede/MinIO, disputa de fila nem capacidade da VPS. Antes de promover o canário:

- Usar um corpus de pelo menos 50 áudios pt-BR, incluindo sotaques, pausas, nomes próprios, baixa amplitude, silêncio e ruído. Comparar texto e taxa de erro com o perfil de referência e avaliação humana.
- Executar pelo menos 24 horas e 100 jobs na VPS de homologação. Medir p50/p95 de espera, carga fria, ditado e transcrição; RSS/cgroup, CPU, IO, event loop e latência de mensagens WhatsApp.
- Misturar áudio longo e ditados de várias instâncias, respeitando cotas. Verificar oportunidade de ditado entre janelas e ausência de starvation na carga real.
- Interromper API, broker e worker em janelas de falha distintas; validar outbox, redelivery, checkpoint, limite de tentativas e rejeição de resultado antigo.
- Cancelar durante carga, download e inferência. Confirmar morte do grupo antes de liberar capacidade e preservar privacidade/retenção da fonte.
- Executar uploads lentos, concorrentes, acima do limite e com desconexão. Verificar liberação de reservas, arquivos temporários e objetos órfãos.
- Conferir o orçamento agregado com todas as stacks habilitadas, incluindo brokers independentes. O teto por container sozinho não cobre a VPS.

Registre critérios numéricos de latência e qualidade antes de aprovar o perfil. O teto de 1280 MiB/1 CPU é a configuração inicial do ensaio. O smoke Docker em CI testa o binário sob esse teto; o ensaio operacional precisa cobrir API, coordenador, fila, fonte e motor juntos.

## Rollback

Interrompa novas admissões e pare o pool do canário com shutdown supervisionado. Registre jobs/gerações em andamento e preserve banco, filas, fontes e modelos. Restaure os parâmetros do adaptador Transformers e sua imagem compatível se for reverter somente o motor; trabalhos que pedem whisper.cpp não devem ser atendidos como outro modelo.

Para voltar ao código anterior ao protocolo v2, mantenha fala desativada, restaure em conjunto as imagens anteriores da API/Manager/worker e preserve as tabelas e colunas aditivas. Não deixe consumidores antigos lerem as filas v2 nem reintroduza múltiplos workers inadvertidamente. Jobs v2 não têm downgrade automático para a fila antiga; seu histórico deve ser reconciliado antes de reativar o fluxo anterior. Esse rollback de protocolo não é uma reversão automática de todos os trabalhos.

Não remova a migration com `DROP` nem restaure indiscriminadamente um backup sobre dados novos. O rollback de configuração/código e a recuperação de dados são decisões distintas. Verifique saúde da API e envio/recebimento de mensagens antes de reabrir o tráfego. O bloqueio de release permanece até as evidências de homologação estarem aprovadas.
