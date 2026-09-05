mod deploy;
mod docker;
mod envfile;
mod error;
mod events;
mod github;
mod storage;

use clap::{Parser, Subcommand};
use deployer_protocol::{AgentEvent, DeployRequest};
use std::io::{self, Read};

#[derive(Parser)]
#[command(name = "connect-deploy-agent", version, about = "ARGWS Connect|API remote deployment agent")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Recebe DeployRequest JSON em stdin, emite AgentEvent JSONL em stdout.
    Execute,
    /// Validação mínima do binário sem tocar Docker ou filesystem da stack.
    SelfTest,
}

fn main() {
    let code = match run() {
        Ok(code) => code,
        Err(error) => {
            events::emit(AgentEvent::error("fatal", error.to_string()));
            2
        }
    };
    std::process::exit(code);
}

fn run() -> error::Result<i32> {
    let cli = Cli::parse();
    match cli.command {
        Command::SelfTest => {
            println!("{}", serde_json::json!({
                "ok": true,
                "version": env!("CARGO_PKG_VERSION"),
                "protocol": deployer_protocol::PROTOCOL_VERSION,
                "os": std::env::consts::OS,
                "arch": std::env::consts::ARCH,
            }));
            Ok(0)
        }
        Command::Execute => {
            let mut input = String::new();
            io::stdin().read_to_string(&mut input)?;
            if input.len() > 2_000_000 {
                return Err(error::AgentError::msg("Solicitação excede o limite de 2 MB."));
            }
            let request: DeployRequest = serde_json::from_str(&input)?;
            let receipt = deploy::execute(request)?;
            let ready = receipt.status == "SERVICES_READY" || receipt.status == "PREPARED" || receipt.status == "PLANNED";
            events::emit(AgentEvent::result(
                "complete",
                if ready { "Operação concluída." } else { "Operação concluída com serviços pendentes ou falhos." },
                serde_json::to_value(&receipt)?,
            ));
            Ok(if ready { 0 } else { 3 })
        }
    }
}
