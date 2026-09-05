# Entrega transportável

Este diretório é o projeto-fonte completo do **ARGWS Connect|API Deployer 2.0.0**.

## Para levar e compilar

### GitHub

1. crie um repositório vazio;
2. envie todo o conteúdo deste diretório;
3. abra **Actions → Build ARGWS Connect Deployer → Run workflow**;
4. baixe os artefatos `desktop-windows-x64`, `desktop-linux-x64` ou `desktop-macos-arm64`;
5. para publicar release, crie uma tag `v2.0.0`.

### Windows local

```powershell
.\scripts\bootstrap-windows.ps1
.\scripts\build-windows.ps1
```

O projeto compila os agentes Linux Rust, incorpora-os no Tauri e grava os artefatos em `dist/release/`.

## VPS

O destino não precisa de Python, Node.js, Rust, Cargo ou Go. O agente Linux é um binário temporário enviado por SSH/SFTP e removido ao final.

Consulte `README.md`, `BUILD.md`, `SECURITY.md` e `VALIDATION.md` antes do primeiro `Apply` em produção.
