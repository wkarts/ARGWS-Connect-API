# ARGWS Connect|API Deployer

Implantador opcional do repositório `wkarts/ARGWS-Connect-API`, integrado em
`tools/connect-deployer` a partir do pacote fornecido por Wallace.
O executável `connect-deploy` / `connect-deploy.exe` usa o cliente SSH Paramiko e o
payload modificado do anexo. Não refatora o Engine, a Platform, PgBouncer, ACME,
CloudPanel, Compose, migrations ou o `install-connect.py` da raiz.

## Arquitetura preservada

```text
Windows / Linux / macOS
  connect-deploy(.exe)
        |
        | SSH / Paramiko / validação known_hosts
        | SFTP para diretório temporário 0700
        v
VPS Linux
  install-connect.py embutido (payload 1.0.1)
  env.input / tokens opcionais (arquivos 0600)
        |
        v
  Python 3.10+ e Docker Compose locais do VPS
        |
        +-- Connect|API Platform / Engine
        +-- PgBouncer
        +-- ACME / CloudPanel Agent
        +-- Dockge opcional
```

O computador que executa o binário dispensa Python instalado. O VPS de destino
continua precisando de Python 3.10+, Docker/Compose e CloudPanel para a stack que
exige `clpctl`. O launcher não instala o sistema operacional, Docker ou CloudPanel.
SSL, migrations, bootstrap e backups continuam nos serviços. O modo local executa
esse mesmo payload no Linux; Windows e macOS usam o modo SSH.

## Binários no GitHub

Workflow na raiz: **Connect Deployer - Build Binaries**
(`.github/workflows/connect-deployer-binaries.yml`).

| Evento | Distribuição |
|---|---|
| PR para develop/main com alteração pertinente | Quatro pacotes em Actions > execução > Artifacts |
| Push pertinente em develop | Artefatos de desenvolvimento identificados pelo SHA |
| Execução manual | Artefatos da branch selecionada, sem release |
| Release estável do Connect\|API | Pacotes anexados à mesma release da aplicação |

A matriz compila nativamente Windows x86_64, Linux x86_64, Linux ARM64 e macOS
ARM64. O workflow standalone do anexo não é instalado: não há tag/release paralela.
A chamada reutilizável é feita pelo workflow canônico após a release existir;
ela não recalcula SemVer, não modifica as notas e não sobrescreve assets.
Uma PR nunca publica release. Nenhum executável compilado é versionado no Git.

O botão manual depende de o workflow existir na branch padrão do repositório.
Enquanto a integração estiver somente na PR, utilize os artefatos automáticos.

## Conteúdo dos pacotes

```text
connect-deploy-<VERSION>-<canal>-<sha12>-<sistema>-<arquitetura>.zip
connect-deploy-<VERSION>-<canal>-<sha12>-<sistema>-<arquitetura>.zip.sha256
```

O ZIP inclui executável, `BUILD-INFO.json`, `SHA256SUMS.txt`, inventário de
bibliotecas, licenças e documentação. Um artifact `connect-deployer-manifest`
consolida os hashes dos quatro pacotes. Permissões executáveis são preservadas.

A identidade utiliza `VERSION` do Connect|API e o SHA exato. As versões internas
1.0.0 do launcher e 1.0.1 do payload são preservadas do anexo; não são releases
concorrentes. A versão a implantar no VPS é escolhida separadamente depois de `--`.

```powershell
.\connect-deploy.exe --version
.\connect-deploy.exe --build-info
.\connect-deploy.exe --self-check
```

`--self-check` verifica o payload e exercita SSH/criptografia sem rede ou deploy.

## Usar por SSH

Validação de uma stack existente, sem aplicar alterações:

```powershell
.\connect-deploy.exe ssh `
  --host SEU_VPS `
  --user deploy `
  --key-file "$HOME\.ssh\id_ed25519" `
  -- `
  --environment develop `
  --version develop `
  --deployment platform-develop `
  --directory /opt/stacks/argws-connect-platform-develop `
  --accept-host-agent
