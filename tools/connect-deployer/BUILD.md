# Build do ARGWS Connect Deployer

## Windows — build local completo

Pré-requisitos no computador de compilação:

- Windows 10/11 x64;
- Node.js 22;
- Rust 1.90.0 via rustup;
- Microsoft C++ Build Tools / Visual Studio Build Tools;
- WebView2 Runtime;
- Docker Desktop com containers Linux (usado somente para gerar os agentes Linux amd64/arm64).

```powershell
.\scripts\bootstrap-windows.ps1
.\scripts\build-windows.ps1
```

Artefatos são copiados para `dist/release/`.

Se os dois agentes já estiverem em `src-tauri/embedded/`, use:

```powershell
.\scripts\build-windows.ps1 -SkipAgents
```

## GitHub Actions

O workflow `.github/workflows/build.yml`:

1. valida a árvore do projeto;
2. compila e testa agentes Linux estáticos amd64 e arm64;
3. embute os agentes no Desktop;
4. valida Vue/TypeScript e Rust;
5. gera bundles Windows, Linux e macOS;
6. em tag `v*`, publica GitHub Release e `SHA256SUMS.txt`.

Para produzir uma release:

```bash
git tag v2.0.0
git push origin v2.0.0
```

## VPS de destino

O VPS **não precisa** de Python, Node.js, Rust, Cargo ou Go. Ele precisa de:

- Linux amd64 ou arm64;
- SSH/SFTP;
- Docker Engine;
- Docker Compose v2;
- `clpctl` somente quando o deployment completo da Platform exigir CloudPanel.
