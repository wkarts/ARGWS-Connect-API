# Build integrado do ARGWS Connect Deployer

O projeto desktop fica em `tools/connect-deployer` dentro do repositório **ARGWS-Connect-API**. A versão 2.0.0 identifica a ferramenta; não altera a versão canônica da API.

## GitHub Actions — distribuição oficial

O workflow ativo é **Connect Deployer - Build Binaries**, em `.github/workflows/connect-deployer-binaries.yml` na raiz do repositório.

Ele valida a revisão, usa `Cargo.lock` e `package-lock.json` versionados, compila e testa os agentes Linux musl AMD64/ARM64 em runners nativos, incorpora ambos ao desktop e gera Windows x64, Linux x64/ARM64 e macOS ARM64. Os pacotes incluem os instaladores, metadados de revisão/canal e SHA-256.

PRs e `develop` produzem artifacts. A execução manual fica disponível quando o workflow estiver presente na branch padrão. A promoção estável autorizada da aplicação chama esse mesmo workflow e anexa os pacotes à **release existente do Connect|API**.

**Não crie uma tag `v2.0.0` na raiz para publicar o implantador. Não há release ou versionamento independente.** O workflow do anexo foi arquivado em `reference/upstream-tauri-build.yml` e não é executado.

## Compilação local

Execute os comandos dentro de `tools/connect-deployer`, não na raiz da API. As dependências de compilação não são requisitos do computador que usa o binário nem do VPS.

Windows: Node.js 22, Rust 1.90.0 com MSVC/C++ Build Tools, WebView2 e Docker Desktop em modo Linux para compilar os agentes.

```powershell
.\scripts\build-windows.ps1
```

Linux/macOS, com dependências Tauri da plataforma, Node.js 22, Rust 1.90.0 e Docker:

```bash
./scripts/build-linux.sh
# No macOS:
./scripts/build-macos.sh
```

Os auxiliares locais do anexo constroem os agentes antes do desktop. Com os agentes já compilados, use `-SkipAgents` no PowerShell ou `--skip-agents` no Linux/macOS. Ambos devem existir em `src-tauri/embedded/agent-linux-amd64` e `src-tauri/embedded/agent-linux-arm64`. Um release com apenas AMD64 é recusado.

A sintaxe para encaminhar argumentos ao Cargo pela CLI Tauri é:

```bash
npm run tauri:build -- --config src-tauri/tauri.linux.conf.json -- --locked
```

Os auxiliares locais coletam saídas em `dist/release/`. Os metadados de origem e os testes completos de distribuição são gerados pelo workflow integrado; uma compilação local não equivale automaticamente a um artifact homologado do CI.

## VPS de destino

Linux AMD64/ARM64, SSH/SFTP, Docker Engine e Docker Compose v2; CloudPanel/clpctl conforme o deployment. O agente remoto Rust é estático e não exige Python, Node.js, Rust/Cargo ou Go instalados no VPS. Migrations, SSL e backups continuam nos serviços da stack.