```

Antes de `--` ficam as opções do launcher; depois, as do instalador.
Sem `--prepare` ou `--apply`, o payload somente valida o plano.
`--accept-host-agent` reconhece explicitamente o acesso administrativo do agente
CloudPanel mesmo quando o plano ainda não será aplicado.

Para instalação nova, `--env-input .\production.env` antes do separador envia o
arquivo local temporariamente; ele não pode substituir o `.env` existente.
Para responder aos prompts do instalador, acrescente `--interactive` antes do
separador. Para aplicar após revisar o plano, use `--apply` no payload e confirme
os prompts, ou `--yes` quando todos os parâmetros já foram revisados.

Produção usa `--environment production --version latest --deployment platform-production`
e o diretório correspondente. Exige uma release estável publicada com os serviços
necessários. O binário não promove a aplicação nem substitui produção por develop.

### Autenticação e segredos

Por padrão, hosts desconhecidos ou com chave divergente são recusados. Valide a
fingerprint por canal confiável antes do primeiro `--accept-new-host-key`;
uma alteração posterior continua sendo bloqueada. Prefira chave Ed25519 e
usuário dedicado. `--ask-password` solicita a senha SSH com entrada oculta.

`--ask-github-token` antes do separador solicita o token GitHub localmente e usa
`GH_TOKEN_FILE` remoto. O parâmetro `--registry-user` do payload solicita o token
GHCR localmente e usa `ARGWS_CONNECT_GHCR_TOKEN_FILE`. Nenhum token é enviado como
valor em argumento de comando; os arquivos remotos usam modo 0600.
A limpeza é tentada ao final; falhas de conexão/limpeza produzem aviso e podem
exigir remover os temporários remanescentes por administração do VPS.

`--sudo` usa somente `sudo -n`, previamente autorizado. Não recebe nem injeta
senha sudo. Para instalar Dockge, permanecem obrigatórias as autorizações
`--install-dockge --accept-docker-socket --accept-host-agent` do payload.

## Uso local no VPS

```bash
./connect-deploy local -- --help
```

Requer o Python do sistema no VPS. A delegação restaura os caminhos de bibliotecas
alterados pelo PyInstaller antes de iniciar esse Python. Não usa o interpretador
embutido como substituto do Docker ou do CloudPanel.

## Compilar localmente

Use um checkout Git completo do Connect|API. A partir de `tools/connect-deployer`:

```powershell
# Windows: Python Launcher e Python 3.12
.\scripts\build-windows.ps1
# Alternativa: scripts\build-windows.bat
```

```bash
# Linux ou macOS com Python 3.10+
./scripts/build-linux.sh
# macOS: ./scripts/build-macos.sh
```

Cada script cria virtualenv, instala dependências de build, gera metadados,
executa testes, compila com PyInstaller, testa o executável fora da árvore e
produz `dist/release/`. São ferramentas de compilação, não rotinas operacionais
obrigatórias no VPS.

## Integridade do payload

`reference/install-connect-original.py` deve continuar idêntico ao instalador da
raiz. Se o canônico mudar, o CI bloqueia a compilação até revisão da adaptação SSH.
O payload 1.0.1 do anexo não é substituído silenciosamente. `SOURCE-IMPORT.json`
registra o ZIP de origem, hashes dos arquivos recebidos e a revisão-base.

## Compatibilidade e limites

Linux é compilado em Ubuntu 22.04 (x86_64 e ARM64, glibc 2.35), não em Alpine/musl.
macOS usa runner 14 Apple Silicon. Windows usa runner Server 2022 x64. A compilação
nativa e o smoke test não garantem compatibilidade com todo sistema operacional
ou implantação real no VPS. CI não usa credenciais privadas do operador.

Não há assinatura Authenticode ou notarização Apple nesta entrega. O checksum
verificado contra uma origem confiável detecta alteração, mas não substitui uma
assinatura de publicador. Veja `SECURITY.md` e o guia da aplicação em
`docs/guides/connect-deployer-binaries.md`.
