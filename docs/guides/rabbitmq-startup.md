# RabbitMQ: inicialização, limites e recuperação conservadora

## Escopo

Os pacotes de implantação verificam a abertura da porta AMQP antes de liberar
os serviços que dependem do RabbitMQ. A verificação usa `timeout` e Bash, já
presentes na imagem oficial espelhada, sem iniciar outra VM Erlang em cada
healthcheck. A API e os workers continuam aguardando `service_healthy`.

O probe TCP confirma que o listener está aberto. Ele não valida credenciais,
permissões, disponibilidade de todos os vhosts, publicação ou consumo. A
validação funcional deve confirmar esses itens separadamente. O teste não
declara filas, não publica mensagens e não utiliza credenciais.

A escolha segue a [orientação de readiness do RabbitMQ](https://www.rabbitmq.com/docs/monitoring#health-checks-as-readiness-probes):
comandos CLI repetidos entram e saem da distribuição Erlang, enquanto o
operador oficial usa uma verificação TCP da porta AMQP.

## Orçamento padrão

| Parâmetro | Padrão | Comportamento |
| --- | --- | --- |
| `RABBITMQ_CPUS` | `2.00` | Quota de CPU do contêiner. |
| `RABBITMQ_MEMORY` | `2g` | Limite de memória; `memswap_limit` usa o mesmo valor. |
| `RABBITMQ_MEMORY_WATERMARK_BYTES` | `1073741824` | Alarme absoluto de memória, equivalente a 1 GiB. |
| `RABBITMQ_PIDS_LIMIT` | `256` | Limite de processos/threads do contêiner. |
| `RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS` | Vazio | Usa os argumentos limitados abaixo; um valor não vazio substitui todo o conjunto. |
| `RABBITMQ_CTL_ERL_ARGS` | Vazio | Usa `+S 1:1 +SDcpu 1 +SDio 1 +A 1` em comandos administrativos. |
| `RABBITMQ_HEALTHCHECK_CONNECT_TIMEOUT` | `2` | Prazo interno do probe, em segundos, passado ao `timeout`. |
| `RABBITMQ_HEALTHCHECK_INTERVAL` | `30s` | Intervalo entre probes depois da inicialização. |
| `RABBITMQ_HEALTHCHECK_TIMEOUT` | `3s` | Prazo externo do healthcheck, maior que o prazo interno. |
| `RABBITMQ_HEALTHCHECK_RETRIES` | `10` | Falhas consecutivas antes do estado unhealthy. |
| `RABBITMQ_HEALTHCHECK_START_PERIOD` | `120s` | Período inicial em que falhas não contam para unhealthy. |

Quando `RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS` está ausente ou vazio, o Compose
resolve o seguinte conjunto, substituindo o watermark pelo valor configurado:

```text
+S 2:2 +SDcpu 1 +SDio 1 +A 4 -rabbit vm_memory_high_watermark {absolute,1073741824}
```

O conjunto restringe os schedulers normais e os pools de trabalho nativo do
runtime. A variável de argumentos **adicionais** preserva os argumentos padrão
do RabbitMQ. Não se sobrescreve `RABBITMQ_SERVER_ERL_ARGS`.

Se a instalação já define `RABBITMQ_SERVER_ADDITIONAL_ERL_ARGS` com um valor
não vazio, esse valor é passado integralmente, sem acrescentar ou substituir
watermark e schedulers. Nesse caso, o operador precisa conferir se seus
argumentos e seu arquivo de configuração estão coerentes com a quota de CPU e
com `RABBITMQ_MEMORY`. Alterar somente `RABBITMQ_MEMORY_WATERMARK_BYTES` não
modifica um conjunto de argumentos explicitamente personalizado.

**Os 2 GiB são um teto, não memória reservada nem consumo medido.** O watermark
de 1 GiB aciona backpressure sobre produtores; ele não impede que o processo
ultrapasse esse valor. A folga até o teto permite acomodar trabalho interno,
buffers e variações durante recuperação. A
[documentação de memória do RabbitMQ](https://www.rabbitmq.com/docs/memory)
recomenda watermark absoluto em contêineres e distingue esse alarme de um
limite físico.

Antes de aplicar um teto novo em um broker existente, conferir seu consumo,
backlog e tipos/quantidade de filas. Se a carga já exige mais que o padrão,
aumentar o teto e ajustar o watermark com folga. Um teto insuficiente pode
provocar OOM do contêiner; esta configuração não demonstra que 2 GiB atendem
qualquer instalação. O orçamento agregado da VPS também inclui API, speech,
bancos, armazenamento, serviços opcionais e o sistema operacional.

Um perfil menor, com `RABBITMQ_MEMORY=1g` e
`RABBITMQ_MEMORY_WATERMARK_BYTES=536870912`, deve ser usado somente depois de
validar a recuperação e a carga real nesse orçamento. O hotfix adota 2 GiB
para oferecer mais folga ao estado legado desconhecido. Os exemplos de
ambiente não alteram o `.env` já instalado.

## Identidade, imagem e volumes

Esta correção não altera automaticamente a imagem, o hostname, o nodename,
credenciais, redes, vhost, filas ou diretório de dados do RabbitMQ. Também não
executa migrações de broker nem apaga contêineres órfãos.

O RabbitMQ usa o nodename para localizar estado persistido. A
[documentação da imagem oficial](https://github.com/docker-library/docs/blob/master/rabbitmq/README.md)
explica que um hostname aleatório pode selecionar outro diretório de dados
quando o contêiner é recriado. Para uma instalação existente:

1. Registrar o digest da imagem em execução, o hostname/nodename e o mount
   efetivamente usado em `/var/lib/rabbitmq` antes de recriar o contêiner.
2. Conferir os diretórios `mnesia/rabbit@...` existentes. Se houver mais de um,
   identificar o nó anteriormente funcional pelos registros da instalação;
   não escolher automaticamente por tamanho ou data.
3. Preservar exatamente a identidade e a imagem compatíveis com os dados.
   Não trocar para um hostname genérico nem renomear diretórios para fazê-los
   coincidir com um novo contêiner.
4. Para cópia consistente das mensagens, parar o broker antes de copiar seu
   diretório de dados. Manter a cópia separada do volume ativo.

Segundo a [documentação de backup](https://www.rabbitmq.com/docs/backup), a
restauração de dados exige o mesmo nodename; renomeação não é suportada quando
há quorum queues ou streams. A
[documentação de upgrade](https://www.rabbitmq.com/docs/upgrade#downgrades)
também informa que downgrades não são suportados de forma geral. Não usar uma
imagem antiga sobre um volume já aberto por versão mais nova como tentativa
de corrigir boot.

Em uma instalação nova, pode-se escolher um hostname estável antes do primeiro
boot. A adoção dessa identidade em instalações antigas exige o procedimento
de preservação acima; o manifesto não a impõe automaticamente.

## Leitura do incidente de 8 de outubro de 2026

O fragmento analisado mostra RabbitMQ 4.3.6 com Erlang 27.3.4.18 inicializando
como `rabbit@8116f0934608`, com estado localizado no diretório desse nodename.
O log anuncia a primeira inicialização de um nó não clusterizado e continua
avançando pelas etapas de boot. O fragmento termina antes de confirmar o
listener AMQP ou a conclusão da inicialização.

Esse material não contém evidência de OOM nem uma falha fatal do RabbitMQ. O
valor `Max Memory` anunciado pelo NATS é uma configuração, não consumo
observado. A presença de vários serviços opcionais requer medir a carga da
stack inteira, e não atribuir seu uso ao speech sem identificar os processos.

## Recuperação e validação

Durante o diagnóstico, pausar apenas a admissão e os workers de speech
identificados na instalação. Preservar dados e configuração dos demais
serviços. Não reiniciar repetidamente um broker que ainda está avançando no
boot.

Coletar estado e métricas com baixo custo: status/restarts/OOMKilled,
`docker stats --no-stream`, limites efetivos, revisão das imagens, logs
limitados por período e pressão de CPU, memória e I/O do host. Evitar despejar
o ambiente completo, que contém credenciais.

Depois de aplicar a configuração preservando imagem, identidade e dados:

1. Aguardar a abertura AMQP e verificar que o contêiner fica healthy.
2. Validar o vhost, a autenticação e as filas previamente existentes com uma
   consulta administrativa pontual.
3. Iniciar a API e confirmar sua saúde, mantendo speech pausado durante a
   verificação do consumo do broker e dos serviços principais.
4. Alinhar imagem e manifesto de API/worker antes de retomar speech.
5. Observar memória, CPU, mensagens pendentes e latência sob carga real.

Não usar `down -v`, purge, `prune`, reset do broker ou remoção em massa de
serviços como etapa de recuperação. Reverter o hotfix significa restaurar a
configuração anterior de recursos/probe, preservando o digest, a identidade
e os volumes. Isso não requer downgrade do RabbitMQ nem restauração de banco.

## Testes

```bash
python test/rabbitmq-startup-deployments.test.py
RABBITMQ_TEST_REQUIRE_COMPOSE=1 python test/rabbitmq-startup-deployments.test.py
```

O primeiro comando verifica os dez manifestos, os exemplos de ambiente e um
listener TCP real. Quando Docker Compose está disponível, também resolve os
defaults e os overrides usando seu parser real. O segundo comando exige essa
validação; a ausência do Compose passa a ser erro. O parser Compose é
necessário para verificar o termo Erlang aninhado e a preservação integral de
argumentos personalizados.

A integração em contêiner deve usar o mesmo digest do espelho de implantação,
com as quotas do manifesto, publicar mensagens duráveis, reiniciar/recriar
com a mesma identidade e confirmar a recuperação. O smoke não substitui a
medição sustentada da VPS nem comprova ausência de travamentos sob qualquer
carga.

No workflow `Speech Integrity`, o relatório JSON de startup/persistência é
validado e registrado integralmente no log e no resumo de cada job SQL, junto
ao SHA-256, run/tentativa, commits e digest do broker. Em pull requests essa é
a evidência consultável, independente da quota de artifacts. Em push e execução
manual, o artifact `rabbitmq-startup-<provider>` também é obrigatório. Ausência
do relatório, JSON inválido ou tamanho acima do limite reprova o check; falhas
da integração continuam reprovadas mesmo com o diagnóstico preservado. Os
limites, acesso e política de publicação estão no
[guia de diagnóstico dos workers](speech-worker-diagnostics.md#evidência-de-fala-na-ci).
