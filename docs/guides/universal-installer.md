# Instalador universal — Connect|API

## Escopo

`install-connect.py` prepara e pode iniciar **os onze deployments runtime oficiais deste repositório**, a partir de fonte GitHub pública ou privada. Não é um instalador genérico de qualquer aplicação. Repositórios alternativos precisam manter a mesma estrutura `deploy/<tipo>/compose.yaml` (ou `docker-compose.yml`) e `env.example`.

Requisitos: VPS Linux, Python 3.10 ou superior, Docker Engine e Docker Compose v2 com saída JSON. Para a Platform com SSL automático, CloudPanel instalado nesse mesmo VPS, token Cloudflare autorizado e uma origem pública válida. O instalador não instala nem altera o sistema operacional, o Docker ou o CloudPanel. Pode instalar Dockge separadamente, mediante autorização explícita para o socket Docker.

O instalador não executa SQL, migrations, bootstrap, backup de dados, ACME ou clpctl. Essas responsabilidades continuam nos serviços. Não cria cron no VPS, não apaga volumes, não remove containers órfãos automaticamente e não executa `down -v`.

## Assistente interativo

Execute no VPS:

```bash
python3 install-connect.py
```

O assistente pergunta ambiente, deployment, versão, diretório, dados administrativos, domínio e origem DNS. Segredos são solicitados sem eco. Apresenta plano antes da confirmação. A opção padrão é apenas validar o plano; preparar e aplicar são escolhas explícitas.

Para instalações novas, senhas/chaves internas são geradas de modo consistente (incluindo senha usada dentro das URIs) e gravadas apenas no `.env` com permissão 0600. Integrações externas, como Cloudflare, exigem credenciais reais fornecidas pelo operador. Em atualizações nenhuma senha ou chave existente é rotacionada automaticamente.

## Selecionar deployment

| Opção | Ambiente | Conteúdo |
|---|---|---|
| `platform-develop` | develop | Produto completo + SSL por serviços + dois PgBouncer |
| `platform-production` | production | Produto completo usando release estável |
| `platform` | ambos | Stack multiperfil; seleciona platform + observability |
| `develop` | develop | API clássica e infraestrutura |
| `production` | production | API clássica estável |
| `canonical` | production | API clássica em SemVer |
| `homologation` | develop | API clássica de homologação |
| `cloudpanel` | production | Variante clássica, não é a Platform completa |
| `dockge` | production | Variante clássica para Dockge |
| `docs` | production | Somente documentação |
| `docs-develop` | develop | Somente documentação de desenvolvimento |

`--deployment auto` escolhe a Platform correspondente ao ambiente. A automação wildcard pertence às stacks Platform, não é inventada nas variantes clássicas. A seleção de production não converte uma imagem develop em uma release estável.

## Diretório e Dockge

O resultado ativo é apenas:

```text
/opt/stacks/argws-connect-platform-develop/
    compose.yaml
    .env
    .connect-install.json           # proveniência e estado, sem segredos
    .connect-installer-backups/     # snapshots de configuração, acesso restrito
    volumes/                       # criados/usados pelos serviços, nunca apagados
```

O caminho pai é livre. O nome final da pasta precisa corresponder a `COMPOSE_PROJECT_NAME`, para não criar divergência com o gerenciamento do Dockge. Um diretório existente não é movido nem renomeado automaticamente. O instalador bloqueia mudanças de volumes, portas, identidade de dados, nomes de serviços e project que exijam migração.

No Dockge já instalado, a pasta deve pertencer à raiz de stacks configurada no gerenciador. Use **Scan Stacks Folder** caso a nova stack ainda não apareça. Não há chamada a uma API privada/indocumentada do Dockge.

## Exemplos

Preparar o desenvolvimento a partir de um `.env` inicial já preenchido (não iniciar containers):

```bash
python3 install-connect.py --environment develop --version develop \
  --deployment platform-develop \
  --directory /opt/stacks/argws-connect-platform-develop \
  --env-input /caminho-seguro/connect-inicial.env \
  --accept-host-agent --prepare --yes
```

Atualizar a mesma stack preservando seu `.env` e seus dados:

```bash
python3 install-connect.py --environment develop --version develop \
  --deployment platform-develop \
  --directory /opt/stacks/argws-connect-platform-develop \
  --accept-host-agent --apply --yes
```

Selecionar a última release estável publicada, **somente quando ela já incluir os componentes necessários**:

```bash
python3 install-connect.py --environment production --version latest \
  --deployment platform-production \
  --directory /opt/stacks/argws-connect-platform-production \
  --accept-host-agent --apply
```

Uma versão específica é informada como `--version vX.Y.Z` com a SemVer real publicada. O instalador resolve o SHA da release, busca os templates naquele SHA e seleciona as tags correspondentes de aplicação. Não usa silenciosamente templates da develop com imagens de release antigas. Uma release sem a stack Platform/SSL/PgBouncer falha antes de atualizar containers.

