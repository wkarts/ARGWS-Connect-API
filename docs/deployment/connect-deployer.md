# Gerador de deploy do Connect|API

O repositório agora possui um gerador portátil em `tools/connect-deployer`. Os artefatos distribuídos são `argws-connect-deployer-win-x64.exe` (CLI) e `argws-connect-deployer-gui-win-x64.exe` (interface gráfica), ambos compilados nativamente em Rust e sem Node.js embutido. A CLI atual permanece preservada; a GUI usa o mesmo núcleo de preparação e validação.

O fluxo recomendado é:

1. executar `plan` para revisar flavor, módulos e autenticação do Traccar;
2. executar `generate` em um diretório novo;
3. executar `validate` antes de copiar o diretório para Dockge ou CloudPanel;
4. no servidor, usar apenas `docker compose config -q` e `docker compose up -d`.

O gerador mantém a ordem do `.env` importado e não depende de scripts auxiliares no servidor. Em instalações novas ele gera segredos fortes. Em instalações existentes ele preserva credenciais preenchidas e não toca nos volumes.

O padrão do Traccar é autenticação administrativa interna. Portanto `TRACCAR_TOKEN` permanece vazio. A chave `AUTHENTICATION_API_KEY` do Connect|API nunca deve ser copiada para `TRACCAR_TOKEN`; o gerador bloqueia essa combinação.

O binário reutiliza os quatro PNGs de ícone do `Connect-FindHub-Auth-Assistant` ao montar o recurso Windows. A pré-release contínua `connect-api-develop` substitui o executável a cada build de `develop`; não são criadas tags separadas para o componente.

Para uso visual, abra o executável `argws-connect-deployer-gui-win-x64.exe`, escolha
o flavor, módulos e pasta de saída, clique em **Preparar stack** e depois em
**Validar pasta**. A interface não executa deploy remoto.
