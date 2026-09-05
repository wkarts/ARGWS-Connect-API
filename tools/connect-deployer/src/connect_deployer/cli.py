from __future__ import annotations

import argparse
import getpass
import json
import os
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

from . import __version__
from .resources import payload_path
from .build_info import build_info, version_label, self_check, system_subprocess_env
from .ssh_client import (
    SSHDeployError,
    SSHOptions,
    build_remote_command,
    cleanup_remote,
    connect,
    remote_preflight,
    stream_command,
    stream_command_interactive,
    upload_bundle,
    prepare_remote_directory,
)


class DeployError(RuntimeError):
    pass


def _installer_remainder(value: list[str]) -> list[str]:
    return value[1:] if value and value[0] == "--" else value


def _common_forwarding_parser(parser: argparse.ArgumentParser) -> None:
    parser.add_argument(
        "--env-input",
        type=Path,
        help=".env local a ser usado somente em instalação nova; no SSH ele é enviado temporariamente com modo 0600.",
    )
    parser.add_argument(
        "installer_args",
        nargs=argparse.REMAINDER,
        help="Argumentos do install-connect.py após --.",
    )


def parser() -> argparse.ArgumentParser:
    root = argparse.ArgumentParser(
        prog="connect-deploy",
        description="ARGWS Connect|API Deployer — launcher local/SSH para o instalador universal.",
    )
    root.add_argument("--version", action="version", version=version_label())
    root.add_argument("--build-info", action="store_true", help="Mostra projeto, revisão e hashes do binário; não conecta ao VPS.")
    root.add_argument("--self-check", action="store_true", help="Valida payload e dependências embutidas sem rede ou deploy.")
    sub = root.add_subparsers(dest="mode")

    local = sub.add_parser("local", help="Executa o payload no host Linux local.")
    local.add_argument("--python", default="python3", help="Python 3.10+ usado para executar o payload.")
    _common_forwarding_parser(local)

    ssh = sub.add_parser("ssh", help="Implanta em um VPS Linux via SSH.")
    ssh.add_argument("--host", required=True)
    ssh.add_argument("--port", type=int, default=22)
    ssh.add_argument("--user", required=True)
    ssh.add_argument("--key-file", type=Path)
    ssh.add_argument("--ask-password", action="store_true", help="Solicita senha SSH localmente sem gravá-la.")
    ssh.add_argument(
        "--accept-new-host-key",
        action="store_true",
        help="Confia somente em host ainda desconhecido e o grava no known_hosts. Mudança de chave continua bloqueada.",
    )
    ssh.add_argument("--known-hosts", type=Path)
    ssh.add_argument("--connect-timeout", type=int, default=20)
    ssh.add_argument("--remote-python", default="python3")
    ssh.add_argument("--sudo", action="store_true", help="Executa o payload via sudo -n; não envia senha sudo.")
    ssh.add_argument(
        "--interactive",
        action="store_true",
        help="Abre PTY remoto e permite responder aos prompts do instalador pelo terminal local.",
    )
    ssh.add_argument(
        "--ask-github-token",
        action="store_true",
        help="Solicita token GitHub localmente e o envia em arquivo temporário 0600.",
    )
    ssh.add_argument(
        "--ask-registry-token",
        action="store_true",
        help="Solicita token GHCR localmente e o envia em arquivo temporário 0600.",
    )
    ssh.add_argument(
        "--remote-timeout",
        type=int,
        default=3600,
        help="Limite total da execução remota em segundos; 0 desabilita o limite.",
    )
    _common_forwarding_parser(ssh)
    return root


def run_local(args: argparse.Namespace) -> int:
    if sys.platform.startswith("win") or sys.platform == "darwin":
        raise DeployError("O modo local implanta somente em Linux. Neste computador use o modo ssh.")
    python = shutil.which(args.python)
    if not python:
        raise DeployError(f"{args.python} não foi encontrado.")
    forwarded = _installer_remainder(args.installer_args)
    if args.env_input:
        path = args.env_input.expanduser().resolve()
        if not path.is_file():
            raise DeployError(f"Arquivo .env não encontrado: {path}")
        if "--env-input" in forwarded:
            raise DeployError("Use --env-input do launcher ou do payload, não os dois.")
        forwarded.extend(["--env-input", str(path)])
    return subprocess.call([python, str(payload_path()), *forwarded], env=system_subprocess_env())


def run_ssh(args: argparse.Namespace) -> int:
    if args.remote_timeout < 0:
        raise DeployError("--remote-timeout não pode ser negativo.")
    env_input = args.env_input.expanduser().resolve() if args.env_input else None
    if env_input and not env_input.is_file():
        raise DeployError(f"Arquivo .env não encontrado: {env_input}")

    forwarded = _installer_remainder(args.installer_args)
    if env_input and "--env-input" in forwarded:
        raise DeployError("Use --env-input do launcher ou do payload, não os dois.")
    if "--ask-github-token" in forwarded:
        raise DeployError("No modo SSH, use --ask-github-token antes de -- para manter o token fora do terminal remoto.")

    github_token = None
    if args.ask_github_token:
        github_token = getpass.getpass("Token GitHub (repo somente leitura): ").strip()
        if not github_token:
            raise DeployError("Token GitHub vazio.")

    registry_token = None
    needs_registry_token = args.ask_registry_token or "--registry-user" in forwarded
    if needs_registry_token:
        registry_token = getpass.getpass("Token GHCR (read:packages): ").strip()
        if not registry_token:
            raise DeployError("Token GHCR vazio.")

    options = SSHOptions(
        host=args.host,
        port=args.port,
        user=args.user,
        key_file=args.key_file,
        ask_password=args.ask_password,
        accept_new_host_key=args.accept_new_host_key,
        known_hosts=args.known_hosts,
        connect_timeout=args.connect_timeout,
        sudo=args.sudo,
        python_command=args.remote_python,
    )

    client = connect(options)
    remote_dir = ""
    try:
        print(f"Conectado a {args.user}@{args.host}:{args.port}.")
        remote_preflight(client, options.python_command, options.sudo)
        remote_dir = prepare_remote_directory(client)
        paths = upload_bundle(
            client,
            remote_dir,
            payload_path(),
            env_input,
            github_token,
            registry_token,
        )
        command = build_remote_command(options=options, paths=paths, installer_args=forwarded)
        print("Executando o instalador no VPS...")
        timeout = None if args.remote_timeout == 0 else args.remote_timeout
        if args.interactive:
            return stream_command_interactive(client, command, timeout=timeout)
        return stream_command(client, command, timeout=timeout)
    finally:
        if remote_dir:
            try:
                cleanup_remote(client, remote_dir)
            except Exception as exc:
                print(f"AVISO: falha ao remover temporários remotos: {type(exc).__name__}.", file=sys.stderr)
        client.close()


def main(argv: list[str] | None = None) -> int:
    try:
        args = parser().parse_args(argv)
        if args.build_info:
            print(json.dumps(build_info(), indent=2, ensure_ascii=False))
            return 0
        if args.self_check:
            print(json.dumps(self_check(), indent=2, ensure_ascii=False))
            return 0
        if args.mode is None:
            parser().error("informe local ou ssh; use --help para exemplos")
        if args.mode == "local":
            return run_local(args)
        if args.mode == "ssh":
            return run_ssh(args)
        raise DeployError("Modo inválido.")
    except (DeployError, SSHDeployError, FileNotFoundError, OSError) as exc:
        print("ERRO: " + str(exc), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print("Interrompido pelo usuário.", file=sys.stderr)
        return 130


if __name__ == "__main__":
    raise SystemExit(main())
