use crate::error::{AgentError, Result};
use serde_json::{json, Map, Value};
use std::collections::{BTreeMap, BTreeSet};
use std::ffi::{OsStr, OsString};
use std::io::{Read, Seek, SeekFrom, Write};
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::time::Duration;
use tempfile::{NamedTempFile, TempDir};
use wait_timeout::ChildExt;

const DEFAULT_COMMAND_TIMEOUT: Duration = Duration::from_secs(60);
const MANIFEST_TIMEOUT: Duration = Duration::from_secs(90);
const LONG_DOCKER_TIMEOUT: Duration = Duration::from_secs(1800);

pub struct DockerEnv {
    docker_config: Option<TempDir>,
}

impl DockerEnv {
    pub fn normal() -> Self {
        Self { docker_config: None }
    }

    pub fn with_ghcr_login(user: &str, token: &str) -> Result<Self> {
        if user.trim().is_empty() || token.trim().is_empty() {
            return Err(AgentError::msg("Credenciais GHCR incompletas."));
        }
        let temp = tempfile::tempdir()?;
        std::fs::set_permissions(temp.path(), std::fs::Permissions::from_mode(0o700))?;
        let config_path = temp.path().join("config.json");
        prepare_temporary_registry_config(&config_path)?;

        let mut command = Command::new("docker");
        command
            .args(["login", "ghcr.io", "--username", user, "--password-stdin"])
            .env("DOCKER_CONFIG", temp.path())
            .stdin(Stdio::piped())
            .stdout(Stdio::null())
            .stderr(Stdio::null());
        let mut child = command
            .spawn()
            .map_err(|_| AgentError::msg("Docker não foi encontrado."))?;
        if let Some(mut stdin) = child.stdin.take() {
            stdin.write_all(token.as_bytes())?;
            stdin.write_all(b"\n")?;
        }
        let status = wait_child(&mut child, DEFAULT_COMMAND_TIMEOUT, "docker login")?;
        if !status.success() {
            return Err(AgentError::msg("Falha no login temporário GHCR."));
        }
        std::fs::set_permissions(&config_path, std::fs::Permissions::from_mode(0o600))?;
        Ok(Self {
            docker_config: Some(temp),
        })
    }

    fn apply(&self, command: &mut Command) {
        for key in [
            "GH_TOKEN",
            "GITHUB_TOKEN",
            "CLOUDFLARE_API_TOKEN",
            "COMPOSE_FILE",
            "COMPOSE_PROJECT_NAME",
            "COMPOSE_PROFILES",
            "COMPOSE_ENV_FILES",
        ] {
            command.env_remove(key);
        }
        if let Some(config) = &self.docker_config {
            command.env("DOCKER_CONFIG", config.path());
        }
    }
}

fn prepare_temporary_registry_config(target: &Path) -> Result<()> {
    let existing_dir = std::env::var_os("DOCKER_CONFIG")
        .map(PathBuf::from)
        .or_else(|| dirs::home_dir().map(|home| home.join(".docker")));
    let existing_file = existing_dir.map(|dir| dir.join("config.json"));
    let mut config = if let Some(path) = existing_file.filter(|path| path.is_file()) {
        let bytes = std::fs::read(path)?;
        serde_json::from_slice::<Value>(&bytes)
            .map_err(|_| AgentError::msg("Configuração Docker de autenticação inválida."))?
    } else {
        json!({})
    };
    let object = config
        .as_object_mut()
        .ok_or_else(|| AgentError::msg("Configuração Docker de autenticação inválida."))?;
    object.remove("credsStore");
    if let Some(helpers) = object.get_mut("credHelpers") {
        let map = helpers
            .as_object_mut()
            .ok_or_else(|| AgentError::msg("credHelpers inválido na configuração Docker."))?;
        for host in ["ghcr.io", "https://ghcr.io", "http://ghcr.io"] {
            map.remove(host);
        }
    }
    std::fs::write(target, serde_json::to_vec(&config)?)?;
    std::fs::set_permissions(target, std::fs::Permissions::from_mode(0o600))?;
    Ok(())
}

