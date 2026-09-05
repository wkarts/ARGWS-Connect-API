from __future__ import annotations

import getpass
import os
import shlex
import socket
import stat
import sys
import time
import uuid
from dataclasses import dataclass
from pathlib import Path
from typing import Iterable

import paramiko


class SSHDeployError(RuntimeError):
    pass


@dataclass(slots=True)
class SSHOptions:
    host: str
    user: str
    port: int = 22
    key_file: Path | None = None
    ask_password: bool = False
    accept_new_host_key: bool = False
    known_hosts: Path | None = None
    connect_timeout: int = 20
    sudo: bool = False
    python_command: str = "python3"


class _SaveNewHostKeyPolicy(paramiko.MissingHostKeyPolicy):
    def __init__(self, known_hosts: Path):
        self.known_hosts = known_hosts

    def missing_host_key(self, client: paramiko.SSHClient, hostname: str, key: paramiko.PKey) -> None:
        self.known_hosts.parent.mkdir(parents=True, exist_ok=True)
        self.known_hosts.touch(mode=0o600, exist_ok=True)
        try:
            os.chmod(self.known_hosts, 0o600)
        except OSError:
            pass
        client.get_host_keys().add(hostname, key.get_name(), key)
        client.save_host_keys(str(self.known_hosts))
        fingerprint = key.get_fingerprint().hex(":")
        print(f"Host SSH adicionado a {self.known_hosts}: {hostname} ({key.get_name()} {fingerprint})")


def default_known_hosts() -> Path:
    return Path.home() / ".ssh" / "known_hosts"


def connect(options: SSHOptions) -> paramiko.SSHClient:
    if not options.host or any(c.isspace() for c in options.host):
        raise SSHDeployError("Host SSH inválido.")
    if not options.user or any(c.isspace() for c in options.user):
        raise SSHDeployError("Usuário SSH inválido.")
    if not 1 <= options.port <= 65535:
        raise SSHDeployError("Porta SSH inválida.")
    if options.connect_timeout <= 0:
        raise SSHDeployError("Timeout de conexão SSH deve ser maior que zero.")

    known_hosts = (options.known_hosts or default_known_hosts()).expanduser()
    client = paramiko.SSHClient()
    client.load_system_host_keys()
    if known_hosts.exists():
        client.load_host_keys(str(known_hosts))

    if options.accept_new_host_key:
        client.set_missing_host_key_policy(_SaveNewHostKeyPolicy(known_hosts))
    else:
        client.set_missing_host_key_policy(paramiko.RejectPolicy())

    password = getpass.getpass("Senha SSH: ") if options.ask_password else None

    try:
        client.connect(
            hostname=options.host,
            port=options.port,
            username=options.user,
            password=password,
            key_filename=str(options.key_file.expanduser()) if options.key_file else None,
            timeout=options.connect_timeout,
            banner_timeout=options.connect_timeout,
            auth_timeout=options.connect_timeout,
            allow_agent=password is None,
            look_for_keys=password is None and options.key_file is None,
        )
    except paramiko.BadHostKeyException as exc:
        raise SSHDeployError(f"Chave SSH do host mudou ou não confere: {exc.hostname}.") from None
    except paramiko.AuthenticationException:
        raise SSHDeployError("Falha de autenticação SSH. Confira usuário, chave ou senha.") from None
    except (paramiko.SSHException, socket.error, TimeoutError) as exc:
        raise SSHDeployError(f"Falha na conexão SSH: {type(exc).__name__}.") from None
    return client


def run_capture(client: paramiko.SSHClient, command: str, timeout: int = 30) -> tuple[int, str, str]:
    try:
        stdin, stdout, stderr = client.exec_command(command, timeout=timeout, get_pty=False)
        stdin.close()
        out = stdout.read().decode("utf-8", errors="replace")
        err = stderr.read().decode("utf-8", errors="replace")
        code = stdout.channel.recv_exit_status()
        return code, out, err
    except (paramiko.SSHException, socket.error) as exc:
        raise SSHDeployError(f"Falha ao executar comando remoto: {type(exc).__name__}.") from None


