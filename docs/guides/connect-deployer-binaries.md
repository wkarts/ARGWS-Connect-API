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

## Build local

Execute os procedimentos em `tools/connect-deployer/BUILD.md` a partir da pasta da ferramenta. Dependências Rust/Node/Python dos scripts de build existem somente no computador/runner que compila; não são pré-requisitos do runtime do implantador. Não rode o build npm/Cargo a partir da raiz da API.

## Limites

Não há assinatura Authenticode ou notarização Apple; macOS usa assinatura ad-hoc, que não atesta um editor verificado. Windows depende do WebView2 e Linux desktop das bibliotecas gráficas indicadas pelos pacotes Tauri. Os agentes musl não têm essas dependências de interface.

UI/SSH e operações de produção precisam de homologação em um VPS autorizado. Nenhum teste de CI utiliza seus segredos ou implanta nos seus servidores. Os problemas de runtime de SSL/Grafana relatados anteriormente não são tratados por esta substituição isolada do implantador.