fn wait_child(child: &mut std::process::Child, timeout: Duration, operation: &str) -> Result<ExitStatus> {
    match child.wait_timeout(timeout)? {
        Some(status) => Ok(status),
        None => {
            let _ = child.kill();
            let _ = child.wait();
            Err(AgentError::msg(format!(
                "Tempo limite excedido em {operation}; a operação foi interrompida sem expor saída sensível."
            )))
        }
    }
}

fn command_capture_timeout<I, S>(
    program: &str,
    args: I,
    docker_env: &DockerEnv,
    timeout: Duration,
) -> Result<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut stdout_file = NamedTempFile::new()?;
    let stderr_file = NamedTempFile::new()?;
    let mut command = Command::new(program);
    command.args(args);
    docker_env.apply(&mut command);
    command
        .stdin(Stdio::null())
        .stdout(Stdio::from(stdout_file.reopen()?))
        .stderr(Stdio::from(stderr_file.reopen()?));
    let mut child = command.spawn().map_err(|_| {
        AgentError::msg(format!("Dependência não encontrada ou não executável: {program}"))
    })?;
    let status = wait_child(&mut child, timeout, program)?;
    if !status.success() {
        return Err(AgentError::msg(format!(
            "Falhou: {program} (código {}). Confira Docker, registry e configuração; saída sensível foi omitida.",
            status.code().unwrap_or(-1)
        )));
    }
    stdout_file.as_file_mut().seek(SeekFrom::Start(0))?;
    let mut stdout = Vec::new();
    stdout_file.as_file_mut().read_to_end(&mut stdout)?;
    String::from_utf8(stdout).map_err(|_| AgentError::msg("Saída de comando não está em UTF-8."))
}

pub fn command_capture<I, S>(program: &str, args: I, docker_env: &DockerEnv) -> Result<String>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    command_capture_timeout(program, args, docker_env, DEFAULT_COMMAND_TIMEOUT)
}

fn command_status_timeout<I, S>(
    program: &str,
    args: I,
    docker_env: &DockerEnv,
    timeout: Duration,
) -> Result<()>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    let mut command = Command::new(program);
    command.args(args);
    docker_env.apply(&mut command);
    command.stdin(Stdio::null());
    command.stdout(Stdio::null());
    command.stderr(Stdio::null());
    let mut child = command.spawn().map_err(|_| {
        AgentError::msg(format!("Dependência não encontrada ou não executável: {program}"))
    })?;
    let status = wait_child(&mut child, timeout, program)?;
    if !status.success() {
        return Err(AgentError::msg(format!(
            "Falhou: {program} (código {}). Dados sensíveis foram omitidos.",
            status.code().unwrap_or(-1)
        )));
    }
    Ok(())
}

pub fn command_status<I, S>(program: &str, args: I, docker_env: &DockerEnv) -> Result<()>
where
    I: IntoIterator<Item = S>,
    S: AsRef<OsStr>,
{
    command_status_timeout(program, args, docker_env, DEFAULT_COMMAND_TIMEOUT)
}

pub fn compose_args(project_directory: &Path, files_directory: &Path) -> Vec<OsString> {
    vec![
        OsString::from("compose"),
        OsString::from("--project-directory"),
        project_directory.as_os_str().to_os_string(),
        OsString::from("--env-file"),
        files_directory.join(".env").as_os_str().to_os_string(),
        OsString::from("-f"),
        files_directory.join("compose.yaml").as_os_str().to_os_string(),
    ]
}

