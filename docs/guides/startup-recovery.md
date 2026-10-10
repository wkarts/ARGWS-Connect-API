# Diagnóstico de inicialização e contenção de speech

O utilitário [`scripts/connect-startup-diagnose.py`](../../scripts/connect-startup-diagnose.py)
coleta evidências limitadas de **um projeto Compose identificado explicitamente**.
Ele usa Python 3 da biblioteca padrão e o Docker CLI já instalado. Não instala
pacotes, não pede `sudo` e não é requisito para subir a aplicação.

Por padrão, as operações sobre Docker e os dados da aplicação são **somente
leitura**. A única alteração padrão é criar um diretório privado com
`diagnostico.json` e `resumo.txt` na máquina que executou o comando.

## 1. Identificar a instalação

Execute diretamente na VPS e com o usuário que já tem acesso ao Docker.
Confira os labels atuais:

```bash
docker ps -a --format '{{.Names}}\t{{.Label "com.docker.compose.project"}}\t{{.Label "com.docker.compose.service"}}'
```

Use o **valor exato do label `com.docker.compose.project`**. O nome exibido no
Dockge, o diretório atual e o nome de um container não substituem esse label.
Os comandos abaixo usam `argws-connect-develop` como exemplo; troque somente
pelo projeto efetivamente identificado. Containers sem labels Compose não
são selecionados pelo utilitário.

No diretório do repositório atualizado:

```bash
python3 scripts/connect-startup-diagnose.py \
  --project argws-connect-develop \
  --output-dir ./connect-startup-before
```

O diretório de saída precisa ser novo. Sem `--output-dir`, o programa cria um
nome com projeto, horário UTC e PID. O diretório recebe permissões `0700` e os
arquivos `0600`. Não execute o programa repetidamente em paralelo.

## 2. Conter ditado e transcrição, quando necessário

Para parar os workers de fala e coletar amostras antes/depois:

```bash
python3 scripts/connect-startup-diagnose.py \
  --project argws-connect-develop \
  --pause-speech \
  --output-dir ./connect-startup-pause
```

Essa opção é uma ação explícita. O programa reconhece serviços
`transcription-service`, `dictation-worker`, `speech-worker`,
`speech-dictation-worker` e `speech-transcription-service`, inclusive seus
sufixos de implantação. O nome legado
`speech-dictation-worker-argws-connect-develop` também é reconhecido.

Antes de cada parada, ele inspeciona novamente o **ID completo do container**,
confere o projeto, o serviço e a imagem reconhecida do worker e recusa
containers Compose one-off. Então executa `docker stop --time 15` apenas
naquele ID e verifica se ficou parado. Um serviço de nome semelhante com
imagem não reconhecida é informado como recusado e permanece em execução.

São preservados os containers e os volumes: o programa não apaga jobs,
arquivos de áudio, modelos, definições ou filas. Um trabalho em andamento
pode ser interrompido; a reconciliação depende da versão de speech que estava
rodando. O timeout de parada pode levar o Docker a encerrar o processo à
força, como no comportamento normal de `docker stop`.

A API, RabbitMQ, Kafka, NATS, bancos e demais serviços não são parados. A
opção não modifica a admissão de novos pedidos na API: enquanto o pool está
parado, evite solicitar ditado/transcrição e acompanhe os jobs já existentes.
A ferramenta não retoma os workers automaticamente. Um comando posterior
de atualização/`up` da stack pode iniciá-los novamente; confira o estado após
operar pelo Dockge.

**Pausar speech não garante a recuperação do RabbitMQ.** A comparação das
amostras serve para verificar se houve alívio de recursos e separar esse
efeito do estado do broker. Se nenhum worker elegível estava executando,
nenhum container é parado.

## 3. Preservar o RabbitMQ antes de recriar o container

Um hostname derivado do ID do container pode mudar numa recriação. Antes de
aplicar um Compose atualizado, capture a identidade e a imagem do container
que existe agora:

```bash
python3 scripts/connect-startup-diagnose.py \
  --project argws-connect-develop \
  --prepare-rabbitmq-override \
  --output-dir ./connect-startup-rabbit-preserve
```

É possível combinar `--prepare-rabbitmq-override` com `--pause-speech` na mesma
execução. A geração do override, isoladamente, não para nem recria nada.

Se houver exatamente um serviço RabbitMQ verificado no projeto, o programa
gera `compose.rabbitmq-preserve.json`. Compose aceita esse formato JSON. O
arquivo contém exclusivamente:

