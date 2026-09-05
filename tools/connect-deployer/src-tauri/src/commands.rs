use crate::agents;
use crate::error::{DesktopError, Result};
use crate::model::{ConnectionInput, ConnectionTestResult, DesktopDeployRequest};
use crate::ssh::SshClient;
use deployer_protocol::{AgentEvent, ServerPreflight};
use std::io::{BufRead, BufReader, Read, Write};
use tauri::{AppHandle, Emitter};
use uuid::Uuid;

#[tauri::command]
pub async fn embedded_agent_status() -> serde_json::Value {
    agents::status()
}

#[tauri::command]
pub async fn test_connection(input: ConnectionInput) -> std::result::Result<ConnectionTestResult, String> {
    tauri::async_runtime::spawn_blocking(move || test_connection_blocking(input))
        .await
        .map_err(|_| "Falha interna ao testar a conexão.".to_string())?
        .map_err(|e| e.to_string())
}

fn test_connection_blocking(input: ConnectionInput) -> Result<ConnectionTestResult> {
    let client = SshClient::connect(&input)?;
    if input.sudo {
        let (code, _, _) = client.exec("sudo -n true")?;
        if code != 0 {
            return Err(DesktopError::msg(
                "O usuário não possui sudo não-interativo (sudo -n). Nenhuma senha sudo será armazenada pelo Deployer.",
            ));
        }
    }
    let server = preflight(&client)?;
    Ok(ConnectionTestResult {
        fingerprint_sha256: client.fingerprint_sha256,
        host_key_type: client.host_key_type,
        known_host_status: client.known_host_status,
        server,
    })
}

#[tauri::command]
pub async fn deploy(
    app: AppHandle,
    input: DesktopDeployRequest,
) -> std::result::Result<serde_json::Value, String> {
    tauri::async_runtime::spawn_blocking(move || deploy_blocking(app, input))
        .await
        .map_err(|_| "Falha interna durante a implantação.".to_string())?
        .map_err(|e| e.to_string())
}

