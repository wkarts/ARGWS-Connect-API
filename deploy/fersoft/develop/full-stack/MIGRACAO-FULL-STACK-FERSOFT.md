# Migracao Fersoft full stack - develop

O pacote antigo iniciava MySQL, Kafka e ZooKeeper sem preparar os binds. Este perfil preserva o projeto
fersoft-connect-develop, a rede e os dados existentes em ../volumes, mas executa a preparacao segura antes do start.

1. Faça backup privado do .env, volumes e chaves.
2. Copie este diretorio full-stack para dentro da instalacao Fersoft atual.
3. No novo diretorio, execute:
   bash prepare-env.sh --from-env ../.env
   bash deploy.sh

A importacao preserva senhas, chaves, caminhos e configuracoes. Production aplica somente GHCR
as mesmas referencias do template ARGWS de production; develop faz o mesmo com o template de develop.

Se prepare-volumes.py recusar um diretorio nao vazio sem permissao, nenhum dado foi alterado. Preserve e
inspecione antes de qualquer acao manual. Nunca apague volumes, use chmod 777 ou chown recursivo para esconder
a falha.