- O nome exato do serviço RabbitMQ observado no label.
- O `hostname` que esse container usa atualmente.
- O **ID local da imagem** no formato `sha256:...`, com `pull_policy: never`.
- `RABBITMQ_NODENAME` e `RABBITMQ_USE_LONGNAME`, quando definidos e válidos no
  ambiente observado, preservando a identidade customizada.

Credenciais não são copiadas. O programa reinspeciona o container antes de
gerar o arquivo. Zero ou múltiplos serviços RabbitMQ, mudança de identidade,
hostname inválido ou nodename não reconhecido impedem a geração. A presença
de vários diretórios `rabbit@*` é sinalizada, sem escolher qualquer um deles.

**O arquivo preserva o nó ATUAL.** Se uma recriação anterior já selecionou
um nó novo, esse arquivo não restaura o nó antigo nem recupera mensagens
por si só. Identifique o nó anteriormente funcional nos registros e backups
antes de qualquer procedimento de recuperação. Nunca escolha um diretório
Mnesia automaticamente pelo tamanho ou pela data.

O ID de imagem fixa os bytes já disponíveis naquele Docker daemon; não é
uma referência portátil para outra VPS. Guarde também os `RepoDigests`
registrados no diagnóstico. Não remova/prune a imagem durante a intervenção
e não troque sua versão para tentar corrigir o boot.

### Usar o arquivo com o Compose atualizado

O utilitário **não aplica** o arquivo. Faça a composição usando o diretório
original, o mesmo `.env`, o mesmo nome de projeto, os mesmos arquivos-base e
o override por último. Os labels `project.working_dir` e
`project.config_files` constam no relatório para conferência.

Exemplo, executado dentro do diretório original da instalação, quando ele
usa somente `compose.yaml` e `.env`:

```bash
docker compose --project-directory "$PWD" --env-file .env \
  --project-name argws-connect-develop \
  -f compose.yaml \
  -f ./connect-startup-rabbit-preserve/compose.rabbitmq-preserve.json \
  config --quiet
```

Esse comando apenas valida a composição, sem imprimir a configuração
completa. Se o projeto original utiliza mais arquivos `-f`, mantenha todos
eles, na mesma ordem, antes do novo override. Se o diagnóstico foi executado
em outro diretório, use o caminho absoluto do JSON. Não altere o diretório
base para a pasta do diagnóstico: mounts relativos precisam continuar
apontando aos mesmos dados da instalação.

Depois de confirmar que o Compose atualizado mantém mounts, credenciais,
rede, vhost, imagem e identidade, a aplicação direcionada ao RabbitMQ usa
o mesmo conjunto de parâmetros:

```bash
docker compose --project-directory "$PWD" --env-file .env \
  --project-name argws-connect-develop \
  -f compose.yaml \
  -f ./connect-startup-rabbit-preserve/compose.rabbitmq-preserve.json \
  up -d --no-deps --pull never rabbitmq-argws-connect-develop
```

Esse último comando **pode recriar o broker** para aplicar a configuração;
não faz parte do diagnóstico automático. Substitua o nome do serviço pelo
nome exato que aparece no JSON, quando diferente. Confira antes o consumo e
o backlog para ajustar os novos limites ao estado existente, conforme o
[guia de inicialização do RabbitMQ](rabbitmq-startup.md).

No Dockge, pode-se incorporar manualmente ao **mesmo serviço** os campos
gerados (`hostname`, `image`, `pull_policy` e eventual ambiente de identidade),
mantendo os campos restantes do Compose atualizado. Não crie outra stack.
Mantenha essa identidade nas próximas atualizações; omitir o override mais
tarde pode voltar a deixar o hostname aleatório.

## 4. O que o diagnóstico coleta

| Evidência | Limite e finalidade |
| --- | --- |
| Inventário de containers | No máximo 64 IDs, filtrados e revalidados pelo projeto. |
| Estado e saúde | Status, `RestartCount`, `OOMKilled`, código de saída, início/fim e últimas cinco verificações de saúde. |
| Imagens | Referência, ID local, `RepoDigests` e revisão OCI de API, workers e RabbitMQ. |
| Recursos configurados | CPU, memória/reserva/swap, PIDs, cgroup e política de reinício efetivos em `HostConfig`. |
| Configuração selecionada | Apenas flags conhecidas, modo/motor/modelo, concorrência/threads e projeção permitida de `SPEECH_CONFIG`; nenhum ambiente completo. |
| Utilização | Uma execução de `docker stats --no-stream` por amostra, limitada aos IDs desse projeto. |
| Host | Campos selecionados de `/proc/meminfo`, load average, PSI de CPU/memória/I/O, cgroup e espaço em disco. |
| Processos | Até 20 processos com nome, CPU, memória e threads; nenhuma linha de comando/argumento. |
| RabbitMQ | Últimas 150 linhas de log, com máximo de 96 KiB; URIs e possíveis credenciais são omitidas. |
| Logs de speech | Últimas 80 linhas, até 32 KiB; somente projeções permitidas do marcador `SPEECH_CONFIG` são retidas. |
| Persistência RabbitMQ | Nomes dos diretórios imediatos `rabbit@*` no mount observado e espaço/inodes desse filesystem. Nenhum conteúdo de arquivo ou subdiretório é lido. |