def stream_command(client: paramiko.SSHClient, command: str, timeout: int | None = None) -> int:
    transport = client.get_transport()
    if not transport or not transport.is_active():
        raise SSHDeployError("Sessão SSH não está ativa.")

    channel = transport.open_session(timeout=20)
    channel.exec_command(command)
    started = time.monotonic()

    while True:
        progressed = False
        if channel.recv_ready():
            data = channel.recv(65536)
            if data:
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
                progressed = True
        if channel.recv_stderr_ready():
            data = channel.recv_stderr(65536)
            if data:
                sys.stderr.buffer.write(data)
                sys.stderr.buffer.flush()
                progressed = True
        if channel.exit_status_ready() and not channel.recv_ready() and not channel.recv_stderr_ready():
            break
        if timeout is not None and time.monotonic() - started > timeout:
            channel.close()
            raise SSHDeployError("Tempo limite da execução remota excedido.")
        if not progressed:
            time.sleep(0.05)

    return channel.recv_exit_status()


def _sftp_mkdir(sftp: paramiko.SFTPClient, path: str, mode: int = 0o700) -> None:
    try:
        sftp.mkdir(path, mode=mode)
    except OSError as exc:
        raise SSHDeployError(f"Não foi possível criar diretório remoto temporário: {path}") from exc


def _upload_private(sftp: paramiko.SFTPClient, local: Path, remote: str, mode: int = 0o600) -> None:
    # Create first, chmod before writing bytes, so secrets are never transiently world-readable.
    with local.open("rb") as source, sftp.file(remote, "wb") as target:
        sftp.chmod(remote, mode)
        while chunk := source.read(1024 * 1024):
            target.write(chunk)
        target.flush()
    attrs = sftp.stat(remote)
    if stat.S_IMODE(attrs.st_mode) & 0o077:
        raise SSHDeployError(f"Permissões remotas inseguras em {remote}.")


def _upload_secret_text(sftp: paramiko.SFTPClient, remote: str, secret: str) -> None:
    with sftp.file(remote, "w") as stream:
        sftp.chmod(remote, 0o600)
        stream.write(secret)
        stream.flush()


def prepare_remote_directory(client: paramiko.SSHClient) -> str:
    base = f"/tmp/argws-connect-deployer-{uuid.uuid4().hex}"
    sftp = client.open_sftp()
    try:
        _sftp_mkdir(sftp, base, 0o700)
    finally:
        sftp.close()
    return base


def upload_bundle(
    client: paramiko.SSHClient,
    remote_dir: str,
    payload: Path,
    env_input: Path | None,
    github_token: str | None,
    registry_token: str | None,
) -> dict[str, str]:
    sftp = client.open_sftp()
    paths: dict[str, str] = {}
    try:
        remote_payload = f"{remote_dir}/install-connect.py"
        _upload_private(sftp, payload, remote_payload, 0o700)
        paths["payload"] = remote_payload

        if env_input:
            remote_env = f"{remote_dir}/env.input"
            _upload_private(sftp, env_input.expanduser().resolve(), remote_env, 0o600)
            paths["env_input"] = remote_env
        if github_token:
            remote_secret = f"{remote_dir}/github.token"
            _upload_secret_text(sftp, remote_secret, github_token)
            paths["github_token"] = remote_secret
        if registry_token:
            remote_secret = f"{remote_dir}/registry.token"
            _upload_secret_text(sftp, remote_secret, registry_token)
            paths["registry_token"] = remote_secret
    finally:
        sftp.close()
    return paths


def cleanup_remote(client: paramiko.SSHClient, remote_dir: str) -> None:
    # remote_dir is generated internally and never supplied by the user.
    if not remote_dir.startswith("/tmp/argws-connect-deployer-"):
        raise SSHDeployError("Recusando limpar diretório remoto fora do namespace temporário.")
    run_capture(client, "rm -rf -- " + shlex.quote(remote_dir), timeout=30)


