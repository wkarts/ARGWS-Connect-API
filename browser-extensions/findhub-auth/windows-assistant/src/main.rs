#![cfg_attr(all(windows, not(test)), windows_subsystem = "windows")]
mod install;
#[cfg(windows)]
mod mutex;
#[cfg(windows)]
mod ui;
fn main() {
    let args: Vec<_> = std::env::args().skip(1).collect();
    #[cfg(windows)]
    let _guard = match mutex::InstallationMutex::acquire() {
        Ok(guard) => guard,
        Err(error) => {
            if args.is_empty() {
                ui::show_error(&error.to_string());
            }
            std::process::exit(2);
        }
    };
    if !args.is_empty() {
        let result = match args.as_slice() {
            [arg] if arg == "--install-files" => install::root().and_then(|p| install::install(&p)),
            [arg] if arg == "--verify-files" => install::root().and_then(|p| install::verify(&p)),
            _ => Err(std::io::Error::new(
                std::io::ErrorKind::InvalidInput,
                "Opção desconhecida.",
            )),
        };
        std::process::exit(if result.is_ok() { 0 } else { 1 });
    }
    #[cfg(windows)]
    ui::run();
    #[cfg(not(windows))]
    eprintln!("Este assistente é exclusivo do Windows. Use o ZIP da extensão nos demais sistemas.");
}