O seletor altera somente as tags das imagens de aplicação conhecidas. As imagens de infraestrutura (PostgreSQL, Redis etc.) mantêm a configuração do deployment. Um `.env` preexistente pode fornecer nomes de registry/repositório próprios. O instalador verifica os manifests de **todas** as imagens selecionadas e sua arquitetura quando o registry oferece um índice multi-arch.

## GitHub privado e GHCR privado

Para um repositório privado:

```bash
python3 install-connect.py --repo minha-organizacao/ARGWS-Connect-API \
  --ask-github-token --environment develop --version develop
```

O token GitHub precisa de leitura do conteúdo do repositório. Também são aceitos `GH_TOKEN`/`GITHUB_TOKEN` já disponibilizados de forma segura no ambiente. Nenhum token é inserido em URL, argumento CLI, log, `.env` da aplicação ou relatório. Os arquivos são obtidos por HTTPS da API GitHub, sem seguir redirects, e verificados pelo hash Git de cada blob.

Para imagens privadas, o instalador utiliza a configuração Docker existente. `--registry-user SEU_USUARIO` solicita um token GHCR `read:packages` em campo oculto, efetua login com `--password-stdin` e usa um diretório de credenciais temporário, removido ao terminar. Esse login temporário não configura credenciais permanentes do Dockge; atualizações futuras pelo gerenciador precisam de autenticação própria ou compartilhamento explicitamente configurado conforme a documentação do Dockge. Não copiar tokens para o Compose da aplicação.

## Instalar Dockge opcionalmente

Adicione `--install-dockge --accept-docker-socket --dockge-directory /opt/dockge` à execução com `--apply`. Só um diretório novo/vazio é aceito. O serviço é independente, usa a mesma raiz de stacks e fica em **127.0.0.1:5001**, não exposto publicamente. Acesso externo ao gerenciador requer túnel ou proxy administrativo próprio; não se mistura ao domínio wildcard dos clientes.

Dockge e Docker Socket Proxy são fronteiras administrativas de confiança porque acessam o socket Docker. O CloudPanel Agent também equivale a root no VPS, mesmo com filesystem do container read-only e sem endpoint. O instalador exige consentimento separado para cada nova autorização e não amplia permissões de API, workers ou bancos.

## Atualização segura e limites

Antes de alterar arquivos: fonte fixada por SHA, integridade dos blobs, Compose válido, compatibilidade dos recursos existentes, manifests e canal de imagens. Antes de iniciar atualização: pull completo; no canal develop, labels de revisão dos componentes críticos precisam coincidir com o SHA selecionado. Uma publicação ainda parcial é bloqueada.

Snapshots persistentes guardam apenas Compose/`.env`/proveniência com permissões restritas. Não são backup de PostgreSQL ou MinIO. Mantenha o serviço de backup e a política de restauração de dados. Interrupção na gravação de configuração pode ser recuperada na próxima execução; após `up`, não existe rollback automático de banco nem downgrade cego, pois migrations podem ter ocorrido.

Códigos de saída: 0 para plano/preparo concluído ou serviços prontos; 2 para erro/validação; 3 para stack iniciada mas com serviços ainda pendentes/falhos; 130 para interrupção. `--wait-seconds` controla a espera inicial (padrão 180). Atraso na emissão SSL pode exceder esse tempo: a stack continua instalada e os serviços continuam tentando dentro de sua política.

**SERVICES_READY não equivale a homologação funcional completa**. Valide login, criação e pareamento de instâncias, permissões, usuários e tráfego real. O bundle de diagnóstico antigo de 05/09/2026 09:24 antecede a PR #60; ele não prova o resultado da instalação atualizada.

## Uma ação CloudPanel por ambiente

Desenvolvimento: `d.connect.argws.com.br` para `http://127.0.0.1:38802`.
Produção: `connect.argws.com.br` para `http://127.0.0.1:38800`.

Após criar o Reverse Proxy base e iniciar a stack, DNS/wildcard/SSL/Host/renovação são mantidos pelos serviços. O instalador não toma posse de VHosts de terceiros. Domínios externos arbitrários não são cobertos pelo wildcard.

## Referências técnicas

- Docker Compose: https://docs.docker.com/compose/how-tos/environment-variables/variable-interpolation/
- Docker Compose up: https://docs.docker.com/reference/cli/docker/compose/up/
- Dockge: https://github.com/louislam/dockge
- CloudPanel CLI: https://www.cloudpanel.io/docs/v2/cloudpanel-cli/root-user-commands/
- Cloudflare wildcard: https://developers.cloudflare.com/dns/manage-dns-records/reference/wildcard-dns-records/