O programa não executa `rabbitmqctl`, não abre outra VM Erlang, não publica
mensagens e não inicia inferência/download de modelos. A inspeção de Mnesia
é recusada para daemon remoto/desconhecido e caminhos simbólicos diretamente
observados; cada acesso ao mount ocorre em subprocesso com prazo curto.
Permissão negada ou diretório ausente é registrado, sem tentativa de corrigir
proprietário ou permissões.

Cada comando externo tem orçamento padrão de oito segundos e limite de
saída. Exceções explícitas: parada de speech com prazo de 20 segundos,
sondagem de Mnesia com três segundos e `vmstat` com cinco segundos. O orçamento
total dos comandos é de 120 segundos; quando esgotado, as coletas restantes
são registradas como incompletas. Não há repetição automática em loop.

Opções adicionais:

```bash
python3 scripts/connect-startup-diagnose.py \
  --project argws-connect-develop \
  --vmstat --command-timeout 5 --max-seconds 90
```

`--vmstat` acrescenta três amostras com intervalo de um segundo por fase.
Se Docker estiver apontando para outro host, as métricas de `/proc` pertencem
à máquina que executou o programa. O relatório marca essa limitação e não
acessa caminhos locais como se pertencessem ao daemon remoto.

## 5. Interpretar e retomar

O resumo separa **fatos observados**, **indícios a verificar** e **limites da
conclusão**. `OOMKilled=true` é evidência de um encerramento registrado pelo
Docker; não determina sozinho por que toda a VPS travou. Estado `created`
da API indica que ela não iniciou nessa amostra; a causa precisa ser
correlacionada com dependências e logs. Uma revisão OCI ausente não permite
concluir que tags iguais contêm o mesmo código.

No registro de 8 de outubro de 2026, o RabbitMQ avançava pelas etapas de boot
e o trecho terminava antes de confirmar a inicialização. Ele não trazia
falha fatal ou OOM comprovados. O `Max Memory` exibido pelo NATS/JetStream é
um teto configurado, não uma medição de consumo. A ocorrência e a
interpretação estão descritas no [guia RabbitMQ](rabbitmq-startup.md).

Depois de estabilizar RabbitMQ e API, compare digest/revisão dos componentes
com o manifesto efetivo. Um Compose antigo ainda pode conter dois workers,
mesmo com imagens atualizadas. Alinhe o protocolo e reconcilie os jobs antes
de retomar um único pool conforme o
[procedimento de speech](speech-worker-diagnostics.md). Não descarte filas
para fazer o painel parecer vazio.

O programa nunca executa `down`, `rm`, `purge`, `prune`, reset de broker,
troca de hostname/digest em execução, alteração de `.env`, `sysctl` ou
downgrade. A geração do override e a contenção não mudam essa regra; aplicar
o Compose é uma etapa operacional separada, mostrada acima.

| Código de saída | Significado |
| --- | --- |
| `0` | Coletas solicitadas concluídas; não significa que a stack está saudável. |
| `2` | Argumento inválido, seleção ausente/ambígua ou coleta incompleta; conferir `issues` e mensagens. |
| `3` | Uma parada solicitada não pôde ser confirmada. Não presumir que o worker parou. |

Os arquivos minimizam informações, mas ainda identificam serviços, caminhos
e estados da instalação. Mantenha-os em canal privado de diagnóstico.

## Validação do utilitário

```bash
python3 test/connect-startup-diagnose.test.py
```

A suíte usa um adaptador Docker controlado para exercitar o fluxo real de
seleção, revalidação, contenção e geração do override. Também executa
subprocessos reais para timeout/limite de saída e uma árvore temporária de
Mnesia para comprovar leitura somente de nomes. Ela não simula um resultado
de recuperação na VPS nem substitui a coleta no ambiente afetado.
