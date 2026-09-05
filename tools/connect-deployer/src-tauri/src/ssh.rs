use crate::error::{DesktopError, Result};
use crate::model::{AuthMethod, ConnectionInput};
use base64::Engine;
use sha2::{Digest, Sha256};
use ssh2::{CheckResult, KnownHostFileKind, OpenFlags, OpenType, Session};
use std::fs;
use std::io::{Read, Write};
use std::net::{SocketAddr, TcpStream, ToSocketAddrs};
use std::path::{Path, PathBuf};
use std::time::Duration;
use zeroize::Zeroizing;

pub struct SshClient {
    pub session: Session,
    pub fingerprint_sha256: String,
    pub host_key_type: String,
    pub known_host_status: String,
}

impl SshClient {
    pub fn connect(input: &ConnectionInput) -> Result<Self> {
        validate_input(input)?;
        let addresses = resolve_addresses(&input.host, input.port)?;
        let timeout = Duration::from_secs(input.connect_timeout_seconds.clamp(1, 120));
        let mut connected = None;
        for address in addresses {
            if let Ok(stream) = TcpStream::connect_timeout(&address, timeout) {
                connected = Some(stream);
                break;
            }
        }
        let tcp = connected
            .ok_or_else(|| DesktopError::msg("Não foi possível conectar à porta SSH do servidor."))?;
        tcp.set_read_timeout(Some(timeout))?;
        tcp.set_write_timeout(Some(timeout))?;

        let mut session = Session::new()?;
        session.set_tcp_stream(tcp);
        session.handshake()?;

        let (host_key, host_key_type) = session
            .host_key()
            .ok_or_else(|| DesktopError::msg("Servidor SSH não forneceu chave de host."))?;
        let fingerprint = base64::engine::general_purpose::STANDARD_NO_PAD.encode(Sha256::digest(host_key));
        let fingerprint_sha256 = format!("SHA256:{fingerprint}");
        let host_key_type_name = format!("{host_key_type:?}");
        let known_host_status = verify_known_host(&session, input, host_key, host_key_type)?;

        authenticate(&session, input)?;
        if !session.authenticated() {
            return Err(DesktopError::msg("Autenticação SSH não foi concluída."));
        }
        Ok(Self {
            session,
            fingerprint_sha256,
            host_key_type: host_key_type_name,
            known_host_status,
        })
    }

    pub fn exec(&self, command: &str) -> Result<(i32, String, String)> {
        let mut channel = self.session.channel_session()?;
        channel.exec(command)?;
        let mut stdout = String::new();
        channel.read_to_string(&mut stdout)?;
        let mut stderr = String::new();
        channel.stderr().read_to_string(&mut stderr)?;
        channel.wait_close()?;
        let status = channel.exit_status()?;
        Ok((status, stdout, stderr))
    }


    pub fn create_private_directory(&self, remote: &str, mode: i32) -> Result<()> {
        let sftp = self.session.sftp()?;
        sftp.mkdir(Path::new(remote), mode)?;
        let stat = sftp.stat(Path::new(remote))?;
        if stat.perm.is_some_and(|perm| perm & 0o077 != 0) {
            return Err(DesktopError::msg(format!(
                "Permissões remotas inseguras no diretório temporário: {remote}"
            )));
        }
        Ok(())
    }

    pub fn remote_sha256(&self, remote: &str, max_bytes: u64) -> Result<String> {
        let sftp = self.session.sftp()?;
        let stat = sftp.stat(Path::new(remote))?;
        if stat.size.is_some_and(|size| size > max_bytes) {
            return Err(DesktopError::msg("Agente remoto excede o tamanho máximo permitido."));
        }
        let mut file = sftp.open(Path::new(remote))?;
        let mut hasher = Sha256::new();
        let mut buffer = [0u8; 64 * 1024];
        let mut total = 0u64;
        loop {
            let read = file.read(&mut buffer)?;
            if read == 0 {
                break;
            }
            total = total.saturating_add(read as u64);
            if total > max_bytes {
                return Err(DesktopError::msg("Agente remoto excede o tamanho máximo permitido."));
            }
            hasher.update(&buffer[..read]);
        }
        Ok(hex::encode(hasher.finalize()))
    }

    pub fn remove_file_and_directory(&self, remote_file: &str, remote_dir: &str) -> Result<()> {
        let sftp = self.session.sftp()?;
        if sftp.stat(Path::new(remote_file)).is_ok() {
            sftp.unlink(Path::new(remote_file))?;
        }
        sftp.rmdir(Path::new(remote_dir))?;
        Ok(())
    }

    pub fn upload_private(&self, remote: &str, bytes: &[u8], mode: i32) -> Result<()> {
        let sftp = self.session.sftp()?;
        let mut file = sftp.open_mode(
            Path::new(remote),
            OpenFlags::WRITE | OpenFlags::CREATE | OpenFlags::TRUNCATE,
            mode,
            OpenType::File,
        )?;
        file.write_all(bytes)?;
        file.flush()?;
        // Alguns servidores SSH não expõem fsync@openssh.com; a ausência da extensão
        // não invalida o upload. A integridade é verificada depois por SHA-256 remoto.
        let _ = file.fsync();
        let stat = sftp.stat(Path::new(remote))?;
        if stat.perm.is_some_and(|perm| perm & 0o077 != 0) {
            return Err(DesktopError::msg(format!(
                "Permissões remotas inseguras no agente: {remote}"
            )));
        }
        Ok(())
    }
}

