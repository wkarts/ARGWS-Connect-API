use crate::error::{DesktopError, Result};
use sha2::{Digest, Sha256};

include!(concat!(env!("OUT_DIR"), "/embedded_agents.rs"));

pub struct EmbeddedAgent {
    pub bytes: &'static [u8],
    pub architecture: &'static str,
    pub sha256: String,
}

pub fn for_uname(machine: &str) -> Result<EmbeddedAgent> {
    let normalized = machine.trim().to_ascii_lowercase();
    let (bytes, architecture) = match normalized.as_str() {
        "x86_64" | "amd64" => (AGENT_LINUX_AMD64, "amd64"),
        "aarch64" | "arm64" => (AGENT_LINUX_ARM64, "arm64"),
        other => {
            return Err(DesktopError::msg(format!(
                "Arquitetura Linux não suportada pelo pacote: {other}."
            )))
        }
    };
    if bytes.is_empty() {
        return Err(DesktopError::msg(format!(
            "O binário do agente Linux {architecture} não foi embutido neste build. Execute o build completo ou use o artefato gerado pelo GitHub Actions."
        )));
    }
    let sha256 = hex::encode(Sha256::digest(bytes));
    Ok(EmbeddedAgent {
        bytes,
        architecture,
        sha256,
    })
}

pub fn status() -> serde_json::Value {
    serde_json::json!({
        "amd64": {
            "embedded": !AGENT_LINUX_AMD64.is_empty(),
            "bytes": AGENT_LINUX_AMD64.len(),
            "sha256": if AGENT_LINUX_AMD64.is_empty() { None } else { Some(hex::encode(Sha256::digest(AGENT_LINUX_AMD64))) },
        },
        "arm64": {
            "embedded": !AGENT_LINUX_ARM64.is_empty(),
            "bytes": AGENT_LINUX_ARM64.len(),
            "sha256": if AGENT_LINUX_ARM64.is_empty() { None } else { Some(hex::encode(Sha256::digest(AGENT_LINUX_ARM64))) },
        }
    })
}
