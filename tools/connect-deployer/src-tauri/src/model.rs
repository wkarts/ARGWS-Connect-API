use deployer_protocol::DeployRequest;
use serde::{Deserialize, Serialize};

#[derive(Clone, Serialize, Deserialize)]
pub struct ConnectionInput {
    pub host: String,
    #[serde(default = "default_port")]
    pub port: u16,
    pub user: String,
    pub auth_method: AuthMethod,
    #[serde(default)]
    pub key_file: Option<String>,
    #[serde(default)]
    pub key_passphrase: Option<String>,
    #[serde(default)]
    pub password: Option<String>,
    #[serde(default)]
    pub known_hosts_file: Option<String>,
    #[serde(default)]
    pub accept_new_host_key: bool,
    #[serde(default)]
    pub sudo: bool,
    #[serde(default = "default_timeout")]
    pub connect_timeout_seconds: u64,
}

fn default_port() -> u16 {
    22
}

fn default_timeout() -> u64 {
    20
}

impl std::fmt::Debug for ConnectionInput {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ConnectionInput")
            .field("host", &self.host)
            .field("port", &self.port)
            .field("user", &self.user)
            .field("auth_method", &self.auth_method)
            .field("key_file", &self.key_file)
            .field("key_passphrase", &self.key_passphrase.as_ref().map(|_| "[REDACTED]"))
            .field("password", &self.password.as_ref().map(|_| "[REDACTED]"))
            .field("known_hosts_file", &self.known_hosts_file)
            .field("accept_new_host_key", &self.accept_new_host_key)
            .field("sudo", &self.sudo)
            .field("connect_timeout_seconds", &self.connect_timeout_seconds)
            .finish()
    }
}

#[derive(Clone, Copy, Debug, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AuthMethod {
    Key,
    Password,
    Agent,
}

#[derive(Clone, Serialize, Deserialize)]
pub struct DesktopDeployRequest {
    pub connection: ConnectionInput,
    pub deploy: DeployRequest,
    #[serde(default)]
    pub env_input_path: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ConnectionTestResult {
    pub fingerprint_sha256: String,
    pub host_key_type: String,
    pub known_host_status: String,
    pub server: deployer_protocol::ServerPreflight,
}
