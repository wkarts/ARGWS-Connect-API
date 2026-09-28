use std::{
    fs,
    io::{self, Write},
    path::{Path, PathBuf},
    time::{SystemTime, UNIX_EPOCH},
};
include!(concat!(env!("OUT_DIR"), "/payload.rs"));
// Unique across concurrent operations even on a coarse Windows system clock.
fn unique_id() -> String {
    use std::sync::atomic::{AtomicU64, Ordering};
    static NEXT: AtomicU64 = AtomicU64::new(0);
    format!(
        "{}-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos(),
        NEXT.fetch_add(1, Ordering::Relaxed)
    )
}

pub const VERSION: &str = env!("FINDHUB_EXTENSION_VERSION");
pub const ID: &str = "dcnejnlafhanlldafkijledmonimkgng";
const MARKER: &str = "installed-by-connect.json";
fn invalid(text: &str) -> io::Error {
    io::Error::new(io::ErrorKind::InvalidData, text)
}
fn reparse(meta: &fs::Metadata) -> bool {
    #[cfg(windows)]
    {
        use std::os::windows::fs::MetadataExt;
        meta.file_attributes() & 0x400 != 0
    }
    #[cfg(not(windows))]
    {
        meta.file_type().is_symlink()
    }
}
fn safe_path(path: &Path) -> io::Result<()> {
    for parent in path.ancestors() {
        match fs::symlink_metadata(parent) {
            Ok(meta) if reparse(&meta) => {
                return Err(invalid(
                    "A pasta contém link/junction. Nenhum arquivo foi alterado.",
                ))
            }
            Ok(_) => {}
            Err(e) if e.kind() == io::ErrorKind::NotFound => {}
            Err(e) => return Err(e),
        }
    }
    Ok(())
}
fn safe_tree(path: &Path) -> io::Result<()> {
    safe_path(path)?;
    if path.is_dir() {
        for item in fs::read_dir(path)? {
            safe_tree(&item?.path())?;
        }
    }
    Ok(())
}
fn owned(root: &Path) -> io::Result<bool> {
    if !root.join("extension").exists() && !root.join(MARKER).exists() {
        return Ok(false);
    }
    safe_tree(&root.join("extension"))?;
    safe_path(&root.join(MARKER))?;
    let marker = fs::read_to_string(root.join(MARKER))?;
    if marker.len() > 65536 || !marker.contains(ID) {
        return Err(invalid(
            "Pasta sem identificação válida da extensão. Nada foi substituído.",
        ));
    }
    Ok(true)
}
fn manifest_version(bytes: &[u8]) -> Option<(u16, u16, u16)> {
    let text = std::str::from_utf8(bytes).ok()?;
    let value = text.split("\"version\"").nth(1)?.split('"').nth(1)?;
    let n: Vec<_> = value
        .split('.')
        .map(str::parse::<u16>)
        .collect::<Result<_, _>>()
        .ok()?;
    (n.len() == 3).then(|| (n[0], n[1], n[2]))
}
fn save(path: &Path, data: &[u8]) -> io::Result<()> {
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)?;
    }
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .open(path)?;
    file.write_all(data)?;
    file.sync_all()?;
    if fs::read(path)? != data {
        return Err(invalid("Falha ao verificar arquivos gravados."));
    }
    Ok(())
}
struct Lock(PathBuf);
impl Drop for Lock {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}
fn lock(root: &Path) -> io::Result<Lock> {
    safe_path(root)?;
    fs::create_dir_all(root)?;
    let path = root.join(".rust-install.lock");
    fs::OpenOptions::new().write(true).create_new(true).open(&path).map_err(|_| invalid("Outra instalação está em execução ou foi interrompida. Preserve a pasta e seus backups."))?;
    Ok(Lock(path))
}
pub fn install(root: &Path) -> io::Result<()> {
    safe_path(root)?;
    let managed = owned(root)?;
    if root.exists() && !managed && fs::read_dir(root)?.next().is_some() {
        return Err(invalid(
            "Pasta de destino não vazia e sem marcador. Nenhum arquivo foi alterado.",
        ));
    }
    if managed {
        let old = manifest_version(&fs::read(root.join("extension/manifest.json"))?);
        let new = FILES
            .iter()
            .find(|(p, _)| *p == "manifest.json")
            .and_then(|(_, b)| manifest_version(b));
        if old.is_none() || new.is_none() || old > new {
            return Err(invalid(
                "Downgrade ou manifesto inválido recusado. Use um instalador mais recente.",
            ));
        }
    }
    let _lock = lock(root)?;
    let stamp = unique_id();
    let stage = root.join(format!(".stage-{}-{stamp}", std::process::id()));
    let backup = root.join("backups").join(stamp.to_string());
    let marker=format!("{{\"schema\":1,\"version\":\"{VERSION}\",\"extensionId\":\"{ID}\",\"installer\":\"rust\",\"browserApprovalRequired\":true}}\n");
    let operation = (|| {
        fs::create_dir(&stage)?;
        for (name, bytes) in FILES {
            save(&stage.join(name), bytes)?;
        }
        verify_dir(&stage)?;
        if managed {
            safe_path(&root.join("backups"))?;
            fs::create_dir_all(&backup)?;
            fs::copy(root.join(MARKER), backup.join(MARKER))?;
            fs::rename(root.join("extension"), backup.join("extension"))?;
        }
        if let Err(e) = fs::rename(&stage, root.join("extension")) {
            if managed {
                fs::rename(backup.join("extension"), root.join("extension"))?;
            }
            return Err(e);
        }
        let marker_stage = root.join(format!(".marker-{stamp}"));
        let metadata_result = (|| {
            save(&marker_stage, marker.as_bytes())?;
            if managed {
                fs::remove_file(root.join(MARKER))?;
            }
            fs::rename(&marker_stage, root.join(MARKER))
        })();
        if let Err(e) = metadata_result {
            // Never leave a half-promoted payload. Retain backups if recovery itself fails.
            safe_tree(&root.join("extension"))?;
            fs::remove_dir_all(root.join("extension"))?;
            if managed {
                fs::rename(backup.join("extension"), root.join("extension"))?;
                fs::copy(backup.join(MARKER), root.join(MARKER))?;
            }
            let _ = fs::remove_file(marker_stage);
            return Err(e);
        }
        Ok(())
    })();
    if stage.exists() {
        safe_tree(&stage)?;
        fs::remove_dir_all(stage)?;
    }
    operation
}
fn verify_dir(path: &Path) -> io::Result<()> {
    safe_tree(path)?;
    for (name, bytes) in FILES {
        if fs::read(path.join(name))? != *bytes {
            return Err(invalid(
                "Arquivos diferentes da versão embutida. Instale/atualize novamente.",
            ));
        }
    }
    Ok(())
}
pub fn verify(root: &Path) -> io::Result<()> {
    if !owned(root)? {
        return Err(invalid("Extensão ainda não preparada nesta pasta."));
    }
    verify_dir(&root.join("extension"))
}
pub fn root() -> io::Result<PathBuf> {
    let local =
        std::env::var_os("LOCALAPPDATA").ok_or_else(|| invalid("LOCALAPPDATA indisponível."))?;
    let base = PathBuf::from(local);
    if !base.is_absolute() {
        return Err(invalid("LOCALAPPDATA precisa ser absoluto."));
    }
    Ok(base.join("ARGWS").join("ConnectFindHubAuth"))
}
#[cfg(test)]
mod tests {
    use super::*;
    fn temp() -> PathBuf {
        std::env::temp_dir().join(format!("findhub-rust-test-{}", unique_id()))
    }
    #[test]
    fn fresh_install_and_verify() {
        let p = temp();
        install(&p).unwrap();
        verify(&p).unwrap();
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn update_retains_previous_payload() {
        let p = temp();
        install(&p).unwrap();
        install(&p).unwrap();
        verify(&p).unwrap();
        assert_eq!(fs::read_dir(p.join("backups")).unwrap().count(), 1);
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn unmanaged_directory_is_never_replaced() {
        let p = temp();
        fs::create_dir(&p).unwrap();
        fs::write(p.join("personal.txt"), b"preserve").unwrap();
        assert!(install(&p).is_err());
        assert_eq!(fs::read(p.join("personal.txt")).unwrap(), b"preserve");
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn corruption_is_detected() {
        let p = temp();
        install(&p).unwrap();
        fs::write(p.join("extension/background.js"), b"changed").unwrap();
        assert!(verify(&p).is_err());
        install(&p).unwrap();
        verify(&p).unwrap();
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn existing_lock_is_not_deleted() {
        let p = temp();
        install(&p).unwrap();
        fs::write(p.join(".rust-install.lock"), b"occupied").unwrap();
        assert!(install(&p).is_err());
        assert!(p.join(".rust-install.lock").exists());
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn downgrade_is_refused() {
        let p = temp();
        install(&p).unwrap();
        fs::write(
            p.join("extension/manifest.json"),
            br#"{"version":"65535.0.0"}"#,
        )
        .unwrap();
        assert!(install(&p).is_err());
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn extra_files_are_preserved_in_backup() {
        let p = temp();
        install(&p).unwrap();
        fs::write(p.join("extension/private.txt"), b"keep").unwrap();
        install(&p).unwrap();
        let backup = fs::read_dir(p.join("backups"))
            .unwrap()
            .next()
            .unwrap()
            .unwrap()
            .path();
        assert_eq!(
            fs::read(backup.join("extension/private.txt")).unwrap(),
            b"keep"
        );
        fs::remove_dir_all(p).unwrap();
    }
    #[test]
    fn malformed_version_is_refused() {
        assert_eq!(manifest_version(br#"{"version":"1.2.3"}"#), Some((1, 2, 3)));
        assert_eq!(manifest_version(br#"{"version":"no"}"#), None);
    }
}