pub fn rendered(directory: &Path, files: &Path, docker_env: &DockerEnv) -> Result<Value> {
    let mut args = compose_args(files, files);
    args.extend([OsString::from("config"), OsString::from("--format"), OsString::from("json")]);
    let output = command_capture("docker", args, docker_env)?;
    let mut config: Value = serde_json::from_str(&output)
        .map_err(|_| AgentError::msg("Docker Compose não retornou configuração JSON válida."))?;
    if files != directory {
        rewrite_staged_bind_mounts(&mut config, files, directory)?;
    }
    Ok(config)
}

fn rewrite_staged_bind_mounts(config: &mut Value, staged: &Path, final_dir: &Path) -> Result<()> {
    let Some(services) = config.get_mut("services").and_then(Value::as_object_mut) else {
        return Ok(());
    };
    let staged = staged.canonicalize().unwrap_or_else(|_| staged.to_path_buf());
    for service in services.values_mut() {
        let Some(volumes) = service.get_mut("volumes").and_then(Value::as_array_mut) else {
            continue;
        };
        for mount in volumes {
            if mount.get("type").and_then(Value::as_str) != Some("bind") {
                continue;
            }
            let Some(source) = mount.get("source").and_then(Value::as_str) else {
                continue;
            };
            let path = PathBuf::from(source);
            if let Ok(relative) = path.strip_prefix(&staged) {
                mount["source"] = Value::String(final_dir.join(relative).to_string_lossy().into_owned());
            }
        }
    }
    Ok(())
}

pub fn validate_plan(
    config: &Value,
    before: Option<&Value>,
    full_platform: bool,
    accept_host: bool,
) -> Result<()> {
    let services = config
        .get("services")
        .and_then(Value::as_object)
        .ok_or_else(|| AgentError::msg("Nenhum serviço selecionado."))?;
    if services.is_empty() {
        return Err(AgentError::msg("Nenhum serviço selecionado."));
    }
    for (name, service) in services {
        if service.get("build").is_some_and(|v| !v.is_null()) {
            return Err(AgentError::msg(format!(
                "O instalador usa imagens publicadas; build local não é permitido: {name}"
            )));
        }
        if service.get("image").and_then(Value::as_str).unwrap_or_default().is_empty() {
            return Err(AgentError::msg(format!("Serviço sem imagem: {name}")));
        }
        if service.get("privileged").and_then(Value::as_bool).unwrap_or(false) && !accept_host {
            return Err(AgentError::msg(
                "O CloudPanel Agent equivale a root no VPS. Autorize explicitamente o Host Agent.",
            ));
        }
    }

    if full_platform {
        for fragment in [
            "platform-acme-",
            "platform-cloudpanel-agent-",
            "platform-pgbouncer-",
            "pgbouncer-",
        ] {
            if !services.keys().any(|name| name.starts_with(fragment)) {
                return Err(AgentError::msg(format!(
                    "Esta versão não contém a stack Platform completa atual: falta {fragment}"
                )));
            }
        }
        let tls_enabled = services.iter().any(|(name, svc)| {
            name.contains("platform-acme-")
                && svc
                    .get("environment")
                    .and_then(Value::as_object)
                    .and_then(|env| env.get("PLATFORM_TLS_AUTOMATION_ENABLED"))
                    .is_some_and(|v| match v {
                        Value::String(value) => value.eq_ignore_ascii_case("true"),
                        Value::Bool(value) => *value,
                        _ => false,
                    })
        });
        if !tls_enabled {
            return Err(AgentError::msg(
                "A automação TLS está desabilitada. Configure o .env antes de instalar a Platform CloudPanel.",
            ));
        }
    }

    if let Some(previous) = before {
        if previous.get("name") != config.get("name") {
            return Err(AgentError::msg(
                "Nome do project existente mudou; atualização bloqueada.",
            ));
        }
        let old = storage_signature(previous)?;
        let new = storage_signature(config)?;
        for (name, signature) in old {
            let Some(new_signature) = new.get(&name) else {
                return Err(AgentError::msg(format!("Serviço existente seria removido: {name}")));
            };
            if &signature != new_signature {
                return Err(AgentError::msg(format!(
                    "Volumes, portas ou identidade de dados mudariam em {name}. Revisão de migração necessária."
                )));
            }
        }
    }
    Ok(())
}