fn deploy_blocking(app: AppHandle, mut input: DesktopDeployRequest) -> Result<serde_json::Value> {
    if let Some(path) = input.env_input_path.take() {
        let metadata = std::fs::metadata(&path)?;
        if !metadata.is_file() || metadata.len() > 2_000_000 {
            return Err(DesktopError::msg("O .env local precisa ser arquivo regular com no máximo 2 MB."));
        }
        input.deploy.env_input = Some(std::fs::read_to_string(path)?);
    }
    emit_local(&app, "ssh", "Conectando ao VPS e validando chave de host...", Some(3));
    let client = SshClient::connect(&input.connection)?;
    emit_local(&app, "ssh", "SSH autenticado e known_hosts validado.", Some(8));

    if input.connection.sudo {
        let (code, _, _) = client.exec("sudo -n true")?;
        if code != 0 {
            return Err(DesktopError::msg(
                "Deploy com sudo exige sudo -n funcional. Configure NOPASSWD apenas para o usuário de implantação ou conecte com conta adequada.",
            ));
        }
    }

    let server = preflight(&client)?;
    if !server.docker_available || !server.compose_available {
        return Err(DesktopError::msg(
            "O VPS precisa ter Docker e Docker Compose v2 antes da implantação. O Deployer não instala pacotes do sistema operacional.",
        ));
    }
    if server.os.to_ascii_lowercase() != "linux" {
        return Err(DesktopError::msg("O destino precisa ser Linux."));
    }
    emit_local(
        &app,
        "preflight",
        format!(
            "Servidor Linux {} detectado; Docker/Compose disponíveis.",
            server.architecture
        ),
        Some(14),
    );

    let embedded = agents::for_uname(&server.architecture)?;
    emit_local(
        &app,
        "agent",
        format!("Agente Rust Linux {} selecionado.", embedded.architecture),
        Some(18),
    );

    let remote_dir = create_remote_directory(&client)?;
    let remote_agent = format!("{remote_dir}/connect-deploy-agent");
    let result = (|| -> Result<serde_json::Value> {
        client.upload_private(&remote_agent, embedded.bytes, 0o700)?;
        verify_remote_agent(&client, &remote_agent, &embedded.sha256)?;
        emit_local(&app, "agent", "Agente enviado e SHA-256 validado no VPS.", Some(23));

        let self_test_command = if input.connection.sudo {
            format!("sudo -n {remote_agent} self-test")
        } else {
            format!("{remote_agent} self-test")
        };
        let (code, stdout, _) = client.exec(&self_test_command)?;
        if code != 0 {
            return Err(DesktopError::msg("O agente remoto não passou no self-test."));
        }
        let self_test: serde_json::Value = serde_json::from_str(stdout.trim())?;
        if self_test.get("ok").and_then(|v| v.as_bool()) != Some(true) {
            return Err(DesktopError::msg("Self-test do agente retornou resposta inválida."));
        }
        if self_test.get("protocol").and_then(|v| v.as_u64())
            != Some(deployer_protocol::PROTOCOL_VERSION as u64)
        {
            return Err(DesktopError::msg("Versão de protocolo do agente não corresponde ao Desktop."));
        }
        if self_test.get("os").and_then(|v| v.as_str()) != Some("linux") {
            return Err(DesktopError::msg("O agente enviado não é um binário Linux válido para este deploy."));
        }
        let self_arch = self_test.get("arch").and_then(|v| v.as_str()).unwrap_or_default();
        let arch_matches = match embedded.architecture {
            "amd64" => self_arch == "x86_64",
            "arm64" => self_arch == "aarch64",
            _ => false,
        };
        if !arch_matches {
            return Err(DesktopError::msg("Arquitetura reportada pelo agente diverge do VPS detectado."));
        }

        let request_json = serde_json::to_string(&input.deploy)?;
        let command = if input.connection.sudo {
            format!("sudo -n {remote_agent} execute")
        } else {
            format!("{remote_agent} execute")
        };
        run_agent_stream(&app, &client, &command, &request_json)
    })();

    if let Err(cleanup_error) = cleanup_remote(&client, &remote_dir) {
        let _ = app.emit(
            "deploy-event",
            AgentEvent::warning("cleanup", format!("Falha ao limpar temporários remotos: {cleanup_error}")),
        );
    }
    result
}

fn preflight(client: &SshClient) -> Result<ServerPreflight> {
    let os = run_required(client, "uname -s")?;
    let architecture = run_required(client, "uname -m")?;
    let kernel = run_required(client, "uname -r")?;
    let effective_user = run_required(client, "id -un")?;

    let docker_available = run_ok(client, "command -v docker >/dev/null 2>&1")?;
    let docker_version = docker_available
        .then(|| run_optional(client, "docker --version"))
        .transpose()?
        .flatten();
    let compose_available = docker_available && run_ok(client, "docker compose version >/dev/null 2>&1")?;
    let compose_version = compose_available
        .then(|| run_optional(client, "docker compose version"))
        .transpose()?
        .flatten();
    let clpctl_available = run_ok(client, "command -v clpctl >/dev/null 2>&1")?;
    let cloudpanel_available = clpctl_available || run_ok(client, "test -d /home/clp")?;
    let disk_available_bytes = run_optional(client, "df -Pk /opt 2>/dev/null | awk 'NR==2 {print $4}'")?
        .and_then(|v| v.trim().parse::<u64>().ok())
        .map(|kb| kb.saturating_mul(1024));

    Ok(ServerPreflight {
        os: os.trim().to_string(),
        architecture: architecture.trim().to_string(),
        kernel: kernel.trim().to_string(),
        docker_available,
        docker_version,
        compose_available,
        compose_version,
        cloudpanel_available,
        clpctl_available,
        disk_available_bytes,
        effective_user: effective_user.trim().to_string(),
    })
}

