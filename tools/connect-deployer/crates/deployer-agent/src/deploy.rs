use crate::docker::{
    check_images, command_capture, compose_pull, compose_up, docker_context_is_local,
    docker_info, image_revision, readiness, rendered, validate_plan, DockerEnv,
};
use crate::envfile::{apply_platform_inputs, env_values, prepare_env};
use crate::error::{AgentError, Result};
use crate::events::{info, warning};
use crate::github::GitHubSource;
use crate::storage::{recover_stack, safe_directory, save_stack, write_private, InstallLock};
use deployer_protocol::{DeployAction, DeployReceipt, DeployRequest, PROTOCOL_VERSION};
use serde_json::{json, Value};
use std::collections::BTreeMap;
use std::fs;
use std::path::Path;
use zeroize::Zeroizing;

const INSTALLER_VERSION: &str = env!("CARGO_PKG_VERSION");

#[derive(Clone)]
struct DeploymentSpec {
    filename: &'static str,
    expected_env: &'static str,
    full_platform: bool,
    profiles: Vec<String>,
}

fn catalog() -> BTreeMap<&'static str, DeploymentSpec> {
    BTreeMap::from([
        (
            "platform-develop",
            DeploymentSpec {
                filename: "compose.yaml",
                expected_env: "develop",
                full_platform: true,
                profiles: vec![],
            },
        ),
        (
            "platform-production",
            DeploymentSpec {
                filename: "compose.yaml",
                expected_env: "production",
                full_platform: true,
                profiles: vec![],
            },
        ),
        (
            "platform",
            DeploymentSpec {
                filename: "compose.yaml",
                expected_env: "any",
                full_platform: true,
                profiles: vec!["platform".into(), "observability".into()],
            },
        ),
        (
            "develop",
            DeploymentSpec {
                filename: "compose.yaml",
                expected_env: "develop",
                full_platform: false,
                profiles: vec![],
            },
        ),
        (
            "production",
            DeploymentSpec {
                filename: "compose.yaml",
                expected_env: "production",
                full_platform: false,
                profiles: vec![],
            },
        ),
        (
            "canonical",
            DeploymentSpec {
                filename: "compose.yaml",
                expected_env: "production",
                full_platform: false,
                profiles: vec![],
            },
        ),
        (
            "homologation",
            DeploymentSpec {
                filename: "compose.yaml",
                expected_env: "develop",
                full_platform: false,
                profiles: vec![],
            },
        ),
        (
            "cloudpanel",
            DeploymentSpec {
                filename: "docker-compose.yml",
                expected_env: "production",
                full_platform: false,
                profiles: vec![],
            },
        ),
        (
            "dockge",
            DeploymentSpec {
                filename: "compose.yaml",
                expected_env: "production",
                full_platform: false,
                profiles: vec![],
            },
        ),
        (
            "docs",
            DeploymentSpec {
                filename: "compose.yaml",
                expected_env: "production",
                full_platform: false,
                profiles: vec![],
            },
        ),
        (
            "docs-develop",
            DeploymentSpec {
                filename: "compose.yaml",
                expected_env: "develop",
                full_platform: false,
                profiles: vec![],
            },
        ),
    ])
}

