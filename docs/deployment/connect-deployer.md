# Gerador de deploy do Connect|API

O repositório agora possui um gerador portátil em `tools/connect-deployer`. Ele centraliza a preparação dos deploys para que o operador escolha o flavor e os módulos e receba um stack pronto para o Docker Compose.

O fluxo recomendado é:

1. executar `plan` para revisar flavor, módulos e autenticação do Traccar;
2. executar `generate` em um diretório novo;
3. executar `validate` antes de copiar o diretório para Dockge ou CloudPanel;
4. no servidor, usar apenas `docker compose config -q` e `docker compose up -d`.

O gerador mantém a ordem do `.env` importado e não depende de scripts auxiliares no servidor. Em instalações novas ele gera segredos fortes. Em instalações existentes ele preserva credenciais preenchidas e não toca nos volumes.

O padrão do Traccar é autenticação administrativa interna. Portanto `TRACCAR_TOKEN` permanece vazio. A chave `AUTHENTICATION_API_KEY` do Connect|API nunca deve ser copiada para `TRACCAR_TOKEN`; o gerador bloqueia essa combinação.