fn storage_signature(config: &Value) -> Result<BTreeMap<String, Value>> {
    let mut result = BTreeMap::new();
    let Some(services) = config.get("services").and_then(Value::as_object) else {
        return Ok(result);
    };
    for (name, svc) in services {
        let mut identity = Map::new();
        if let Some(environment) = svc.get("environment").and_then(Value::as_object) {
            for (key, value) in environment {
                if is_identity_key(key) {
                    identity.insert(key.clone(), value.clone());
                }
            }
        }
        result.insert(
            name.clone(),
            json!({
                "volumes": svc.get("volumes").cloned().unwrap_or_else(|| json!([])),
                "ports": svc.get("ports").cloned().unwrap_or_else(|| json!([])),
                "identity": identity,
            }),
        );
    }
    Ok(result)
}

fn is_identity_key(key: &str) -> bool {
    matches!(
        key,
        "POSTGRES_DB"
            | "POSTGRES_USER"
            | "POSTGRES_PASSWORD"
            | "DATABASE_CONNECTION_URI"
            | "FIELD_ENCRYPTION_KEY"
            | "APP_SECRET_KEY"
    ) || key.ends_with("POSTGRES_DB")
        || key.ends_with("POSTGRES_USER")
        || key.ends_with("POSTGRES_PASSWORD")
        || key.ends_with("DATABASE_CONNECTION_URI")
        || key.ends_with("FIELD_ENCRYPTION_KEY")
        || key.ends_with("APP_SECRET_KEY")
}

pub fn check_images(config: &Value, docker_env: &DockerEnv) -> Result<Vec<String>> {
    let services = config
        .get("services")
        .and_then(Value::as_object)
        .ok_or_else(|| AgentError::msg("Nenhum serviço selecionado."))?;
    let mut images = BTreeSet::new();
    for service in services.values() {
        if let Some(image) = service.get("image").and_then(Value::as_str) {
            images.insert(image.to_string());
        }
    }
    let architecture = match std::env::consts::ARCH {
        "x86_64" => "amd64",
        "aarch64" => "arm64",
        other => other,
    };
    for image in &images {
        let output = command_capture_timeout(
            "docker",
            ["manifest", "inspect", image.as_str()],
            docker_env,
            MANIFEST_TIMEOUT,
        )
            .map_err(|_| AgentError::msg(format!(
                "Imagem não disponível/autorizada: {image}. Nenhum container foi atualizado."
            )))?;
        let manifest: Value = serde_json::from_str(&output)
            .map_err(|_| AgentError::msg(format!("Manifesto inválido: {image}")))?;
        if let Some(manifests) = manifest.get("manifests").and_then(Value::as_array) {
            if !manifests.is_empty() {
                let supported = manifests.iter().any(|entry| {
                    entry
                        .get("platform")
                        .is_some_and(|p| {
                            p.get("os").and_then(Value::as_str) == Some("linux")
                                && p.get("architecture").and_then(Value::as_str) == Some(architecture)
                        })
                });
                if !supported {
                    return Err(AgentError::msg(format!(
                        "Imagem sem suporte à arquitetura {architecture}: {image}"
                    )));
                }
            }
        }
    }
    Ok(images.into_iter().collect())
}

pub fn compose_pull(directory: &Path, files: &Path, docker_env: &DockerEnv) -> Result<()> {
    let mut args = compose_args(directory, files);
    args.push(OsString::from("pull"));
    command_status_timeout("docker", args, docker_env, LONG_DOCKER_TIMEOUT)
}

