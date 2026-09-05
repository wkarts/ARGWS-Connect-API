# ARGWS Connect|API Deployer — Tauri/Rust 2.0.0

Implantador gráfico do **Connect|API**, integrado ao repositório principal em `tools/connect-deployer`. Substitui o launcher Python/Paramiko/PyInstaller por **Tauri 2, Rust e Vue 3/TypeScript**, usando o projeto fornecido por Wallace.

## Funcionamento

```text
Desktop Tauri / Vue
    -> Core Rust SSH/SFTP
    -> Agente Rust estático Linux AMD64 ou ARM64
    -> GitHub / GHCR / Docker Compose
    -> Serviços do Connect|API
```

Cada desktop contém os dois agentes Linux. A arquitetura do VPS é detectada por SSH; o agente correspondente é transferido para um diretório temporário privado, relido por SFTP para verificar SHA-256 e validado por self-test antes da operação. A solicitação segue por stdin, não em argumentos remotos. O temporário é removido ao finalizar, com aviso em caso de falha de limpeza.

**O computador do operador e o VPS não precisam de Python para este implantador.** O VPS também não requer Node.js, Rust/Cargo ou Go. Linux AMD64/ARM64, SSH/SFTP, Docker Engine e Compose v2 continuam obrigatórios. Os deployments completos da Platform exigem CloudPanel/clpctl conforme o contrato. O Deployer não instala pacotes do sistema operacional.

## Interface e operação

A interface recebida foi preservada. Ela permite informar SSH (host, porta, usuário, senha, chave ou SSH Agent), testar conexão, conferir fingerprint/known_hosts, consultar o pré-flight, escolher ambiente, versão, deployment e diretório, fornecer parâmetros de Platform/ACME/Cloudflare e credenciais de GitHub/GHCR privados, autorizar o agente de host e a instalação opcional do Dockge.

**Plan** valida e apresenta o plano, sem gravar a stack ou subir containers. **Prepare** grava a configuração. **Apply** também inicia a stack e acompanha readiness/health após baixar as imagens. Revise o plano e o recibo; não trate serviços pendentes como implantação saudável.

Migrations, bootstrap, provisionamento, SSL e backups continuam nos serviços. O `install-connect.py` canônico da raiz permanece disponível como alternativa independente: o desktop Rust não o executa nem o incorpora. O exemplar em `reference/install-connect-python-original.py` é material de auditoria.

## Segurança e preservação de dados

Chave SSH conhecida e diferente bloqueia a conexão. Host novo exige aprovação explícita após conferência da fingerprint por canal confiável. Sudo usa somente `sudo -n`: a ferramenta não solicita nem armazena senha de sudo.

Os tokens passam pela memória da interface e do Rust, não são gravados em preferências ou argumentos remotos. Um `.env` local é lido pelo Rust e encaminhado via stdin; a interface recebe apenas o caminho. O login GHCR usa configuração temporária, sem alterar helpers persistentes. Isso não configura autenticação permanente no Dockge.

O agente valida fontes por commit e hashes Git, confere manifests/arquitetura, recusa build local e Docker remoto no Apply, protege nomes/volumes/portas e não substitui `.env` existente por um arquivo local. Produção não aceita `develop` como fallback. Alterações destrutivas são bloqueadas. Backup/journal do instalador é de **configuração**, não dos bancos ou armazenamento.

O CloudPanel Agent e a eventual instalação do Dockge exigem consentimento para os privilégios correspondentes. Consulte `SECURITY.md` e o `OPERATIONS-CONTRACT.md` da aplicação antes de operar.

## Compilação e distribuição

Workflow ativo: **Connect Deployer - Build Binaries**, em `.github/workflows/connect-deployer-binaries.yml` na raiz do Connect|API. Compila agentes musl nativos AMD64/ARM64 e desktops Windows x64, Linux x64/ARM64 e macOS ARM64. Releases do desktop sem os dois agentes são recusados.

Os artifacts incluem executável, instaladores, `BUILD-INFO.json`, locks de dependências, origem e checksums. A versão 2.0.0 da ferramenta é distinguida da versão canônica da aplicação. PR/develop geram artifacts; a promoção estável autorizada anexa os pacotes à **mesma release existente do Connect|API**. **Não crie uma tag `v2.0.0` da aplicação para publicar somente o implantador.**

O workflow standalone e a documentação recebida permanecem em `reference/` como histórico, não como procedimento ativo. Consulte `BUILD.md` para compilação local e `DELIVERY.md` para distribuição integrada.

## Validação e limites

O pipeline valida agentes estáticos, compila Vue/TypeScript e os desktops, executa um self-check offline do binário real sem abrir WebView ou SSH e confere os checksums. Resultados concretos ficam nos checks da PR; consulte `VALIDATION.md`.

Não há assinatura Authenticode ou notarização Apple. A assinatura macOS ad-hoc não comprova um editor verificado. Windows depende do WebView2; Linux desktop depende das bibliotecas gráficas do pacote Tauri. Os agentes musl do VPS não exigem essas dependências gráficas.

Compilação e self-check offline não substituem teste interativo da interface nem implantação SSH real. A integração não usa credenciais operacionais, não acessa seu VPS e não corrige por si só incidentes dos serviços da aplicação.