pub fn execute(mut request: DeployRequest) -> Result<DeployReceipt> {
    validate_request(&request)?;
    ensure_linux()?;

    info("request", "Solicitação validada pelo agente Rust.", Some(2));
    let specs = catalog();
    let spec = specs
        .get(request.deployment.as_str())
        .ok_or_else(|| AgentError::msg("Deployment não reconhecido."))?
        .clone();
    if spec.expected_env != "any" && spec.expected_env != request.environment.as_str() {
        return Err(AgentError::msg("Deployment não corresponde ao ambiente escolhido."));
    }

    let directory = safe_directory(&request.directory)?;
    let _lock = InstallLock::acquire(&directory)?;
    if directory.join(".connect-installer-pending.json").exists() {
        if matches!(request.action, DeployAction::Plan) {
            return Err(AgentError::msg(
                "Há uma gravação interrompida. Use preparar ou aplicar para recuperar a configuração.",
            ));
        }
        recover_stack(&directory)?;
        warning("recovery", "Configuração interrompida anterior foi recuperada antes de continuar.");
    }

    info("github", "Resolvendo release e commit imutável no GitHub...", Some(8));
    let mut source = GitHubSource::new(&request.repository, request.github_token.take())?;
    let (sha, tag) = source.resolve(&request.version, request.environment.as_str())?;
    let compose_path = format!("deploy/{}/{}", request.deployment, spec.filename);
    let compose = source.file(&compose_path, &sha)?;
    let template = source.file(&format!("deploy/{}/env.example", request.deployment), &sha)?;
    if spec.full_platform && !compose.contains("PLATFORM_TLS_AUTOMATION_ENABLED") {
        return Err(AgentError::msg(
            "A release selecionada ainda não inclui a automação CloudPanel. Não haverá fallback para develop.",
        ));
    }

    info("configuration", "Preparando configuração sem substituir credenciais existentes...", Some(18));
    let env_path = directory.join(".env");
    ensure_not_symlink(&env_path, "O .env não pode ser um link simbólico.")?;
    let remote_existing = if env_path.exists() {
        Some(Zeroizing::new(fs::read_to_string(&env_path)?))
    } else {
        None
    };
    let env_input = request.env_input.take().map(Zeroizing::new);
    if remote_existing.is_some() && env_input.is_some() {
        return Err(AgentError::msg(
            "O .env local não pode substituir um .env já existente no VPS.",
        ));
    }
    let cloudflare_token = request.cloudflare_api_token.take().map(Zeroizing::new);
    let initial = remote_existing
        .as_ref()
        .map(|v| v.as_str())
        .or_else(|| env_input.as_ref().map(|v| v.as_str()));
    let (environment, changes) = prepare_env(&template, initial, &tag, &spec.profiles)?;
    let environment = Zeroizing::new(apply_platform_inputs(
        environment,
        request.platform_admin_email.as_deref(),
        request.platform_domain.as_deref(),
        request.acme_email.as_deref(),
        cloudflare_token.as_ref().map(|v| v.as_str()),
        request.cloudflare_tenant_record_target.as_deref(),
    )?);
    let values = env_values(environment.as_str())?;

    if spec.full_platform {
        if values.get("ACME_EMAIL").is_none_or(|v| v.trim().is_empty())
            || values
                .get("CLOUDFLARE_API_TOKEN")
                .is_none_or(|v| v.trim().is_empty())
        {
            return Err(AgentError::msg(
                "Configure ACME_EMAIL e CLOUDFLARE_API_TOKEN para a Platform completa.",
            ));
        }
    } else {
        warning(
            "deployment",
            "Deployment clássico/DOCs não inclui a Platform nem a automação wildcard. Use platform-* para o produto completo.",
        );
    }

    let expected_project = values
        .get("COMPOSE_PROJECT_NAME")
        .ok_or_else(|| AgentError::msg("COMPOSE_PROJECT_NAME ausente no .env."))?;
    let directory_name = directory
        .file_name()
        .and_then(|v| v.to_str())
        .ok_or_else(|| AgentError::msg("Diretório da stack inválido."))?;
    if directory_name != expected_project {
        return Err(AgentError::msg(format!(
            "Para compatibilidade Dockge, o último componente do diretório deve ser {expected_project}."
        )));
    }

    let registry_token = request.registry_token.take().map(Zeroizing::new);
    let docker_env = if let (Some(user), Some(token)) = (
        request.registry_user.as_deref(),
        registry_token.as_ref(),
    ) {
        info("registry", "Autenticando temporariamente no GHCR...", Some(24));
        DockerEnv::with_ghcr_login(user, token.as_str())?
    } else if request.registry_user.is_some() || registry_token.is_some() {
        return Err(AgentError::msg(
            "Usuário e token GHCR devem ser fornecidos em conjunto.",
        ));
    } else {
        DockerEnv::normal()
    };

    info("docker", "Validando Docker Compose local do VPS...", Some(28));
    command_capture("docker", ["compose", "version"], &docker_env)?;
    let stage = tempfile::tempdir()?;
    write_private(&stage.path().join("compose.yaml"), compose.as_bytes(), 0o600)?;
    write_private(&stage.path().join(".env"), environment.as_bytes(), 0o600)?;

    let config = rendered(&directory, stage.path(), &docker_env)?;
    let before = if directory.join("compose.yaml").exists() {
        ensure_not_symlink(
            &directory.join("compose.yaml"),
            "Compose existente não pode ser link simbólico.",
        )?;
        Some(rendered(&directory, &directory, &docker_env)?)
    } else {
        for legacy in ["docker-compose.yml", "docker-compose.yaml", "compose.argws.yaml"] {
            if directory.join(legacy).exists() {
                return Err(AgentError::msg(
                    "Há um Compose com outro nome; normalize para compose.yaml sem mover volumes antes de continuar.",
                ));
            }
        }
        None
    };
    if directory.exists() && before.is_none() {
        let mut unexpected = false;
        for entry in fs::read_dir(&directory)? {
            let entry = entry?;
            if entry.file_name() != ".env" {
                unexpected = true;
                break;
            }
        }
        if unexpected {
            return Err(AgentError::msg(
                "Diretório não vazio sem configuração reconhecida; instalação bloqueada para proteger dados.",
            ));
        }
    }

    validate_plan(
        &config,
        before.as_ref(),
        spec.full_platform,
        request.accept_host_agent,
    )?;
    info("images", "Validando disponibilidade e arquitetura das imagens...", Some(38));
    let images = check_images(&config, &docker_env)?;

    let plan = json!({
        "repository": source.repo(),
        "commit": sha.clone(),
        "environment": request.environment.as_str(),
        "version": tag.clone(),
        "deployment": request.deployment.clone(),
        "directory": directory.to_string_lossy().to_string(),
        "services": config.get("services").and_then(Value::as_object).map(|v| v.len()).unwrap_or(0),
        "configuration_changes": changes,
        "images": images.clone(),
    });
    info("plan", format!("Plano validado: {} serviço(s).", plan["services"]), Some(48));

    let mut receipt = DeployReceipt {
        schema_version: 1,
        installer_version: INSTALLER_VERSION.into(),
        repository: source.repo().into(),
        commit: sha.clone(),
        environment: request.environment.as_str().into(),
        version: tag.clone(),
        deployment: request.deployment.clone(),
        directory: directory.to_string_lossy().into_owned(),
        status: "PLANNED".into(),
        data_backup: false,
        source_blobs: serde_json::to_value(&source.proofs)?,
        images: images.clone(),
        result: Some(plan),
    };

    if matches!(request.action, DeployAction::Plan) {
        return Ok(receipt);
    }

    if matches!(request.action, DeployAction::Apply) {
        ensure_apply_host(&docker_env, spec.full_platform)?;
        info("pull", "Baixando todas as imagens antes de atualizar containers...", Some(58));
        compose_pull(stage.path(), stage.path(), &docker_env)?;
        if tag == "develop" {
            verify_develop_revisions(&values, &images, &sha, &docker_env)?;
        }
    }

    receipt.status = "PREPARED".into();
    receipt.result = None;
    info("save", "Gravando configuração com backup transacional...", Some(70));
    save_stack(&directory, &compose, environment.as_str(), &serde_json::to_value(&receipt)?)?;

    if request.install_dockge {
        if !matches!(request.action, DeployAction::Apply) || !request.accept_docker_socket {
            return Err(AgentError::msg(
                "Instalar Dockge requer ação aplicar e autorização explícita do Docker socket.",
            ));
        }
        info("dockge", "Instalando Dockge em stack separada...", Some(75));
        install_dockge(
            Path::new(&request.dockge_directory),
            directory.parent().unwrap_or(Path::new("/opt/stacks")),
            &docker_env,
        )?;
    }

    if matches!(request.action, DeployAction::Apply) {
        info("compose", "Subindo a stack sem build local e sem novo pull...", Some(82));
        compose_up(&directory, &docker_env)?;
        info("health", "Aguardando readiness/health checks...", Some(90));
        let result = readiness(&directory, &docker_env, request.wait_seconds)?;
        let status = result
            .get("status")
            .and_then(Value::as_str)
            .unwrap_or("PENDING_OR_FAILED")
            .to_string();
        receipt.status = status;
        receipt.result = Some(result);
        write_private(
            &directory.join(".connect-install.json"),
            serde_json::to_string_pretty(&receipt)?.as_bytes(),
            0o600,
        )?;
    }
    Ok(receipt)
}

