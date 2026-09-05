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

## SSL wildcard no CloudPanel (contrato do produto)

O modelo canônico é o mesmo adotado no Scheduler Pro: um único Reverse Proxy base por stack, com ACME DNS-01 Cloudflare e CloudPanel Agent dentro da stack. DNS wildcard deve ficar DNS-only; os serviços emitem/renovam, ajustam `server_name`, preservam `Host`, validam NGINX, instalam com `clpctl` e verificam o certificado servido. Não exigir edição de VHost, instalação manual de certificado ou script no VPS.

O agente com acesso administrativo ao host não publica portas/endpoints. Falhas devem preservar o certificado/configuração anterior; emissão local não equivale a SSL ativo. Ver `docs/guides/platform-ssl-instances-corrective.md` para domínios, pré-requisitos, limites de wildcard e homologação.

## Instalador universal autorizado

`install-connect.py` é uma opção explícita de instalação/atualização solicitada por Wallace. Pode obter fontes públicas/privadas, selecionar ambiente/release, validar imagens, preparar `compose.yaml` + `.env` no diretório da stack e executar Compose. Não assume responsabilidades de ACME, clpctl, migrations, bootstrap ou backup de dados, que continuam nos serviços. Não remove volumes nem faz downgrade automático de bancos. Preserva segredos existentes; impede troca silenciosa de produção para develop. Exige aprovação explícita para o agente de host e eventual instalação separada do Dockge.

O Docker Socket Proxy da observabilidade e o próprio Dockge continuam fronteiras administrativas de confiança. `POST=0` ou uma montagem `:ro` não retiram o acesso potencial ao socket bruto. Não declarar exclusividade absoluta de root-equivalence sem redesenhar essa integração.
