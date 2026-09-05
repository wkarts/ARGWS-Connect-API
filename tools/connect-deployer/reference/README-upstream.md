# ARGWS Connect|API Deployer

Implantador desktop do **ARGWS Connect|API**, construído com **Tauri 2 + Rust + Vue 3 + TypeScript**.

O objetivo deste projeto é permitir que um operador abra uma aplicação desktop, informe o VPS e implante ou atualize o Connect|API por SSH **sem instalar Python, Node.js, Rust ou Go no servidor**.

> A lógica funcional foi portada a partir do `install-connect.py` fornecido como referência. A cópia original está preservada em `reference/install-connect-python-original.py` para auditoria e comparação.

## Arquitetura

```text
┌───────────────────────────────────────────────────────────────┐
│ Desktop                                                       │
│                                                               │
│ ARGWS Connect|API Deployer                                    │
│ Tauri 2 + Vue 3 + TypeScript                                  │
│                    │                                          │
│                    ▼                                          │
│               Rust Desktop Core                               │
│        SSH / SFTP / known_hosts / SHA-256                     │
└────────────────────┬──────────────────────────────────────────┘
                     │ SSH/SFTP
                     ▼
┌───────────────────────────────────────────────────────────────┐
│ VPS Linux                                                     │
│                                                               │
│ /tmp/argws-connect-deployer-<uuid>/                            │
│        connect-deploy-agent  ← binário Rust estático          │
│                    │                                          │
│                    ├─ GitHub API                              │
│                    ├─ Docker / Compose v2                     │
│                    ├─ GHCR                                    │
│                    ├─ validação da configuração               │
│                    ├─ backup transacional                     │
│                    └─ readiness/health                        │
│                                                               │
│ O agente temporário é removido ao finalizar.                  │
└───────────────────────────────────────────────────────────────┘
```

O executável desktop contém dois agentes Linux:

- `linux-amd64` (`x86_64-unknown-linux-musl`)
- `linux-arm64` (`aarch64-unknown-linux-musl`)

A arquitetura do VPS é detectada por SSH e o agente correto é transferido automaticamente.

## O que NÃO precisa existir no VPS

O servidor **não precisa** de:

- Python / pip / venv;
- Node.js / npm;
- Rust / Cargo;
- Go;
- Git;
- `curl` / `wget` / `jq`;
- `sha256sum` ou `shasum` para validar o agente.

A validação SHA-256 do agente enviado é feita pelo próprio desktop relendo o arquivo via SFTP antes da execução.

## Requisitos do VPS

Para deploy normal:

- Linux `amd64` ou `arm64`;
- servidor SSH/SFTP;
- Docker Engine;
- Docker Compose v2 (`docker compose`).

Para `platform-production` / `platform-develop` completos:

- CloudPanel instalado;
- `clpctl` disponível, conforme o deployment da Platform.

O Deployer **não instala pacotes do sistema operacional**. Essa separação é intencional.

## Regras de segurança preservadas

O agente Rust mantém as principais proteções do instalador Python original:

- produção não aceita `develop`;
- `latest` em produção resolve apenas release estável publicada;
- arquivos do GitHub são obtidos por commit imutável;
- integridade Git blob SHA-1 é validada;
- build local no Compose é bloqueado;
- imagens são validadas antes da atualização;
- arquitetura das imagens é conferida;
- `.env` existente não é substituído por um arquivo local;
- placeholders `CHANGE_ME*` são bloqueados em atualização;
- alteração silenciosa de volumes, portas ou identidade de dados é bloqueada;
- mudança do nome do Compose project é bloqueada;
- diretórios de stack perigosos, `.`/`..` e symlinks são rejeitados;
- gravação da configuração possui backup/journal e recuperação;
- nenhum rollback destrutivo de banco é executado;
- Docker remoto (`DOCKER_HOST`/context remoto) é recusado no `apply`;
- CloudPanel Agent exige autorização explícita;
- Dockge exige autorização explícita ao Docker socket;
- `sudo` somente é utilizado com `sudo -n`; senha de sudo não é solicitada nem armazenada.

## Segredos

### `.env`

Ao escolher um `.env` na UI, o frontend envia apenas o **caminho local** ao comando Tauri. O backend Rust lê o arquivo e o encaminha ao agente por `stdin` no canal SSH. O conteúdo não é salvo pela aplicação desktop.

### Tokens digitados na UI

Tokens GitHub, GHCR e Cloudflare passam pela memória da UI porque são digitados nela e seguem pelo IPC do Tauri para o Rust. Eles:

- não são colocados em argumentos de linha de comando remotos;
- não são registrados nos logs;
- não são persistidos em arquivo de preferências pelo projeto;
- são enviados no JSON pelo `stdin` do agente SSH;
- têm representação `Debug` redigida no Rust.

O login GHCR é feito em um `DOCKER_CONFIG` temporário `0700/0600`, preservando configurações existentes aplicáveis e removendo o credential helper do `ghcr.io` apenas na cópia temporária.

## known_hosts

A conexão SSH é **fail-closed**:

- chave conhecida e igual: permite conexão;
- chave conhecida e diferente: bloqueia por possível MITM;
- host novo: bloqueia por padrão e mostra a fingerprint SHA-256;
- a UI possui opção explícita para confiar em host novo.

A opção de confiar em host novo deve ser usada somente depois de conferir a fingerprint do VPS por um canal confiável.

## UI

A aplicação possui:

