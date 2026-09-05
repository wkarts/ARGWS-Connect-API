use thiserror::Error;

#[derive(Debug, Error)]
pub enum AgentError {
    #[error("{0}")]
    Message(String),
    #[error("Falha de I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("Falha HTTP: {0}")]
    Http(#[from] reqwest::Error),
    #[error("JSON inválido: {0}")]
    Json(#[from] serde_json::Error),
    #[error("Regex inválida: {0}")]
    Regex(#[from] regex::Error),
}

impl AgentError {
    pub fn msg(value: impl Into<String>) -> Self {
        Self::Message(value.into())
    }
}

pub type Result<T> = std::result::Result<T, AgentError>;
