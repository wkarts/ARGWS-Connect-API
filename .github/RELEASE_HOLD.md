# Release suspensa: validação dos workers de áudio

Em 07/10/2026, o develop mostrou cerca de 2,43 GiB de RSS no worker de
ditado e 2,63 GiB no worker de transcrição, ambos ociosos. Os logs registram
timeout de heartbeat RabbitMQ nos dois workers; as métricas da API incluem
requisições de mensagem acima de seis minutos. A captura termina com saída
código 0 dos workers, portanto não identifica OOM nem a causa da parada.

Este arquivo impede publicação automática e manual pelo workflow
`auto-version-release.yml`. Não remova a trava apenas porque build e testes
unitários passaram. Para liberar uma versão, documente no PR de remoção:

- métricas do host e dos containers durante uma execução sustentada no develop,
  com RSS, `memory.current`, CPU, reinícios, eventos de OOM e orçamento da VPS;
- transcrição e ditado concluídos com áudio real, inclusive arquivos curtos,
  longos, inválidos, sem fala, cancelamento e pedidos simultâneos;
- recuperação de jobs interrompidos e publicação idempotente do resultado;
- ausência de perda de heartbeat e de degradação do envio/recebimento de
  mensagens e webhooks durante o ensaio;
- capacidade calculada para a soma das stacks que compartilharão cada host.

Mantenha a versão estável anterior enquanto a trava existir. Os jobs e dados
persistentes devem ser preservados durante qualquer ajuste de deploy.
