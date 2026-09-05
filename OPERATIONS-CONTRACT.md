# Contrato operacional — ARGWS Connect API

Este contrato registra as decisões de Wallace e deve ser lido antes de qualquer alteração operacional, por desenvolvedores e agentes.

## Deploy e responsabilidades

O operador usa somente o `compose.yaml` da stack escolhida e seu `.env`, inclusive no Dockge/Portainer. Preservar os nomes de project, services, networks, volumes, portas e domínios existentes. Não introduzir overlays ou arquivos adicionais obrigatórios para o deploy.

Migrations, bootstrap, provisionamento, tarefas agendadas e backups pertencem aos serviços da aplicação. Configurações necessárias ao PgBouncer são produzidas dentro da própria imagem. Não transferir essas responsabilidades para scripts executados no host.

Scripts `.sh`, aplicadores e comandos SQL manuais existentes são retaguarda emergencial, não o procedimento normal. Comandos de build/teste em CI não são instruções operacionais para o usuário.

Atualizar significa selecionar as imagens homologadas e atualizar a stack no gerenciador existente. Os serviços executam as etapas ordenadas por dependências e healthchecks. Não instalar atualizadores autônomos que promovam imagens não homologadas nem executar `down -v`.

## GitHub e entrega

Partir da `develop` remota atual, criar uma branch específica, implementar, testar e abrir PR para `develop`. Só fazer merge depois de confirmar os testes aplicáveis e registrar a homologação. Não ignorar CI vermelho/pendente, não fazer force-push e não alterar `main` ou publicar release sem uma promoção separada autorizada.

Entregar o projeto completo atualizado, além de identificar branch, commits, PR, testes executados e pendências reais. Uma mudança local, objeto Git ou arquivo ZIP não equivale a commit remoto, merge, imagem publicada ou deploy realizado.

## Banco e disponibilidade

Separar conexão de runtime, via PgBouncer, da conexão administrativa direta. Migrations, criação de bancos/roles e backups não passam pelo pool transacional. Manter database-per-tenant e credenciais individuais; nunca reunir clientes sob um usuário administrativo comum.

Aplicar pools e filas finitos, timeouts e contrapressão. Não aumentar `max_connections` como única solução. Limites por banco do PgBouncer não são um limite agregado do cluster: dimensionar a soma entre bancos, usuários, processos e réplicas, preservando capacidade administrativa.

Indisponibilidade temporária deve produzir erro controlado, sem reiniciar a API, revelar credenciais ou repetir automaticamente gravações. Não prometer imunidade absoluta a falhas.