fn validate_request(request: &DeployRequest) -> Result<()> {
    if request.protocol_version != PROTOCOL_VERSION {
        return Err(AgentError::msg(format!(
            "Versão de protocolo incompatível. Desktop={}, agente={PROTOCOL_VERSION}.",
            request.protocol_version
        )));
    }
    if request.wait_seconds > 3600 {
        return Err(AgentError::msg("wait_seconds deve estar entre 0 e 3600."));
    }
    if request.repository.trim().is_empty()
        || request.version.trim().is_empty()
        || request.deployment.trim().is_empty()
        || request.directory.trim().is_empty()
    {
        return Err(AgentError::msg("Solicitação de deploy incompleta."));
    }
    if request.install_dockge {
        if !matches!(request.action, DeployAction::Apply) {
            return Err(AgentError::msg(
                "Instalar Dockge requer ação aplicar; plano/preparar não podem alterar a stack Dockge.",
            ));
        }
        if !request.accept_docker_socket {
            return Err(AgentError::msg(
                "Instalar Dockge requer autorização explícita do Docker socket.",
            ));
        }
    }
    Ok(())
}

fn ensure_linux() -> Result<()> {
    if std::env::consts::OS != "linux" {
        return Err(AgentError::msg(
            "O agente remoto deve executar no VPS Linux que hospeda Docker/CloudPanel.",
        ));
    }
    Ok(())
}

