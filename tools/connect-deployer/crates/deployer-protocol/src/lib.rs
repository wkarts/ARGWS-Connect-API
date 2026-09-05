use serde::{Deserialize, Serialize};

pub const PROTOCOL_VERSION: u32 = 1;
pub const AGENT_ASSET_AMD64: &str = "connect-deploy-agent-linux-amd64";
pub const AGENT_ASSET_ARM64: &str = "connect-deploy-agent-linux-arm64";

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum Environment {
    Develop,
    Production,
}

impl Environment {
    pub fn as_str(&self) -> &'static str {
        match self {
            Self::Develop => "develop",
            Self::Production => "production",
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum DeployAction {
    Plan,
    Prepare,
    Apply,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DeployRequest {
    pub protocol_version: u32,
    pub repository: String,
    pub environment: Environment,
    pub version: String,
    pub deployment: String,
    pub directory: String,
    pub action: DeployAction,

    #[serde(default)]
    pub platform_admin_email: Option<String>,
    #[serde(default)]
    pub platform_domain: Option<String>,
    #[serde(default)]
    pub acme_email: Option<String>,
    #[serde(default)]
    pub cloudflare_api_token: Option<String>,
    #[serde(default)]
    pub cloudflare_tenant_record_target: Option<String>,

    #[serde(default)]
    pub github_token: Option<String>,
    #[serde(default)]
    pub registry_user: Option<String>,
    #[serde(default)]
    pub registry_token: Option<String>,

    #[serde(default)]
    pub env_input: Option<String>,

    #[serde(default)]
    pub accept_host_agent: bool,
    #[serde(default)]
    pub install_dockge: bool,
    #[serde(default)]
    pub accept_docker_socket: bool,
    #[serde(default = "default_dockge_directory")]
    pub dockge_directory: String,
    #[serde(default = "default_wait_seconds")]
    pub wait_seconds: u64,
}

fn default_dockge_directory() -> String {
    "/opt/dockge".into()
}

fn default_wait_seconds() -> u64 {
    180
}

impl std::fmt::Debug for DeployRequest {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("DeployRequest")
            .field("protocol_version", &self.protocol_version)
            .field("repository", &self.repository)
            .field("environment", &self.environment)
            .field("version", &self.version)
            .field("deployment", &self.deployment)
            .field("directory", &self.directory)
            .field("action", &self.action)
            .field("platform_admin_email", &self.platform_admin_email)
            .field("platform_domain", &self.platform_domain)
            .field("acme_email", &self.acme_email)
            .field("cloudflare_api_token", &self.cloudflare_api_token.as_ref().map(|_| "[REDACTED]"))
            .field("cloudflare_tenant_record_target", &self.cloudflare_tenant_record_target)
            .field("github_token", &self.github_token.as_ref().map(|_| "[REDACTED]"))
            .field("registry_user", &self.registry_user)
            .field("registry_token", &self.registry_token.as_ref().map(|_| "[REDACTED]"))
            .field("env_input", &self.env_input.as_ref().map(|_| "[REDACTED_ENV]"))
            .field("accept_host_agent", &self.accept_host_agent)
            .field("install_dockge", &self.install_dockge)
            .field("accept_docker_socket", &self.accept_docker_socket)
            .field("dockge_directory", &self.dockge_directory)
            .field("wait_seconds", &self.wait_seconds)
            .finish()
    }
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct AgentEvent {
    pub protocol_version: u32,
    pub kind: EventKind,
    pub step: String,
    pub message: String,
    #[serde(default)]
    pub progress: Option<u8>,
    #[serde(default)]
    pub data: Option<serde_json::Value>,
}

impl AgentEvent {
    pub fn info(step: impl Into<String>, message: impl Into<String>, progress: Option<u8>) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            kind: EventKind::Info,
            step: step.into(),
            message: message.into(),
            progress,
            data: None,
        }
    }

    pub fn warning(step: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            kind: EventKind::Warning,
            step: step.into(),
            message: message.into(),
            progress: None,
            data: None,
        }
    }

    pub fn result(step: impl Into<String>, message: impl Into<String>, data: serde_json::Value) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            kind: EventKind::Result,
            step: step.into(),
            message: message.into(),
            progress: Some(100),
            data: Some(data),
        }
    }

    pub fn error(step: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            protocol_version: PROTOCOL_VERSION,
            kind: EventKind::Error,
            step: step.into(),
            message: message.into(),
            progress: None,
            data: None,
        }
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum EventKind {
    Info,
    Warning,
    Error,
    Result,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ServerPreflight {
    pub os: String,
    pub architecture: String,
    pub kernel: String,
    pub docker_available: bool,
    pub docker_version: Option<String>,
    pub compose_available: bool,
    pub compose_version: Option<String>,
    pub cloudpanel_available: bool,
    pub clpctl_available: bool,
    pub disk_available_bytes: Option<u64>,
    pub effective_user: String,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct DeployReceipt {
    pub schema_version: u32,
    pub installer_version: String,
    pub repository: String,
    pub commit: String,
    pub environment: String,
    pub version: String,
    pub deployment: String,
    pub directory: String,
    pub status: String,
    pub data_backup: bool,
    pub source_blobs: serde_json::Value,
    pub images: Vec<String>,
    pub result: Option<serde_json::Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deploy_request_debug_redacts_secrets() {
        let request = DeployRequest {
            protocol_version: PROTOCOL_VERSION,
            repository: "owner/repo".into(),
            environment: Environment::Production,
            version: "latest".into(),
            deployment: "platform-production".into(),
            directory: "/opt/stacks/test".into(),
            action: DeployAction::Plan,
            platform_admin_email: None,
            platform_domain: None,
            acme_email: None,
            cloudflare_api_token: Some("cf-secret".into()),
            cloudflare_tenant_record_target: None,
            github_token: Some("gh-secret".into()),
            registry_user: None,
            registry_token: Some("registry-secret".into()),
            env_input: Some("APP_SECRET_KEY=very-secret".into()),
            accept_host_agent: false,
            install_dockge: false,
            accept_docker_socket: false,
            dockge_directory: "/opt/dockge".into(),
            wait_seconds: 180,
        };
        let debug = format!("{request:?}");
        assert!(!debug.contains("cf-secret"));
        assert!(!debug.contains("gh-secret"));
        assert!(!debug.contains("registry-secret"));
        assert!(!debug.contains("very-secret"));
    }
}
