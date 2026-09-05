use crate::error::{AgentError, Result};
use fs2::FileExt;
use serde_json::{json, Value};
use std::fs::{self, File, OpenOptions};
use std::io::Write;
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Component, Path, PathBuf};

pub struct InstallLock {
    _file: File,
}

impl InstallLock {
    pub fn acquire(directory: &Path) -> Result<Self> {
        let parent = directory
            .parent()
            .ok_or_else(|| AgentError::msg("Diretório da stack sem diretório pai."))?;
        fs::create_dir_all(parent)?;
        let name = directory
            .file_name()
            .and_then(|v| v.to_str())
            .ok_or_else(|| AgentError::msg("Diretório da stack inválido."))?;
        let path = parent.join(format!(".connect-{name}.lock"));
        if fs::symlink_metadata(&path).ok().is_some_and(|m| m.file_type().is_symlink()) {
            return Err(AgentError::msg("Arquivo de lock não pode ser link simbólico."));
        }
        let file = OpenOptions::new()
            .create(true)
            .read(true)
            .write(true)
            .mode(0o600)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)?;
        file.try_lock_exclusive()
            .map_err(|_| AgentError::msg("Outra instalação está usando este diretório."))?;
        Ok(Self { _file: file })
    }
}

pub fn safe_directory(value: &str) -> Result<PathBuf> {
    let path = PathBuf::from(value);
    if !path.is_absolute() {
        return Err(AgentError::msg("O diretório da stack precisa ser absoluto."));
    }
    if path.components().any(|component| matches!(component, Component::ParentDir | Component::CurDir)) {
        return Err(AgentError::msg(
            "O diretório da stack não pode conter componentes . ou ..",
        ));
    }
    for forbidden in ["/", "/opt", "/home", "/root", "/etc", "/var", "/tmp"] {
        if path == Path::new(forbidden) {
            return Err(AgentError::msg(
                "Escolha um diretório exclusivo da stack, não uma raiz do sistema.",
            ));
        }
    }
    let mut cursor = Some(path.as_path());
    while let Some(current) = cursor {
        if let Ok(meta) = fs::symlink_metadata(current) {
            if meta.file_type().is_symlink() {
                return Err(AgentError::msg(
                    "Diretórios da stack não podem conter links simbólicos.",
                ));
            }
        }
        cursor = current.parent();
    }
    Ok(path)
}

pub fn write_private(path: &Path, data: &[u8], mode: u32) -> Result<()> {
    if fs::symlink_metadata(path).ok().is_some_and(|m| m.file_type().is_symlink()) {
        return Err(AgentError::msg(format!(
            "Recusando sobrescrever link: {}",
            path.display()
        )));
    }
    let parent = path
        .parent()
        .ok_or_else(|| AgentError::msg("Arquivo sem diretório pai."))?;
    fs::create_dir_all(parent)?;
    let mut temporary = tempfile::NamedTempFile::new_in(parent)?;
    fs::set_permissions(temporary.path(), fs::Permissions::from_mode(mode))?;
    temporary.write_all(data)?;
    temporary.flush()?;
    temporary.as_file().sync_all()?;
    temporary
        .persist(path)
        .map_err(|e| AgentError::Io(e.error))?;
    fs::set_permissions(path, fs::Permissions::from_mode(mode))?;
    Ok(())
}

pub fn save_stack(directory: &Path, compose: &str, environment: &str, receipt: &Value) -> Result<()> {
    fs::create_dir_all(directory)?;
    let receipt_text = serde_json::to_string_pretty(receipt)?;
    let files: [(&str, &[u8]); 3] = [
        ("compose.yaml", compose.as_bytes()),
        (".env", environment.as_bytes()),
        (".connect-install.json", receipt_text.as_bytes()),
    ];

    let backup_root = directory.join(".connect-installer-backups");
    if fs::symlink_metadata(&backup_root).ok().is_some_and(|m| m.file_type().is_symlink()) {
        return Err(AgentError::msg("Diretório de backups não pode ser link simbólico."));
    }
    fs::create_dir_all(&backup_root)?;
    fs::set_permissions(&backup_root, fs::Permissions::from_mode(0o700))?;
    let timestamp = chrono::Utc::now().format("%Y%m%dT%H%M%S%6fZ").to_string();
    let backup = backup_root.join(timestamp);
    fs::create_dir_all(&backup)?;
    fs::set_permissions(&backup, fs::Permissions::from_mode(0o700))?;

    let mut existing = Vec::new();
    for (name, _) in &files {
        let target = directory.join(name);
        if fs::symlink_metadata(&target).ok().is_some_and(|m| m.file_type().is_symlink()) {
            return Err(AgentError::msg(format!(
                "Recusando arquivo de configuração simbólico: {name}"
            )));
        }
        if target.exists() {
            existing.push((*name).to_string());
            write_private(&backup.join(name), &fs::read(&target)?, 0o600)?;
        }
    }
    write_private(
        &backup.join("manifest.json"),
        serde_json::to_string(&json!({"existing": existing}))?.as_bytes(),
        0o600,
    )?;
    let pending = directory.join(".connect-installer-pending.json");
    let relative = backup
        .strip_prefix(directory)
        .map_err(|_| AgentError::msg("Backup fora da stack."))?;
    write_private(
        &pending,
        serde_json::to_string(&json!({"backup":relative.to_string_lossy()}))?.as_bytes(),
        0o600,
    )?;

    let result = (|| -> Result<()> {
        for (name, data) in &files {
            write_private(&directory.join(name), data, 0o600)?;
        }
        fs::remove_file(&pending)?;
        Ok(())
    })();
    if result.is_err() {
        let _ = recover_stack(directory);
    }
    result
}

pub fn recover_stack(directory: &Path) -> Result<()> {
    let pending = directory.join(".connect-installer-pending.json");
    if !pending.exists() {
        return Ok(());
    }
    let pending_value: Value = serde_json::from_slice(&fs::read(&pending)?)?;
    let relative = pending_value
        .get("backup")
        .and_then(Value::as_str)
        .ok_or_else(|| AgentError::msg("Journal de instalação inválido."))?;
    let backup = directory.join(relative);
    let backup_root = directory.join(".connect-installer-backups");
    let canonical_root = backup_root.canonicalize()?;
    let canonical_backup = backup.canonicalize()?;
    if !canonical_backup.starts_with(&canonical_root) {
        return Err(AgentError::msg("Journal de instalação inválido."));
    }
    let manifest: Value = serde_json::from_slice(&fs::read(backup.join("manifest.json"))?)?;
    let existing = manifest
        .get("existing")
        .and_then(Value::as_array)
        .ok_or_else(|| AgentError::msg("Manifesto de backup inválido."))?;
    for name in ["compose.yaml", ".env", ".connect-install.json"] {
        if existing.iter().any(|v| v.as_str() == Some(name)) {
            write_private(&directory.join(name), &fs::read(backup.join(name))?, 0o600)?;
        } else if directory.join(name).exists() {
            fs::remove_file(directory.join(name))?;
        }
    }
    fs::remove_file(pending)?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_parent_components() {
        assert!(safe_directory("/opt/stacks/../etc/connect").is_err());
    }

    #[test]
    fn rejects_system_roots() {
        assert!(safe_directory("/opt").is_err());
        assert!(safe_directory("/tmp").is_err());
    }

    #[test]
    fn accepts_dedicated_stack_path() {
        assert_eq!(
            safe_directory("/opt/stacks/argws-connect-platform-production").unwrap(),
            PathBuf::from("/opt/stacks/argws-connect-platform-production")
        );
    }
}
