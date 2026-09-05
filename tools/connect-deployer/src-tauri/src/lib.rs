mod agents;
mod commands;
mod error;
mod model;
mod ssh;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            commands::embedded_agent_status,
            commands::test_connection,
            commands::deploy,
        ])
        .run(tauri::generate_context!())
        .expect("error while running ARGWS Connect Deployer");
}

/// Offline identity check. Does not initialize a WebView, connect to SSH, or deploy.
pub fn self_check() -> std::result::Result<serde_json::Value, String> {
    let info: serde_json::Value = serde_json::from_str(include_str!("../build-info.json"))
        .map_err(|e| e.to_string())?;
    let status = agents::status();
    for arch in ["amd64", "arm64"] {
        if status[arch]["embedded"] != true || status[arch]["sha256"] != info["agents"][arch]["sha256"] {
            return Err(format!("Invalid or missing embedded Linux agent: {arch}"));
        }
    }
    Ok(serde_json::json!({"ok": true, "build": info, "agents": status,
                        "protocol": deployer_protocol::PROTOCOL_VERSION}))
}
