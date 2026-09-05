#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() -> std::process::ExitCode {
    let args: Vec<String> = std::env::args().collect();
    if args.len() == 3 && args[1] == "--self-check-file" {
        return match argws_connect_deployer_desktop_lib::self_check() {
            Ok(report) => match std::fs::write(&args[2], report.to_string()) {
                Ok(()) => std::process::ExitCode::SUCCESS,
                Err(_) => std::process::ExitCode::from(2),
            },
            Err(_) => std::process::ExitCode::from(2),
        };
    }
    if args.len() != 1 { return std::process::ExitCode::from(2); }
    argws_connect_deployer_desktop_lib::run();
    std::process::ExitCode::SUCCESS
}
