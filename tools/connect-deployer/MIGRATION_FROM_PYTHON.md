# Portabilidade do instalador Python para Rust

A cópia do instalador fornecido permanece em:

```text
reference/install-connect-python-original.py
```

Ela não é executada pelo novo Deployer e serve somente como referência/auditoria.

## Mapeamento conceitual

| Python original | Rust |
|---|---|
| `GitHubSource` | `crates/deployer-agent/src/github.rs` |
| `env_values`, `set_env`, `prepare_env` | `envfile.rs` |
| `safe_directory`, `write_private`, recovery | `storage.rs` |
| `compose_args`, `rendered`, `validate_plan` | `docker.rs` |
| `check_images` | `docker.rs` |
| `readiness` | `docker.rs` |
| `install_dockge` | `deploy.rs` |
| `execute` | `deploy.rs` |
| CLI local no VPS | Tauri desktop + agente Rust temporário |

## Diferença arquitetural principal

### Antes

```text
Desktop/terminal → SSH manual → Python no VPS → install-connect.py
```

### Agora

```text
Tauri Desktop → SSH/SFTP → agente Rust estático temporário → Docker/Compose
```

Portanto o VPS não precisa mais possuir runtime Python.
