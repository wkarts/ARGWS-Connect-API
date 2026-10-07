# Orçamento de fala por instalação e por host

O Compose define um único pool por instalação. Coordenador, motor de fala,
FFmpeg e temporários ficam dentro do mesmo cgroup do container. O teto de
memória e o teto combinado de memória e swap são iguais; o tmpfs já integra
esse orçamento. A API e o serviço de WhatsApp permanecem em seus containers.

## Configuração de canário

`canary-whisper-cpp.env.example` contém apenas as variáveis que selecionam o
adaptador whisper.cpp com modelo multilíngue base q5_1 verificado. Incorpore-as
ao `.env` do develop principal depois de provisionar o modelo. Preserve os
segredos, a seleção de perfis e os caminhos da instalação. O perfil de Compose
`transcription` inicia esse mesmo pool; não crie um segundo worker para ditado.

O teto inicial do canário é **1280 MiB e 1 CPU**, incluindo modelo e coordenador.
O tmpfs de 128 MiB integra esse teto. O número é um limite de ensaio, não uma
medição de capacidade. A configuração padrão do adaptador Transformers mantém
4 GiB por pool e não deve receber o teto do canário sem medição.

O binário whisper.cpp é compilado a partir do commit
`4979e04f5dcaccb36057e059bbaed8a2f5288315` (v1.8.2). Em amd64, a imagem inclui
o backend básico e variantes de CPU selecionadas pelo mecanismo de detecção do
próprio GGML; ela não depende da CPU do runner de build. Em arm64, usa a base
ARMv8-a/NEON compatível com o compilador do Debian Bookworm. O pool de threads
HTTP do motor é limitado a duas threads; a inferência usa o limite explícito
`SPEECH_INFERENCE_THREADS`. A prontidão final exige reconhecimento de teste.

## Fontes de áudio privadas

Os uploads novos de transcrição e de ditado usam um bucket dedicado e privado.
`SPEECH_S3_BUCKET_NAME` é repassado igualmente à API e ao worker. Quando vazio,
o runtime deriva o nome do bucket de mídia configurado em `S3_BUCKET` e
acrescenta `-speech`; por exemplo, `argws-connect-develop-speech`. Preserve um
valor privado personalizado já instalado ao incorporar o exemplo de canário.
Não configure esse valor com o bucket público de mídia.

A API cria o bucket dedicado sem política de acesso anônimo e verifica a
política existente antes de aceitar novas fontes. As credenciais de S3 devem
permitir essa verificação e as operações de áudio no bucket privado. Os
manifests não criam política pública. O volume MinIO existente deve ser
preservado para manter os dois buckets. Fontes legadas continuam identificadas
no bucket de origem; a mudança não transfere objetos nem muda silenciosamente
sua política.

## Teto agregado para stacks no mesmo host

Filas e brokers independentes não coordenam os limites de hardware entre
stacks. Todos os dez manifests suportam `SPEECH_CGROUP_PARENT`. Quando essa
variável fica vazia, aplica-se apenas o teto individual do container.

Em um host com **systemd, cgroup v2 e driver de cgroup systemd do Docker**,
`connect-speech.slice.example` é um exemplo de limite comum para **dois pools
do canário**: 2560 MiB de memória, sem swap adicional, 200% de CPU (até dois
núcleos de CPU) e 256 tarefas. Ajuste esses valores ao orçamento disponível
do host antes de habilitar os pools. Não aplique esse teto sem ajuste a dois
workers Transformers de 4 GiB.

Instalação da unidade, depois de revisar seu orçamento:

```bash
sudo install -m 0644 deploy/speech/connect-speech.slice.example /etc/systemd/system/connect-speech.slice
sudo systemctl daemon-reload
sudo systemctl enable --now connect-speech.slice
```

No `.env` de **cada instalação** que compartilha o host:

```dotenv
SPEECH_CGROUP_PARENT=connect-speech.slice
```

Recrie os pools no projeto Compose correto depois de drenar ou reconciliar os
trabalhos antigos. O mesmo pai deve aparecer nas instalações de develop,
produção e Fersoft mesmo quando seus brokers são diferentes. Não é necessário
alterar os limites individuais para aplicar o pai comum.

`host-budget.compose.yaml` é uma alternativa de configuração explícita para os
templates com serviço chamado `transcription-worker` (raiz, desenvolvimento
Docker, CloudPanel, Dockge e homologação):

```bash
docker compose --env-file .env -f compose.yaml -f deploy/speech/host-budget.compose.yaml config
```

Nos templates com nomes como `transcription-worker-argws-connect-develop` ou
`transcription-worker-fersoft-connect-production`, use diretamente a variável
do `.env`. O manifest já a aplica ao serviço correto. Não acrescente o override
genérico a esses templates: isso criaria um serviço com outro nome.

Verifique o orçamento e a associação antes de admitir fala:

```bash
docker info --format '{{.CgroupDriver}} / {{.CgroupVersion}}'
systemctl show connect-speech.slice -p ControlGroup -p MemoryMax -p MemorySwapMax -p CPUQuotaPerSecUSec -p TasksMax
docker inspect --format '{{.Name}} parent={{.HostConfig.CgroupParent}} memory={{.HostConfig.Memory}} swap={{.HostConfig.MemorySwap}} cpus={{.HostConfig.NanoCpus}}' NOME_DO_CONTAINER
```

Com outro gerenciador de cgroups, configure previamente uma hierarquia
equivalente no host e informe o caminho aceito pelo driver Docker. Não aplique
a unidade systemd nem o nome `.slice` em um host sem esse driver. Esse recurso
é opt-in e não é instalado automaticamente pelos manifests.

## Aplicação e rollback

As imagens, o banco e o protocolo de filas precisam acompanhar a mesma revisão
da correção. Interrompa a admissão antiga, preserve as fontes dos áudios e
reconcilie trabalhos legados antes de alternar consumidores. O serviço dedicado
de ditado foi removido; `up -d --remove-orphans` remove serviços órfãos do projeto
selecionado, sem exigir remoção dos volumes. Confira o projeto antes de usá-lo.

Para reverter um canário, interrompa novas admissões, encerre o pool com prazo
de desligamento e restaure as variáveis do adaptador anterior com o modelo
compatível. Preserve banco, fontes, volumes e filas. As instalações de produção
e Fersoft mantêm a fala desligada por padrão enquanto a release está suspensa.

O smoke nativo em CI usa o áudio público JFK do upstream, executa dois
reconhecimentos reais no mesmo processo e registra latência, duração, threads
e memória. Isso verifica o binário e o reuso do modelo; a homologação pt-BR,
o tempo de fila, o orçamento agregado da VPS e o ensaio sustentado continuam
sendo condições para promover a release.
