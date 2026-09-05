# Connect Deployer — desktop Tauri/Rust

## Escopo e origem

O implantador oficial em `tools/connect-deployer` substitui o launcher Python/Paramiko/PyInstaller pela versão **Tauri 2 + Rust + Vue 3/TypeScript 2.0.0** fornecida em `ARGWS-Connect-Deployer-Tauri-Rust-v2.0.0.zip`. É uma substituição da ferramenta de implantação, não uma migração do Engine ou da Platform. A origem e os hashes do anexo estão em `SOURCE-IMPORT.json`.

O `install-connect.py` da raiz permanece disponível como alternativa independente; não é executado ou embutido no desktop Rust. Seu exemplar em `reference/` é material de auditoria. API, Platform, Compose, migrations, PgBouncer, ACME e CloudPanel não são alterados por essa integração.

## Uso

Extraia o pacote da sua plataforma e abra **ARGWS Connect Deployer**. A interface gráfica permite configurar SSH/SFTP, autenticação e known_hosts; selecionar ambiente, versão, deployment e diretório; fornecer parâmetros de domínio/ACME; e executar **Plan, Prepare ou Apply**. Plan não sobe containers. Prepare escreve a configuração. Apply também inicia a stack e acompanha seus serviços. A aprovação de Apply é explícita.

Cada desktop contém **dois agentes Linux estáticos** (amd64 e arm64). O desktop identifica a arquitetura do VPS, envia o agente correspondente, relê-o por SFTP para verificar SHA-256 e executa seu self-test. A solicitação, incluindo credenciais, segue no stdin do canal SSH, não em argumentos remotos.

O computador local e o VPS **não precisam de Python para este implantador**. O VPS continua exigindo Linux amd64/arm64, SSH/SFTP, Docker e Compose v2; deployments completos da Platform exigem CloudPanel/clpctl conforme o contrato. A ferramenta não instala pacotes do sistema. O modo sudo utiliza `sudo -n`. Os recursos de SSL, banco, migrations, bootstrap e backup continuam pertencendo aos serviços da stack.

A UI solicita aprovação de host novo; chave SSH alterada bloqueia a operação. Tokens não são gravados em preferências. Não substitua produção por develop para contornar ausência de uma release estável.

## Compilação no GitHub

O workflow raiz continua se chamando **Connect Deployer - Build Binaries**, em `.github/workflows/connect-deployer-binaries.yml`. O workflow independente do anexo foi movido para `reference/upstream-tauri-build.yml` e não é executado: ele criava tags/releases próprias, incompatíveis com a governança do Connect|API.

O pipeline vincula a revisão ao projeto, compartilha os mesmos lockfiles entre jobs, compila/testa agentes musl em runners nativos amd64/arm64, verifica a ausência de loader dinâmico e produz os desktops Windows x64, Linux x64, Linux ARM64 e macOS ARM64. Não utiliza QEMU no pipeline integrado. Builds release sem os dois agentes são bloqueados.

Os pacotes incluem instaladores nativos, `BUILD-INFO.json`, origem do anexo, locks e checksums. O self-check offline executa o desktop real sem inicializar WebView/SSH/deploy, conferindo a identidade e os dois agentes incorporados. Isso não equivale a um deploy real ou teste completo da interface.

PRs e develop publicam **artifacts**; não criam release estável. Na promoção autorizada, a integração aditiva do workflow canônico anexa os pacotes à **mesma release do Connect|API**, sem recalcular SemVer, criar tag paralela ou sobrescrever assets. A versão do Deployer permanece 2.0.0 e `BUILD-INFO.json` também registra a versão e o commit da aplicação.

O artifact `connect-deployer-source` contém o código-fonte exato usado na compilação, seu commit, a árvore Git e o SHA-256 do ZIP. Em PRs, o GitHub testa o merge de validação; seu SHA pode diferir do head da branch. Consulte `SOURCE-COMMIT.txt` e `BUILD-INFO.json`. Esse artifact de fonte não representa binários aprovados: confirme também os jobs de compilação e verificação.

### Windows: Perl nativo no build OpenSSL

A dependência SSH utiliza OpenSSL vendored. O runner Windows pode oferecer dois intérpretes Perl: o nativo Strawberry e o MSYS do Git Bash. O MSYS não deve configurar o alvo `VC-WIN64A`; nos logs da PR #63 ele falhou com `Can't locate Locale/Maketext/Simple.pm`.

O workflow executa `tools/connect-deployer/scripts/prepare-windows-toolchain.ps1` em PowerShell 7, valida o intérprete nativo e os módulos `IPC::Cmd` e `Locale::Maketext::Simple`, verifica MSVC/NMake x64 e define `OPENSSL_SRC_PERL` e `PERL` por caminho absoluto. A compilação Windows usa `pwsh` e `npm.cmd`, sem depender da prioridade de PATH do Git Bash. Falhas do preflight ou da compilação interrompem o job; não há `continue-on-error`, remoção da criptografia ou descarte do Windows na matriz.

Strawberry Perl e MSVC pertencem somente à máquina que compila. Não são requisitos do computador que usa o executável nem do VPS. O preflight não instala programas, não abre SSH e não altera a stack.

## Build local

Execute os procedimentos em `tools/connect-deployer/BUILD.md` a partir da pasta da ferramenta. Dependências Rust/Node/Python dos scripts de build existem somente no computador/runner que compila; não são pré-requisitos do runtime do implantador. Não rode o build npm/Cargo a partir da raiz da API.

Para configurar a sessão local do Windows antes do build, execute em PowerShell 7, dentro de `tools/connect-deployer`:

```powershell
. ./scripts/prepare-windows-toolchain.ps1
npm.cmd run tauri:build -- --config src-tauri/tauri.windows.conf.json -- --locked
```

Instale previamente os requisitos de compilação e prepare os dois agentes conforme `BUILD.md`. O ponto inicial faz o dot-source do preflight, mantendo as variáveis na sessão. Instalações de Perl em outro caminho podem usar `-PerlPath 'C:\caminho\perl.exe'`; o intérprete ainda precisa passar pela validação nativa.

## Limites

Não há assinatura Authenticode ou notarização Apple; macOS usa assinatura ad-hoc, que não atesta um editor verificado. Windows depende do WebView2 e Linux desktop das bibliotecas gráficas indicadas pelos pacotes Tauri. Os agentes musl não têm essas dependências de interface.

UI/SSH e operações de produção precisam de homologação em um VPS autorizado. Nenhum teste de CI utiliza seus segredos ou implanta nos seus servidores. Os problemas de runtime de SSL/Grafana relatados anteriormente não são tratados por esta substituição isolada do implantador.