def remote_preflight(client: paramiko.SSHClient, python_command: str, sudo: bool) -> None:
    quoted_python = shlex.quote(python_command)
    code, out, _ = run_capture(
        client,
        f"{quoted_python} -c 'import sys; print(sys.version_info.major, sys.version_info.minor)'",
        timeout=20,
    )
    if code != 0:
        raise SSHDeployError(f"{python_command} não está disponível no VPS.")
    parts = out.strip().split()
    try:
        version = (int(parts[0]), int(parts[1]))
    except (IndexError, ValueError):
        raise SSHDeployError("Não foi possível identificar a versão do Python remoto.") from None
    if version < (3, 10):
        raise SSHDeployError("O VPS precisa de Python 3.10 ou superior para o payload atual.")

    code, _, _ = run_capture(client, "command -v docker >/dev/null 2>&1", timeout=20)
    if code != 0:
        raise SSHDeployError("Docker não foi encontrado no VPS.")

    if sudo:
        code, _, _ = run_capture(client, "sudo -n true", timeout=20)
        if code != 0:
            raise SSHDeployError(
                "--sudo exige sudo não-interativo para este usuário. Configure NOPASSWD para o comando de implantação "
                "ou conecte como um usuário que já possua acesso ao Docker/CloudPanel."
            )


def build_remote_command(
    *,
    options: SSHOptions,
    paths: dict[str, str],
    installer_args: Iterable[str],
) -> str:
    args = list(installer_args)
    if paths.get("env_input") and "--env-input" not in args:
        args.extend(["--env-input", paths["env_input"]])

    env_parts: list[str] = []
    if paths.get("github_token"):
        env_parts.append("GH_TOKEN_FILE=" + shlex.quote(paths["github_token"]))
    if paths.get("registry_token"):
        env_parts.append("ARGWS_CONNECT_GHCR_TOKEN_FILE=" + shlex.quote(paths["registry_token"]))

    executable = [options.python_command, paths["payload"], *args]
    command = " ".join(shlex.quote(part) for part in executable)
    prefix = " ".join(env_parts)
    if prefix:
        command = prefix + " " + command
    if options.sudo:
        # env variables are deliberately set after sudo through env(1), avoiding sudo -E.
        if env_parts:
            env_assignments = " ".join(env_parts)
            command = "sudo -n env " + env_assignments + " " + " ".join(
                shlex.quote(part) for part in executable
            )
        else:
            command = "sudo -n " + command
    return command


def stream_command_interactive(client: paramiko.SSHClient, command: str, timeout: int | None = None) -> int:
    """Bridge the local terminal to a remote PTY so the installer can prompt safely."""
    import shutil as _shutil

    transport = client.get_transport()
    if not transport or not transport.is_active():
        raise SSHDeployError("Sessão SSH não está ativa.")

    size = _shutil.get_terminal_size(fallback=(120, 40))
    channel = transport.open_session(timeout=20)
    channel.get_pty(term=os.environ.get("TERM", "xterm-256color"), width=size.columns, height=size.lines)
    channel.exec_command(command)
    started = time.monotonic()

    if os.name == "nt":
        import msvcrt

        while True:
            while channel.recv_ready():
                data = channel.recv(65536)
                if data:
                    sys.stdout.buffer.write(data)
                    sys.stdout.buffer.flush()
            while msvcrt.kbhit():
                ch = msvcrt.getwch()
                if ch in ("\x00", "\xe0"):
                    # Consume Windows special-key scan code and ignore it.
                    if msvcrt.kbhit():
                        msvcrt.getwch()
                    continue
                channel.send(ch.encode("utf-8", errors="ignore"))
            if channel.exit_status_ready() and not channel.recv_ready():
                break
            if timeout is not None and time.monotonic() - started > timeout:
                channel.close()
                raise SSHDeployError("Tempo limite da execução remota excedido.")
            time.sleep(0.02)
    else:
        import select
        import termios
        import tty

        fd = sys.stdin.fileno()
        old = termios.tcgetattr(fd)
        try:
            tty.setraw(fd)
            while True:
                readable, _, _ = select.select([channel, fd], [], [], 0.1)
                if channel in readable and channel.recv_ready():
                    data = channel.recv(65536)
                    if data:
                        sys.stdout.buffer.write(data)
                        sys.stdout.buffer.flush()
                if fd in readable:
                    data = os.read(fd, 1024)
                    if data:
                        channel.send(data)
                if channel.exit_status_ready() and not channel.recv_ready():
                    break
                if timeout is not None and time.monotonic() - started > timeout:
                    channel.close()
                    raise SSHDeployError("Tempo limite da execução remota excedido.")
        finally:
            termios.tcsetattr(fd, termios.TCSADRAIN, old)
            sys.stdout.write("\n")
            sys.stdout.flush()

    return channel.recv_exit_status()
