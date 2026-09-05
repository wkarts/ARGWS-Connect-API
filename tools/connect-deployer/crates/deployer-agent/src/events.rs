use deployer_protocol::AgentEvent;
use std::io::{self, Write};

pub fn emit(event: AgentEvent) {
    if let Ok(line) = serde_json::to_string(&event) {
        let mut stdout = io::stdout().lock();
        let _ = writeln!(stdout, "{line}");
        let _ = stdout.flush();
    }
}

pub fn info(step: &str, message: impl Into<String>, progress: Option<u8>) {
    emit(AgentEvent::info(step, message, progress));
}

pub fn warning(step: &str, message: impl Into<String>) {
    emit(AgentEvent::warning(step, message));
}