fn validate_input(input: &ConnectionInput) -> Result<()> {
    if input.host.trim().is_empty() || input.host.chars().any(char::is_whitespace) {
        return Err(DesktopError::msg("Host SSH inválido."));
    }
    if input.user.trim().is_empty() || input.user.chars().any(char::is_whitespace) {
        return Err(DesktopError::msg("Usuário SSH inválido."));
    }
    if input.port == 0 {
        return Err(DesktopError::msg("Porta SSH inválida."));
    }
    Ok(())
}

fn resolve_addresses(host: &str, port: u16) -> Result<Vec<SocketAddr>> {
    let addresses = (host, port).to_socket_addrs()?.collect::<Vec<_>>();
    if addresses.is_empty() {
        return Err(DesktopError::msg("Host SSH não pôde ser resolvido."));
    }
    Ok(addresses)
}

fn known_hosts_path(input: &ConnectionInput) -> Result<PathBuf> {
    if let Some(value) = &input.known_hosts_file {
        return Ok(PathBuf::from(value));
    }
    let home = dirs::home_dir().ok_or_else(|| DesktopError::msg("Diretório HOME não foi localizado."))?;
    Ok(home.join(".ssh").join("known_hosts"))
}

fn verify_known_host(
    session: &Session,
    input: &ConnectionInput,
    host_key: &[u8],
    host_key_type: ssh2::HostKeyType,
) -> Result<String> {
    let file = known_hosts_path(input)?;
    let mut known = session.known_hosts()?;
    if file.exists() {
        known.read_file(&file, KnownHostFileKind::OpenSSH)?;
    }
    match known.check_port(&input.host, input.port, host_key) {
        CheckResult::Match => Ok("known".into()),
        CheckResult::Mismatch => Err(DesktopError::msg(
            "A chave SSH do servidor mudou. Implantação bloqueada para evitar ataque MITM.",
        )),
        CheckResult::Failure => Err(DesktopError::msg("Falha ao validar known_hosts.")),
        CheckResult::NotFound => {
            if !input.accept_new_host_key {
                let fp = base64::engine::general_purpose::STANDARD_NO_PAD.encode(Sha256::digest(host_key));
                return Err(DesktopError::msg(format!(
                    "Host ainda não está em known_hosts. Fingerprint SHA256:{fp}. Marque 'Confiar em host novo' somente após conferir o servidor."
                )));
            }
            if let Some(parent) = file.parent() {
                fs::create_dir_all(parent)?;
                secure_ssh_directory(parent)?;
            }
            let label = if input.port == 22 {
                input.host.clone()
            } else {
                format!("[{}]:{}", input.host, input.port)
            };
            known.add(&label, host_key, "ARGWS Connect Deployer", host_key_type.into())?;
            known.write_file(&file, KnownHostFileKind::OpenSSH)?;
            Ok("added".into())
        }
    }
}

#[cfg(unix)]
fn secure_ssh_directory(path: &Path) -> Result<()> {
    use std::os::unix::fs::PermissionsExt;
    fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    Ok(())
}

#[cfg(not(unix))]
fn secure_ssh_directory(_path: &Path) -> Result<()> {
    Ok(())
}

fn authenticate(session: &Session, input: &ConnectionInput) -> Result<()> {
    match input.auth_method {
        AuthMethod::Password => {
            let password = Zeroizing::new(
                input
                    .password
                    .clone()
                    .ok_or_else(|| DesktopError::msg("Senha SSH não informada."))?,
            );
            session
                .userauth_password(&input.user, password.as_str())
                .map_err(|_| DesktopError::msg("Falha de autenticação SSH por senha."))?;
        }
        AuthMethod::Key => {
            let key = input
                .key_file
                .as_ref()
                .ok_or_else(|| DesktopError::msg("Arquivo de chave SSH não informado."))?;
            let passphrase = input.key_passphrase.as_ref().map(|v| Zeroizing::new(v.clone()));
            session
                .userauth_pubkey_file(
                    &input.user,
                    None,
                    Path::new(key),
                    passphrase.as_ref().map(|v| v.as_str()),
                )
                .map_err(|_| DesktopError::msg("Falha de autenticação com a chave SSH."))?;
        }
        AuthMethod::Agent => {
            let mut agent = session.agent()?;
            agent.connect()?;
            agent.list_identities()?;
            let identities = agent.identities()?;
            let mut authenticated = false;
            for identity in identities {
                if agent.userauth(&input.user, &identity).is_ok() {
                    authenticated = true;
                    break;
                }
            }
            if !authenticated {
                return Err(DesktopError::msg("Nenhuma identidade do SSH Agent autenticou no servidor."));
            }
        }
    }
    Ok(())
}
