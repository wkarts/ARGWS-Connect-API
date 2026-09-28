# Fersoft - develop - full stack (14 servicos)

Este deploy e independente do outro canal Fersoft. Projeto, rede, banco, porta e dados nao sao compartilhados.
Somente a API publica porta no host; Manager e DOCs ficam em /manager e /manager/docs.

As referencias de imagem sao herdadas sem alteracao de deploy/develop/full-stack; nao ha politica, tag ou workflow GHCR Fersoft.
Dados: ../volumes.
Nunca execute down -v, chmod 777 ou chown -R.

Instalar:
  ./prepare-env.sh
  ./deploy.sh

Atualizar:
  ./update.sh

Recuperar uma full stack configurada com todos os 14 servicos, sem remover dados ou trocar segredos:
  ./recover-full-stack.sh

Antes de iniciar Kafka, ZooKeeper e MySQL, os scripts preparam apenas binds vazios para o UID/GID real
das imagens. Diretorios ja gravados e sem permissao sao recusados sem alteracao; a stack nao e marcada como
saudavel ate que os probes reais passem. O bootstrap Traccar esta incorporado ao proprio `compose.yaml`;
o runtime nao requer arquivo de codigo externo. Leia MIGRACAO-FULL-STACK-FERSOFT.md antes de migrar um pacote Fersoft anterior.