fn run_required(client: &SshClient, command: &str) -> Result<String> {
    let (code, stdout, _) = client.exec(command)?;
    if code != 0 {
        return Err(DesktopError::msg(format!("Falha no pré-flight: {command}")));
    }
    Ok(stdout.trim().to_string())
}

fn run_optional(client: &SshClient, command: &str) -> Result<Option<String>> {
    let (code, stdout, _) = client.exec(command)?;
    Ok((code == 0).then(|| stdout.trim().to_string()))
}

fn run_ok(client: &SshClient, command: &str) -> Result<bool> {
    let (code, _, _) = client.exec(command)?;
    Ok(code == 0)
}

fn create_remote_directory(client: &SshClient) -> Result<String> {
    // UUID é gerado localmente; nenhum input do usuário compõe o caminho remoto.
    let suffix = Uuid::new_v4().simple().to_string();
    let directory = format!("/tmp/argws-connect-deployer-{suffix}");
    client.create_private_directory(&directory, 0o700)?;
    Ok(directory)
}

fn verify_remote_agent(client: &SshClient, remote_agent: &str, expected: &str) -> Result<()> {
    // A verificação é feita via SFTP, sem depender de sha256sum/shasum instalado no VPS.
    let actual = client.remote_sha256(remote_agent, 64 * 1024 * 1024)?;
    if actual != expected {
        return Err(DesktopError::msg("SHA-256 do agente remoto divergiu após o upload."));
    }
    Ok(())
}

fn cleanup_remote(client: &SshClient, remote_dir: &str) -> Result<()> {
    if !remote_dir.starts_with("/tmp/argws-connect-deployer-") {
        return Err(DesktopError::msg("Recusando limpar diretório fora do namespace temporário."));
    }
    let remote_agent = format!("{remote_dir}/connect-deploy-agent");
    client.remove_file_and_directory(&remote_agent, remote_dir)
}

fn run_agent_stream(
    app: &AppHandle,
    client: &SshClient,
    command: &str,
    request_json: &str,
) -> Result<serde_json::Value> {
    let mut channel = client.session.channel_session()?;
    channel.exec(command)?;
    channel.write_all(request_json.as_bytes())?;
    channel.flush()?;
    channel.send_eof()?;

    let mut final_result: Option<serde_json::Value> = None;
    {
        let mut reader = BufReader::new(&mut channel);
        let mut line = String::new();
        loop {
            line.clear();
            let count = reader.read_line(&mut line)?;
            if count == 0 {
                break;
            }
            let trimmed = line.trim();
            if trimmed.is_empty() {
                continue;
            }
            match serde_json::from_str::<AgentEvent>(trimmed) {
                Ok(event) => {
                    if matches!(event.kind, deployer_protocol::EventKind::Result) {
                        final_result = event.data.clone();
                    }
                    let _ = app.emit("deploy-event", &event);
                }
                Err(_) => {
                    let _ = app.emit(
                        "deploy-event",
                        AgentEvent::warning("agent-output", "O agente emitiu uma linha não estruturada; conteúdo omitido."),
                    );
                }
            }
        }
    }
    let mut stderr = String::new();
    channel.stderr().read_to_string(&mut stderr)?;
    channel.wait_close()?;
    let status = channel.exit_status()?;
    if status != 0 && status != 3 {
        return Err(DesktopError::msg(format!(
            "Agente remoto encerrou com código {status}. Saída de erro foi omitida para evitar vazamento de segredos."
        )));
    }
    final_result.ok_or_else(|| DesktopError::msg("Agente remoto não retornou recibo final."))
}

fn emit_local(app: &AppHandle, step: &str, message: impl Into<String>, progress: Option<u8>) {
    let _ = app.emit("deploy-event", AgentEvent::info(step, message, progress));
}
