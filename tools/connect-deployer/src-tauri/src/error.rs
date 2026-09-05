use thiserror::Error;

#[derive(Debug, Error)]
pub enum DesktopError {
    #[error("{0}")]
    Message(String),
    #[error("I/O: {0}")]
    Io(#[from] std::io::Error),
    #[error("SSH: {0}")]
    Ssh(#[from] ssh2::Error),
    #[error("JSON: {0}")]
    Json(#[from] serde_json::Error),
}

impl DesktopError {
    pub fn msg(value: impl Into<String>) -> Self {
        Self::Message(value.into())
    }
}

pub type Result<T> = std::result::Result<T, DesktopError>;