pub fn compose_up(directory: &Path, docker_env: &DockerEnv) -> Result<()> {
    let mut args = compose_args(directory, directory);
    args.extend([
        OsString::from("up"),
        OsString::from("-d"),
        OsString::from("--no-build"),
        OsString::from("--pull"),
        OsString::from("never"),
    ]);
    command_status_timeout("docker", args, docker_env, LONG_DOCKER_TIMEOUT)
}

pub fn readiness(directory: &Path, docker_env: &DockerEnv, timeout_seconds: u64) -> Result<Value> {
    let deadline = std::time::Instant::now() + Duration::from_secs(timeout_seconds);
    loop {
        let mut args = compose_args(directory, directory);
        args.extend([
            OsString::from("ps"),
            OsString::from("-a"),
            OsString::from("--format"),
            OsString::from("json"),
        ]);
        let output = command_capture("docker", args, docker_env)?;
        let parsed = parse_compose_ps(&output)?;
        let mut pending = Vec::new();
        let mut failed = Vec::new();
        for svc in &parsed {
            let state = svc.get("State").and_then(Value::as_str).unwrap_or_default();
            let health = svc.get("Health").and_then(Value::as_str).unwrap_or_default();
            let exit_code = svc
                .get("ExitCode")
                .and_then(|v| v.as_i64().or_else(|| v.as_str().and_then(|s| s.parse().ok())))
                .unwrap_or(0);
            let service = svc.get("Service").and_then(Value::as_str).unwrap_or("unknown").to_string();
            if state == "exited" && exit_code == 0 {
                continue;
            }
            if state == "exited" || health == "unhealthy" {
                failed.push(service);
            } else if state != "running" || health == "starting" {
                pending.push(service);
            }
        }
        if !parsed.is_empty() && failed.is_empty() && pending.is_empty() {
            return Ok(json!({"status":"SERVICES_READY","services":parsed.len()}));
        }
        if timeout_seconds == 0 || std::time::Instant::now() >= deadline {
            return Ok(json!({
                "status":"PENDING_OR_FAILED",
                "failed":failed,
                "pending":pending,
                "note":"A stack permanece instalada. Confira os serviços no Dockge; não foi feito rollback de banco."
            }));
        }
        std::thread::sleep(Duration::from_secs(3));
    }
}

fn parse_compose_ps(output: &str) -> Result<Vec<Value>> {
    let trimmed = output.trim();
    if trimmed.is_empty() {
        return Ok(Vec::new());
    }
    if let Ok(value) = serde_json::from_str::<Value>(trimmed) {
        return match value {
            Value::Array(values) => Ok(values),
            other => Ok(vec![other]),
        };
    }
    let mut rows = Vec::new();
    for line in trimmed.lines().filter(|line| !line.trim().is_empty()) {
        rows.push(serde_json::from_str(line)?);
    }
    Ok(rows)
}

pub fn docker_info(docker_env: &DockerEnv) -> Result<Value> {
    let output = command_capture("docker", ["info", "--format", "{{json .}}"], docker_env)?;
    serde_json::from_str(&output).map_err(Into::into)
}

pub fn docker_context_is_local(docker_env: &DockerEnv) -> Result<bool> {
    if std::env::var("DOCKER_HOST").ok().is_some_and(|v| !v.starts_with("unix://")) {
        return Ok(false);
    }
    let output = command_capture("docker", ["context", "inspect"], docker_env)?;
    let value: Value = serde_json::from_str(&output)?;
    let endpoint = value
        .as_array()
        .and_then(|arr| arr.first())
        .and_then(|v| v.pointer("/Endpoints/docker/Host"))
        .and_then(Value::as_str)
        .unwrap_or_default();
    Ok(endpoint.starts_with("unix://"))
}

pub fn image_revision(image: &str, docker_env: &DockerEnv) -> Result<String> {
    command_capture(
        "docker",
        [
            "image",
            "inspect",
            image,
            "--format",
            "{{index .Config.Labels \"org.opencontainers.image.revision\"}}",
        ],
        docker_env,
    )
    .map(|v| v.trim().to_string())
}
