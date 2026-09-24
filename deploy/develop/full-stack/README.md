# Full stack — develop

Alternativa ao deploy pai, nao um segundo stack simultaneo. Preserva nomes dos containers,
projeto e rede do perfil develop. Os dados padrao ficam em `../volumes`, no diretorio do deploy pai.
Nao execute as duas configuracoes ao mesmo tempo. Nao execute `down -v`.

## Atualizar uma instalacao existente

Faça backup privado do `.env`, dos dados e das chaves. Nesta pasta:

```bash
bash prepare-env.sh --from-env ../.env
bash deploy.sh
```

A importacao nao altera a origem. Preserva todos os parametros, senhas, chave da API e cofre Find Hub,
e resolve cada caminho relativo de volume contra o local ORIGINAL do `.env` importado.
Nao importe o `.env` de develop na producao. Se `.env` ja existe nesta pasta, o script recusa sobrescreve-lo.
Execute `bash prepare-env.sh --all-services` para habilitar novamente todos os opcionais.

## Instalacao nova

```bash
bash prepare-env.sh
bash deploy.sh
```

Segredos novos e independentes sao gerados localmente, uma unica vez. O arquivo recebe permissao 0600.
Instalacoes com dados anteriores devem importar o ambiente correspondente, nao criar senhas novas.

## Servicos

14 servicos: API/Manager, DOCs, PostgreSQL principal, Redis, RabbitMQ, MinIO, Operations,
NATS/JetStream, Kafka, ZooKeeper, MySQL auxiliar, Traccar, PostgreSQL Traccar e bootstrap Traccar.
O bootstrap e uma tarefa finita; terminar com codigo 0 e o resultado correto, nao um container quebrado.
O deploy prepara os binds vazios de MySQL/Kafka/ZooKeeper para o UID/GID real das imagens antes do start.
Nao usa chmod 777, chown recursivo, volumes nomeados novos ou banco em root. Diretorios com dados
ja gravados nunca tem dono alterado automaticamente; permissoes incompativeis interrompem o deploy.
Execute `python3 prepare-volumes.py` antes de um `docker compose up` manual.
`check-runtime.py` aguarda todos os servicos selecionados e testa API, MySQL, Kafka e NATS.
Se falhar, `full-stack-diagnostics.json` preserva o diagnostico sanitizado sem exportar o .env.
PostgreSQL permanece o banco principal; subir MySQL nao migra o banco da API.

`COMPOSE_PROFILES=operations,nats,kafka,mysql,traccar`. Cada recurso pode ser desabilitado
pelas flags `OPERATIONS_ENABLED`, `NATS_ENABLED`, `KAFKA_ENABLED`, `MYSQL_SERVICE_ENABLED`
e `TRACCAR_ENABLED`. Execute o preparador depois de editar flags para sincronizar profiles.
Traccar aceita `internal`, `external` ou `disabled`; externo nao inicia os containers internos.
No modo interno a API usa `http://traccar:8082`; o bootstrap utiliza as credenciais administrativas locais.
Uma chave da Connect API nao e um token Traccar. Se o token importado for igual a chave da API,
apenas esse token Traccar indevido e esvaziado para usar autenticacao administrativa interna.
Credenciais ja usadas por bancos ou Traccar NAO sao rotacionadas em atualizacoes.

Servicos cloud nao sao containers locais: SQS/Pusher e APIs de IA exigem as credenciais do titular.
Os modulos continuam disponiveis como no pai, mas nenhum destino global sem credenciais e inventado.
As configuracoes globais de eventos existentes nao sao alteradas silenciosamente.
Telemetria permanece desabilitada. Nao foram acrescentados Nginx/Traefik.

Somente a porta da API e publicada no host; Manager `/manager`, DOCs `/manager/docs`.
Nao e preciso expor Traccar, bancos, brokers, MinIO ou Operations publicamente.

## Imagens e compatibilidade

Este perfil conserva `develop` para API/DOCs; bases seguem o catalogo GHCR existente.
Novos endpoints/avatar/timeout exigem uma imagem com esta implementacao. Criar este deploy nao promove
`latest`, nao publica imagens nem modifica a versao canonica 1.1.3.
O perfil production usa somente a imagem estavel aprovada pelo operador.

`docker compose --env-file .env -f compose.yaml config --services` lista servicos selecionados sem imprimir segredos.
`config` sem `--quiet` pode revelar segredos; nao publique sua saida.