- configuração SSH (host, porta, usuário, chave, senha ou SSH Agent);
- teste de conexão;
- fingerprint do host;
- pré-flight do VPS;
- Docker/Compose/CloudPanel/clpctl;
- seleção `develop` / `production`;
- versão `develop`, `latest` ou `vX.Y.Z`;
- deployment;
- diretório da stack;
- configuração da Platform/ACME/Cloudflare;
- repositório GitHub privado;
- GHCR privado;
- autorização do Host Agent;
- instalação opcional do Dockge;
- ações `Plan`, `Prepare` e `Apply`;
- barra de progresso;
- eventos estruturados do agente;
- recibo JSON da implantação.

## Estrutura do projeto

```text
ARGWS-Connect-Deployer-Tauri-Rust/
├─ .github/workflows/build.yml
├─ Cargo.toml
├─ package.json
├─ crates/
│  ├─ deployer-protocol/
│  └─ deployer-agent/
├─ src-tauri/
│  ├─ embedded/
│  ├─ capabilities/
│  └─ src/
├─ src/
│  ├─ App.vue
│  ├─ main.ts
│  ├─ style.css
│  └─ types/
├─ scripts/
├─ reference/
│  └─ install-connect-python-original.py
├─ ARCHITECTURE.md
├─ SECURITY.md
└─ VALIDATION.md
```

## Guia de build

O procedimento completo de build local e CI está em [`BUILD.md`](BUILD.md).

# Compilação no GitHub Actions

É o caminho recomendado para gerar todos os artefatos.

O workflow `.github/workflows/build.yml`:

1. compila e testa o agente `linux-amd64` em container Linux `amd64`;
2. compila e testa o agente `linux-arm64` em container Linux `arm64` via QEMU quando necessário;
3. gera SHA-256 dos agentes;
4. baixa os dois agentes nos jobs desktop;
5. embute os agentes no binário Tauri;
6. valida frontend e backend Rust;
7. compila Windows, Linux e macOS;
8. coleta installers/binários e checksums;
9. em tags `v*`, publica uma GitHub Release.

## Criar uma release

```bash
git tag v2.0.0
git push origin v2.0.0
```

O workflow gera a release automaticamente.

## Artefatos esperados

A nomenclatura final inclui a plataforma, por exemplo:

```text
ARGWS-Connect-Deployer-windows-x64.exe
argws-connect-deployer-linux-x64
ARGWS-Connect-Deployer-linux-x64-*.deb
ARGWS-Connect-Deployer-linux-x64-*.AppImage
argws-connect-deployer-macos-arm64
ARGWS-Connect-Deployer-macos-arm64-*.dmg
connect-deploy-agent-linux-amd64
connect-deploy-agent-linux-arm64
SHA256SUMS.txt
```

# Compilação local no Windows

## Requisitos da máquina de build

- Windows 10/11 x64;
- Node.js 22;
- Rust **1.90.0** via `rustup` + MSVC toolchain;
- Microsoft C++ Build Tools/Visual Studio Build Tools;
- WebView2 Runtime;
- Docker Desktop **somente se quiser compilar os agentes Linux localmente**.

## Build completo

No PowerShell:

```powershell
.\scripts\build-windows.ps1
```

O script:

- compila agentes Linux via Docker;
- embute agentes em `src-tauri/embedded/`;
- instala dependências frontend;
- valida Vue/TypeScript;
- executa `cargo check` do desktop;
- compila o Tauri;
- coleta arquivos em `dist/release/`.

### Somente VPS amd64

```powershell
.\scripts\build-windows.ps1 -Amd64Only
```

### Agentes já disponíveis

Copie os arquivos para:

```text
src-tauri/embedded/agent-linux-amd64
src-tauri/embedded/agent-linux-arm64
```

Depois:

```powershell
.\scripts\build-windows.ps1 -SkipAgents
```

# Compilação local Linux/macOS

```bash
./scripts/build-linux.sh
```

ou:

```bash
./scripts/build-macos.sh
```

Por padrão os scripts constroem os agentes Linux via Docker antes do Tauri. Use `--skip-agents` se os agentes já estiverem em `src-tauri/embedded/`.

# Fluxo de implantação

```text
1. Abrir ARGWS Connect|API Deployer
2. Informar host/porta/usuário
3. Selecionar chave SSH, senha ou SSH Agent
4. Testar servidor
5. Conferir fingerprint/known_hosts
6. Conferir Docker/Compose/CloudPanel
7. Selecionar Develop ou Production
8. Selecionar versão/deployment
9. Informar domínio/ACME/Cloudflare quando aplicável
10. Executar PLAN
11. Revisar recibo
12. Executar PREPARE ou APPLY
13. Acompanhar os eventos/health checks
```

## Ações

### Plan

Valida:

- GitHub/release;
- Compose;
- `.env`;
- imagens;
- arquitetura;
- proteção de dados/volumes;
- regras da Platform.

Não grava a stack nem sobe containers.

### Prepare

Executa o plano e grava:

- `compose.yaml`;
- `.env`;
- `.connect-install.json`;
- backup/journal de configuração.

Não executa `docker compose up`.

### Apply

Além de preparar:

- valida Docker Linux/local;
- valida `clpctl` quando a Platform exigir;
- baixa todas as imagens primeiro;
- verifica revisão das imagens `develop` quando aplicável;
- grava configuração;
- opcionalmente instala Dockge;
- executa `docker compose up -d --no-build --pull never`;
- aguarda readiness/health;
- grava o recibo final.

# Status desta entrega

O código-fonte está estruturado para compilação pelo workflow e pelos scripts locais. Consulte `VALIDATION.md` para saber exatamente o que foi validado no ambiente de geração desta entrega e o que é validado automaticamente pelo CI.
