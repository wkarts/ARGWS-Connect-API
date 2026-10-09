# RabbitMQ: healthcheck TCP, sem CLI recorrente

## Escopo e origem da divergência

Correção isolada de healthcheck. Não muda código de transcrição/ditado, Redis,
Prisma, eventos, webhooks, protocolos, ACKs, retries de negócio, perfis, imagens,
identidade RabbitMQ, volumes, limites de CPU/RAM, versões ou estado de serviços.

Na inspeção de 09/10/2026, `main` em `afceea41d34d156199f2a353a8da8de325a7c5bd`
declarava `rabbitmq-diagnostics -q ping` a cada 15s. `develop` em
`ca78e4783f7bd9eb6087812bb86b3a11269a7148` já declarava TCP local a cada 30s.
São fontes diferentes: não fazer merge integral de develop em main para este hotfix.
Cada PR parte da própria base, preservando inclusive os executores de áudio daquela
base. A continuidade das correções de desempenho pertence a outra PR.

O teste de imagem lê o mirror real `ghcr.io/wkarts/argws-connect-rabbitmq:management`,
resolve seu digest e verifica os executáveis nessa imagem; não substitui pelo RabbitMQ
público mais recente. No preflight AMD64: digest
`sha256:ddc75301edf58a8332934cf2d801be7cbf8d65c6458d747364a8046238ff1c89`,
`/usr/bin/bash` (GNU 5.2.21) e `/usr/bin/timeout` (coreutils 9.4).
Isso não identifica o image ID atualmente instalado em uma VPS. Uma imagem customizada
ou um digest diferente exige novo preflight, sem instalar ferramentas no broker ativo.

## Política

| Ambiente | Intervalo | Timeout externo | Retries do healthcheck | Carência |
|---|---:|---:|---:|---:|
| Produção, Fersoft produção, canonical, Dockge, CloudPanel, raiz e RabbitMQ isolado | 60s | 3s | 5 | 120s |
| Develop, Fersoft develop e homologation | 30s | 3s | 10 | 120s |

O develop já saudável conserva exatamente sua sondagem e cadência. Os demais
serviços e seus `depends_on: condition: service_healthy` são preservados. Os dois
arquivos Fersoft são derivados dos respectivos templates, pelo gerador já existente
em cada branch. O Compose de desenvolvimento que não declara RabbitMQ não ganha um
broker ou um serviço adicional por esta correção.

```yaml
healthcheck:
  test: ["CMD", "timeout", "${RABBITMQ_HEALTHCHECK_CONNECT_TIMEOUT:-2}", "bash", "-ec", "exec 3<>/dev/tcp/127.0.0.1/5672"]
  interval: ${RABBITMQ_HEALTHCHECK_INTERVAL:-60s}
  timeout: ${RABBITMQ_HEALTHCHECK_TIMEOUT:-3s}
  retries: ${RABBITMQ_HEALTHCHECK_RETRIES:-5}
  start_period: ${RABBITMQ_HEALTHCHECK_START_PERIOD:-120s}
```

Não usa `nc`, credenciais HTTP nem inicia uma VM Erlang a cada sondagem. O timeout
interno padrão de 2s é menor que o externo de 3s. Não acrescenta `start_interval`,
para não impor uma versão nova de Docker/Compose. `start_period` tolera falhas no
início; não obriga esperar 120s quando já houve sucesso. A detecção de falhas estáveis
fica menos frequente: 5 falhas a cada 60s podem levar aproximadamente cinco minutos.
Não há política nova de reinício automático do broker por ficar unhealthy.

TCP indica listener AMQP disponível, não autenticação correta, ausência de alarmes,
fila saudável, consumer ativo, confirmação de publicação ou processamento concluído.
Esses estados continuam sob observabilidade funcional e retries existentes. `ping`
também não provava tudo isso: pode passar com o runtime Erlang ativo e a aplicação
AMQP parada. Não trocar esta sondagem por uma chamada recorrente a toda a API de gestão.

## Verificar a instalação sem alterá-la

```bash
python3 scripts/audit-rabbitmq-healthcheck.py --container rabbitmq-argws-connect-production
python3 scripts/audit-rabbitmq-healthcheck.py --container rabbitmq-argws-connect-develop
```

O auditor identifica image ID, RepoDigests, hostname, volume de dados, labels do
projeto/serviço, caminhos Compose e healthcheck efetivo. Não lê ou imprime credenciais;
não faz pull, restart, stop, reset, alteração de filas ou edição de arquivos. Executa
somente a checagem de ferramentas e uma abertura/fechamento TCP local. Falhas impedem
considerar a imagem apta. Ele não modifica o container para instalar bash, timeout ou nc.

Para comparar com o resultado da interpolação, gere localmente e proteja o JSON de
`docker compose config --format json` usando os arquivos e o diretório identificados
pelos labels. Passe esse arquivo ao auditor por `--rendered-compose caminho.json`.
O auditor imprime apenas imagem e healthcheck desse serviço, não o conteúdo dos envs.
O resultado completo do Compose pode conter segredos e não deve ser publicado.

Prioridade de configuração: o runtime é a evidência do que está executando; o Compose
e seus overrides/envs explicam como foi criado; a branch é a fonte a reconciliar.
Editar um YAML ou fazer merge não muda automaticamente um container instalado.
Valores explícitos antigos nos envs/overrides podem manter a cadência anterior.

**Não recriar o broker às cegas.** Antes de uma aplicação operacional autorizada,
verifique hostname/nodename, diretório de dados e volume realmente montado. Um hostname
automático novo pode selecionar outra identidade Mnesia. Esta PR não troca esses
campos nem prescreve uma recriação automática. Não usar reset, purge, down -v, prune,
renomeação do nó, downgrade da imagem ou exclusão de volumes para aplicar healthcheck.

## Validação

`test/rabbitmq-healthcheck.test.py` encontra todos os Compose que declaram RabbitMQ,
valida o comando/cadências, listener aberto/fechado, interpolação real do Compose e
overrides. Compara os contratos com a base da PR, excluindo apenas o healthcheck do
broker: recursos, dependências, envs de recursos e código de negócio não podem mudar.
As expectativas históricas de healthcheck e os fingerprints de deploy são atualizados
somente para a alteração intencional, sem retirar verificações de áudio.

O workflow `RabbitMQ Healthcheck Integrity` verifica a imagem por digest em AMD64 e
ARM64, autentica AMQP, exercita `service_healthy`, publisher confirms, consumo com ACK,
eventos e webhooks locais de teste, ausência de duplicatas no fluxo normal e 100
mensagens persistentes confirmadas após recriação **exclusivamente do fixture de CI**.
Também executa os testes existentes de eventos/providers/áudio e do executor de cada
base. Nenhuma transcrição real de um usuário é iniciada por esse teste.

A comparação CLI/TCP usa seis sondagens de cada em ambiente descartável, com tempos,
latência dos eventos/jobs e amostras de CPU/memória do cgroup. São medições de CI, não
uma previsão do ganho na VPS. Há overhead de docker exec/amostragem, e o pico de memória
é cumulativo. Não são um teste de carga de produção nem garantia de exactly-once:
redelivery legítima continua possível, e a idempotência da aplicação é preservada.

Fontes oficiais:
- https://www.rabbitmq.com/docs/monitoring#health-checks
- https://docs.docker.com/reference/compose-file/services/#healthcheck
- https://docs.docker.com/compose/how-tos/startup-order/