fn ensure_not_symlink(path: &Path, message: &str) -> Result<()> {
    if fs::symlink_metadata(path).ok().is_some_and(|m| m.file_type().is_symlink()) {
        return Err(AgentError::msg(message));
    }
    Ok(())
}

fn ensure_apply_host(docker_env: &DockerEnv, full_platform: bool) -> Result<()> {
    let info = docker_info(docker_env)?;
    if info.get("OSType").and_then(Value::as_str) != Some("linux") {
        return Err(AgentError::msg("Docker precisa executar containers Linux."));
    }
    if !docker_context_is_local(docker_env)? {
        return Err(AgentError::msg(
            "Deploy exige o Docker local do VPS, não um contexto remoto.",
        ));
    }
    if full_platform {
        let status = std::process::Command::new("sh")
            .args(["-c", "command -v clpctl >/dev/null 2>&1"])
            .status()?;
        if !status.success() {
            return Err(AgentError::msg(
                "CloudPanel/clpctl não está instalado neste VPS. O agente não modifica o sistema operacional.",
            ));
        }
    }
    Ok(())
}

fn verify_develop_revisions(
    values: &BTreeMap<String, String>,
    images: &[String],
    sha: &str,
    docker_env: &DockerEnv,
) -> Result<()> {
    for key in [
        "ARGWS_CONNECT_API_IMAGE",
        "ARGWS_CONNECT_PLATFORM_API_IMAGE",
        "ARGWS_CONNECT_PLATFORM_ACME_IMAGE",
        "ARGWS_CONNECT_PLATFORM_CLOUDPANEL_AGENT_IMAGE",
        "ARGWS_CONNECT_PGBOUNCER_IMAGE",
    ] {
        let Some(image) = values.get(key) else {
            continue;
        };
        if !images.contains(image) {
            continue;
        }
        let label = image_revision(image, docker_env)?;
        if label != sha {
            return Err(AgentError::msg(format!(
                "Imagem develop não corresponde ao código selecionado: {image}. Aguarde a publicação completa."
            )));
        }
    }
    Ok(())
}

fn install_dockge(directory: &Path, stacks: &Path, docker_env: &DockerEnv) -> Result<()> {
    let directory = safe_directory(
        directory
            .to_str()
            .ok_or_else(|| AgentError::msg("Diretório Dockge inválido."))?,
    )?;
    let stacks = safe_directory(
        stacks
            .to_str()
            .ok_or_else(|| AgentError::msg("Diretório das stacks inválido."))?,
    )?;
    if directory == stacks || directory.starts_with(&stacks) || stacks.starts_with(&directory) {
        return Err(AgentError::msg(
            "Dockge e raiz das stacks devem ser diretórios separados.",
        ));
    }
    if directory.exists() && fs::read_dir(&directory)?.next().is_some() {
        return Err(AgentError::msg(
            "Diretório Dockge já existe; sua configuração não será substituída.",
        ));
    }
    let config = json!({
        "name":"connect-dockge",
        "services":{
            "dockge":{
                "image":"louislam/dockge:1",
                "restart":"unless-stopped",
                "ports":["127.0.0.1:5001:5001"],
                "environment":{"DOCKGE_STACKS_DIR":stacks.to_string_lossy()},
                "volumes":[
                    "/var/run/docker.sock:/var/run/docker.sock",
                    "./data:/app/data",
                    format!("{}:{}", stacks.display(), stacks.display())
                ]
            }
        }
    });
    check_images(&config, docker_env)?;
    fs::create_dir_all(&stacks)?;
    let compose = serde_json::to_string_pretty(&config)?;
    save_stack(
        &directory,
        &compose,
        "",
        &json!({"component":"dockge","socket_access":"root-equivalent"}),
    )?;
    compose_up(&directory, docker_env)?;
    Ok(())
}
