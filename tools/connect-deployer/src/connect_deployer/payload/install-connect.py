#!/usr/bin/env python3
"""Connect|API universal stack installer (Python 3.10+, Docker Compose v2).

Acquires immutable source files, validates the selected deployment and images,
then prepares or starts Compose. Never runs SQL, ACME, clpctl, host cron or migrations.
Secrets are not accepted on the command line or written to reports.
"""
from __future__ import annotations

import argparse
import base64
import contextlib
import getpass
import hashlib
import json
import os
import platform
import re
import secrets
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import quote, urlsplit
from urllib.request import HTTPRedirectHandler, ProxyHandler, Request, build_opener

VERSION = '1.0.1'
APP_IMAGES = ('API', 'DOCS', 'PLATFORM_API', 'PLATFORM_WEB', 'PLATFORM_GATEWAY',
              'PLATFORM_ACME', 'PLATFORM_CLOUDPANEL_AGENT', 'PGBOUNCER')
KEY = re.compile(r'^([A-Za-z_][A-Za-z0-9_]*)=(.*)$')
SEMVER = re.compile(r'^v?(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$')
PLACEHOLDER = re.compile(r'CHANGE_ME[A-Za-z0-9_]*')
CATALOG = {
    'platform-develop': ('compose.yaml', 'develop', True, []),
    'platform-production': ('compose.yaml', 'production', True, []),
    'platform': ('compose.yaml', 'any', True, ['platform', 'observability']),
    'develop': ('compose.yaml', 'develop', False, []),
    'production': ('compose.yaml', 'production', False, []),
    'canonical': ('compose.yaml', 'production', False, []),
    'homologation': ('compose.yaml', 'develop', False, []),
    'cloudpanel': ('docker-compose.yml', 'production', False, []),
    'dockge': ('compose.yaml', 'production', False, []),
    'docs': ('compose.yaml', 'production', False, []),
    'docs-develop': ('compose.yaml', 'develop', False, []),
}


class InstallError(RuntimeError):
    pass


def secret_from_file_env(name: str) -> str:
    """Read an ephemeral secret from a file path passed through the environment."""
    value = os.environ.get(name, '').strip()
    if not value:
        return ''
    path = Path(value)
    if not path.is_file() or path.is_symlink():
        raise InstallError('Arquivo secreto inválido para ' + name)
    if path.stat().st_mode & 0o077:
        raise InstallError('Arquivo secreto possui permissões excessivas: ' + name)
    secret = path.read_text().strip()
    if not secret or any(c in secret for c in '\r\n\0'):
        raise InstallError('Conteúdo secreto inválido para ' + name)
    return secret


class NoRedirect(HTTPRedirectHandler):
    def redirect_request(self, *args, **kwargs):
        return None


def repository(value: str) -> str:
    if value.startswith('https://'):
        parsed = urlsplit(value)
        if parsed.hostname != 'github.com' or parsed.username or parsed.port or parsed.query or parsed.fragment:
            raise InstallError('Use owner/repo ou URL HTTPS do github.com, sem credenciais na URL.')
        value = parsed.path.strip('/').removesuffix('.git')
    if not re.fullmatch(r'[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+', value) or '..' in value:
        raise InstallError('Repositório inválido; use owner/repo.')
    return value


class GitHubSource:
    def __init__(self, repo: str, token: str = ''):
        self.repo = repository(repo)
        self.token = token
        self.opener = build_opener(ProxyHandler({}), NoRedirect())
        self.proofs: dict[str, str] = {}

    def get(self, suffix: str) -> dict:
        headers = {'Accept': 'application/vnd.github+json', 'User-Agent': 'Connect-Installer/' + VERSION,
                   'X-GitHub-Api-Version': '2022-11-28'}
        if self.token: headers['Authorization'] = 'Bearer ' + self.token
        url = f'https://api.github.com/repos/{self.repo}/{suffix}'
        try:
            with self.opener.open(Request(url, headers=headers), timeout=30) as response:
                data = response.read(4_000_001)
            if len(data) > 4_000_000: raise InstallError('Arquivo/resposta excede o limite do instalador.')
            result = json.loads(data)
            if not isinstance(result, dict): raise InstallError('Resposta GitHub inválida.')
            return result
        except HTTPError as exc:
            raise InstallError(f'GitHub HTTP {exc.code}: confira acesso, versão e existência do arquivo. '
                               'Para repositório privado use --ask-github-token ou GH_TOKEN.') from None
        except (URLError, TimeoutError, ValueError):
            raise InstallError('Falha de rede ou resposta inválida do GitHub.') from None

    def resolve(self, requested: str, environment: str) -> tuple[str, str]:
        if requested == 'develop':
            if environment != 'develop': raise InstallError('Produção não pode usar a versão develop.')
            ref, tag = 'develop', 'develop'
        else:
            if requested in {'latest', 'production'}:
                release = self.get('releases/latest')
                if release.get('draft') or release.get('prerelease'):
                    raise InstallError('A última release não é estável.')
                requested = str(release.get('tag_name', ''))
            if not SEMVER.fullmatch(requested):
                raise InstallError('Versão deve ser develop, latest ou SemVer estável, por exemplo v1.2.3.')
            tag = requested.removeprefix('v')
            ref = 'v' + tag
            release = self.get('releases/tags/' + quote(ref, safe=''))
            if release.get('draft') or release.get('prerelease'):
                raise InstallError('A versão selecionada não é uma release estável publicada.')
        commit = self.get('commits/' + quote(ref, safe=''))
        sha = str(commit.get('sha', ''))
        if not re.fullmatch('[a-f0-9]{40}', sha): raise InstallError('SHA Git inválido.')
        return sha, tag

    def file(self, path: str, sha: str) -> str:
        if path.startswith('/') or '..' in Path(path).parts: raise InstallError('Caminho de fonte inválido.')
        item = self.get('contents/' + quote(path, safe='/') + '?ref=' + sha)
        if item.get('type') != 'file' or item.get('encoding') != 'base64':
            raise InstallError('A fonte deve ser um arquivo regular UTF-8; links não são aceitos.')
        try:
            data = base64.b64decode(item['content'])
            digest = hashlib.sha1(b'blob ' + str(len(data)).encode() + b'\0' + data).hexdigest()
            if digest != item.get('sha'): raise InstallError('Integridade do arquivo Git divergente.')
            self.proofs[path] = digest
            return data.decode('utf-8')
        except (KeyError, ValueError, UnicodeError):
            raise InstallError('Arquivo GitHub inválido ou codificação não suportada.') from None


def env_values(text: str) -> dict[str, str]:
    result = {}
    for line in text.splitlines():
        match = KEY.match(line.strip().removeprefix('export '))
        if not match: continue
        key, value = match.groups()
        if key in result: raise InstallError('Variável duplicada no .env: ' + key)
        if value.startswith(("'", '"')) and value[-1:] == value[:1]: value = value[1:-1]
        result[key] = value
    return result


def set_env(text: str, key: str, value: str) -> str:
    if any(c in value for c in '\r\n\0') or "'" in value:
        raise InstallError('Valor inválido para ' + key)
    # Single quotes preserve $, spaces and #. Docker Compose performs the parsing, not a shell.
    literal = value if re.fullmatch(r'[A-Za-z0-9_./:@,?=+*-]*', value) else "'" + value + "'"
    pattern = re.compile(r'^(?:export )?' + re.escape(key) + r'=.*$', re.M)
    if pattern.search(text): return pattern.sub(lambda _: key + '=' + literal, text)
    return text.rstrip('\n') + '\n' + key + '=' + literal + '\n'


def prepare_env(template: str, existing: str | None, tag: str, profiles: list[str]) -> tuple[str, list[str]]:
    text = template if existing is None else existing
    if existing is None:
        replacements = {}
        for marker in set(PLACEHOLDER.findall(text)):
            replacements[marker] = (base64.urlsafe_b64encode(secrets.token_bytes(32)).decode()
                                    if 'ENCRYPTION_KEY' in marker else secrets.token_hex(32))
        text = PLACEHOLDER.sub(lambda match: replacements[match[0]], text)
    before = env_values(text)
    if before.get('COMPOSE_FILE') and before['COMPOSE_FILE'] != 'compose.yaml':
        raise InstallError('COMPOSE_FILE aponta para outra configuração; não será migrado silenciosamente.')
    if existing is not None:
        for key, value in env_values(template).items():
            if key not in before:
                if PLACEHOLDER.search(value):
                    raise InstallError('A atualização requer credencial ausente: ' + key + '. Configure-a no .env existente.')
                text = set_env(text, key, value)
    values = env_values(text)
    for component in APP_IMAGES:
        key = 'ARGWS_CONNECT_' + component + '_IMAGE'
        if key in values:
            image = values[key]
            # Preserve the configured repository; switch only the explicitly selected channel.
            repo = image.split('@')[0]
            if ':' in repo.rsplit('/', 1)[-1]: repo = repo.rsplit(':', 1)[0]
            if not re.fullmatch(r'[a-zA-Z0-9./_-]+', repo): raise InstallError('Imagem inválida em ' + key)
            text = set_env(text, key, repo + ':' + tag)
    if profiles: text = set_env(text, 'COMPOSE_PROFILES', ','.join(profiles))
    if 'CONNECT_API_VERSION' in values and tag != 'develop': text = set_env(text, 'CONNECT_API_VERSION', tag)
    if PLACEHOLDER.search(text): raise InstallError('O .env contém placeholders CHANGE_ME; nenhuma senha será trocada em atualização.')
    after = env_values(text)
    return text, sorted(k for k in after if before.get(k) != after[k])


def prompt_value(text: str, key: str, label: str, secret: bool = False, default: str = '') -> str:
    current = env_values(text).get(key, '')
    fallback = current or default
    value = getpass.getpass(label + ': ') if secret else input(label + (f' [{fallback}]' if fallback else '') + ': ').strip()
    return set_env(text, key, value or fallback)


def safe_directory(value: str) -> Path:
    path = Path(value).expanduser().absolute()
    if path in {Path('/'), Path('/opt'), Path('/home'), Path('/root'), Path('/etc'), Path('/var'), Path('/tmp')}:
        raise InstallError('Escolha um diretório exclusivo da stack, não uma raiz do sistema.')
    for part in (path, *path.parents):
        if part.is_symlink(): raise InstallError('Diretórios da stack não podem conter links simbólicos.')
    return path


def sanitized_env(text: str) -> dict[str, str]:
    blocked = set(env_values(text)) | {'GH_TOKEN', 'GITHUB_TOKEN', 'CLOUDFLARE_API_TOKEN', 'COMPOSE_FILE',
                                      'COMPOSE_PROJECT_NAME', 'COMPOSE_PROFILES', 'COMPOSE_ENV_FILES'}
    return {key: value for key, value in os.environ.items() if key not in blocked}


def command(argv: list[str], *, env=None, timeout: int = 60, stdin: str | None = None) -> str:
    try:
        result = subprocess.run(argv, input=stdin, text=True, capture_output=True, timeout=timeout,
                                env=env, check=False)
    except FileNotFoundError:
        raise InstallError('Dependência não encontrada: ' + argv[0]) from None
    except subprocess.TimeoutExpired:
        raise InstallError('Tempo limite na operação ' + ' '.join(argv[:3]) + '; consulte o status no Dockge.') from None
    if result.returncode:
        # Compose can echo interpolated passwords in error messages. Do not print raw output.
        raise InstallError('Falhou: ' + ' '.join(argv[:3]) + f' (código {result.returncode}). '
                           'Confira Docker, acesso ao registry e a configuração da stack; dados sensíveis foram omitidos.')
    return result.stdout


def compose_args(directory: Path, files: Path) -> list[str]:
    return ['docker', 'compose', '--project-directory', str(directory), '--env-file', str(files/'.env'),
            '-f', str(files/'compose.yaml')]


def rendered(directory: Path, files: Path, env: dict) -> dict:
    # env_file entries must read the staged .env even before the stack exists.
    try: config = json.loads(command(compose_args(files, files) + ['config', '--format', 'json'], env=env))
    except ValueError: raise InstallError('Docker Compose não retornou uma configuração JSON válida.') from None
    if files != directory:
        for svc in config.get('services', {}).values():
            for mount in svc.get('volumes', []):
                source = Path(mount.get('source', '/'))
                if mount.get('type') == 'bind' and source.is_relative_to(files):
                    mount['source'] = str(directory/source.relative_to(files))
    return config


def storage_signature(config: dict) -> dict:
    return {name: {'volumes': svc.get('volumes', []), 'ports': svc.get('ports', []),
                  'identity': {key: value for key, value in svc.get('environment', {}).items()
                               if re.search(r'(POSTGRES_(DB|USER|PASSWORD)|DATABASE_CONNECTION_URI|FIELD_ENCRYPTION_KEY|APP_SECRET_KEY)$', key)}}
            for name, svc in config.get('services', {}).items()}


def validate_plan(config: dict, before: dict | None, full_platform: bool, accept_host: bool) -> None:
    services = config.get('services', {})
    if not services: raise InstallError('Nenhum serviço selecionado.')
    for name, svc in services.items():
        if svc.get('build'): raise InstallError('O instalador usa imagens publicadas; build local não é permitido: ' + name)
        if not svc.get('image'): raise InstallError('Serviço sem imagem: ' + name)
        if svc.get('privileged') and not accept_host:
            raise InstallError('O CloudPanel Agent equivale a root no VPS. Confirme com --accept-host-agent.')
    if full_platform:
        for fragment in ('platform-acme-', 'platform-cloudpanel-agent-', 'platform-pgbouncer-', 'pgbouncer-'):
            if not any(name.startswith(fragment) for name in services):
                raise InstallError('Esta versão não contém a stack Platform completa atual: falta ' + fragment)
        if not any(svc.get('environment', {}).get('PLATFORM_TLS_AUTOMATION_ENABLED') in {'true', True}
                   for name, svc in services.items() if 'platform-acme-' in name):
            raise InstallError('A automação TLS está desabilitada. Configure o .env antes de instalar a Platform CloudPanel.')
    if before:
        if before.get('name') != config.get('name'): raise InstallError('Nome do project existente mudou; atualização bloqueada.')
        old, new = storage_signature(before), storage_signature(config)
        for name, signature in old.items():
            if name not in new: raise InstallError('Serviço existente seria removido: ' + name)
            if signature != new[name]:
                raise InstallError('Volumes, portas ou identidade de dados mudariam em ' + name + '. Revisão de migração necessária.')


def check_images(config: dict, env: dict) -> list[str]:
    images = sorted({svc['image'] for svc in config['services'].values()})
    arch = {'x86_64': 'amd64', 'aarch64': 'arm64'}.get(platform.machine(), platform.machine())
    for image in images:
        try: manifest = json.loads(command(['docker', 'manifest', 'inspect', image], env=env, timeout=90))
        except InstallError: raise InstallError('Imagem não disponível/autorizada: ' + image + '. Nenhum container foi atualizado.') from None
        platforms = [m.get('platform', {}) for m in manifest.get('manifests', [])]
        if platforms and not any(p.get('os') == 'linux' and p.get('architecture') == arch for p in platforms):
            raise InstallError('Imagem sem suporte à arquitetura ' + arch + ': ' + image)
    return images


def write_private(path: Path, data: bytes, mode: int = 0o600) -> None:
    if path.is_symlink(): raise InstallError('Recusando sobrescrever link: ' + path.name)
    with tempfile.NamedTemporaryFile(dir=path.parent, delete=False) as stream:
        temporary = Path(stream.name)
        os.chmod(temporary, mode)
        stream.write(data)
        stream.flush()
        os.fsync(stream.fileno())
    os.replace(temporary, path)



def temporary_registry_config(existing: Path, target: Path) -> None:
    """Never send a temporary GHCR token to a persistent system credential helper."""
    config = json.loads(existing.read_text()) if existing.is_file() else {}
    if not isinstance(config, dict): raise InstallError('Configuração Docker de autenticação inválida.')
    config.pop('credsStore', None)
    helpers = config.get('credHelpers', {})
    if not isinstance(helpers, dict): raise InstallError('credHelpers inválido na configuração Docker.')
    config['credHelpers'] = {host: helper for host, helper in helpers.items()
                             if host.rstrip('/') not in {'ghcr.io', 'https://ghcr.io', 'http://ghcr.io'}}
    write_private(target/'config.json', json.dumps(config).encode())

def save_stack(directory: Path, compose: str, environment: str, receipt: dict) -> None:
    directory.mkdir(parents=True, exist_ok=True)
    files = {'compose.yaml': compose.encode(), '.env': environment.encode(),
             '.connect-install.json': json.dumps(receipt, indent=2, ensure_ascii=False).encode()}
    backup = directory/'.connect-installer-backups'/datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    backup.mkdir(parents=True, mode=0o700)
    os.chmod(backup.parent, 0o700)
    previous = {}
    for name in files:
        target = directory/name
        if target.is_symlink(): raise InstallError('Recusando arquivo de configuração simbólico: ' + name)
        previous[name] = target.read_bytes() if target.exists() else None
        if previous[name] is not None: write_private(backup/name, previous[name])
    write_private(backup/'manifest.json', json.dumps({'existing': [k for k, v in previous.items() if v is not None]}).encode())
    # Durable intent is installed last during recovery cleanup, never touches database volumes.
    pending = directory/'.connect-installer-pending.json'
    write_private(pending, json.dumps({'backup': str(backup.relative_to(directory))}).encode())
    try:
        for name, data in files.items(): write_private(directory/name, data)
        pending.unlink()
    except BaseException:
        recover_stack(directory)
        raise


def recover_stack(directory: Path) -> None:
    pending = directory/'.connect-installer-pending.json'
    if not pending.exists(): return
    backup = directory/json.loads(pending.read_text())['backup']
    if not backup.resolve().is_relative_to((directory/'.connect-installer-backups').resolve()):
        raise InstallError('Journal de instalação inválido.')
    existing = json.loads((backup/'manifest.json').read_text())['existing']
    for name in ('compose.yaml', '.env', '.connect-install.json'):
        if name in existing: write_private(directory/name, (backup/name).read_bytes())
        else: (directory/name).unlink(missing_ok=True)
    pending.unlink()


@contextlib.contextmanager
def install_lock(directory: Path):
    import fcntl  # CloudPanel deployment is performed on Linux, never on a remote Docker context.
    directory.parent.mkdir(parents=True, exist_ok=True)
    lock = directory.parent/('.connect-' + directory.name + '.lock')
    descriptor = os.open(lock, os.O_CREAT | os.O_RDWR | getattr(os, 'O_NOFOLLOW', 0), 0o600)
    try:
        try: fcntl.flock(descriptor, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError: raise InstallError('Outra instalação está usando este diretório.') from None
        yield
    finally: os.close(descriptor)


def readiness(directory: Path, env: dict, timeout: int) -> dict:
    deadline = time.monotonic() + timeout
    last = []
    while True:
        output = command(compose_args(directory, directory) + ['ps', '-a', '--format', 'json'], env=env)
        try:
            parsed = json.loads(output)
            last = parsed if isinstance(parsed, list) else [parsed]
        except ValueError:
            last = [json.loads(line) for line in output.splitlines() if line.strip()]
        pending, failed = [], []
        for svc in last:
            state, health = svc.get('State'), svc.get('Health')
            if state == 'exited' and int(svc.get('ExitCode', 0) or 0) == 0: continue
            if state == 'exited' or health == 'unhealthy': failed.append(svc.get('Service'))
            elif state != 'running' or health == 'starting': pending.append(svc.get('Service'))
        if last and not failed and not pending: return {'status': 'SERVICES_READY', 'services': len(last)}
        if time.monotonic() >= deadline:
            return {'status': 'PENDING_OR_FAILED', 'failed': failed, 'pending': pending,
                    'note': 'A stack permanece instalada. Confira os serviços no Dockge; não foi feito rollback de banco.'}
        time.sleep(3)


def install_dockge(directory: Path, stacks: Path, env: dict) -> None:
    directory = safe_directory(str(directory))
    if directory == stacks or directory.is_relative_to(stacks) or stacks.is_relative_to(directory):
        raise InstallError('Dockge e raiz das stacks devem ser diretórios separados.')
    if directory.exists() and any(directory.iterdir()):
        raise InstallError('Diretório Dockge já existe; sua configuração não será substituída.')
    # JSON is YAML 1.2; paths are encoded, never inserted into shell commands.
    config = {'name': 'connect-dockge', 'services': {'dockge': {
        'image': 'louislam/dockge:1', 'restart': 'unless-stopped',
        'ports': ['127.0.0.1:5001:5001'], 'environment': {'DOCKGE_STACKS_DIR': str(stacks)},
        'volumes': ['/var/run/docker.sock:/var/run/docker.sock', './data:/app/data', f'{stacks}:{stacks}']}}}
    check_images(config, env)
    stacks.mkdir(parents=True, exist_ok=True)
    save_stack(directory, json.dumps(config, indent=2), '', {'component': 'dockge', 'socket_access': 'root-equivalent'})
    command(compose_args(directory, directory) + ['up', '-d'], env=env, timeout=600)


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description='Instalador Connect|API — fontes verificadas, Compose + .env, sem scripts operacionais no host.')
    p.add_argument('--repo', default='wkarts/ARGWS-Connect-API')
    p.add_argument('--environment', choices=['develop', 'production'])
    p.add_argument('--version', help='develop, latest ou vX.Y.Z; produção exige release estável')
    p.add_argument('--deployment', choices=['auto', *CATALOG], default='auto')
    p.add_argument('--directory', help='Diretório exclusivo da stack, por exemplo /opt/stacks/argws-connect-platform-develop')
    actions = p.add_mutually_exclusive_group()
    actions.add_argument('--prepare', action='store_true', help='Valida e grava arquivos, sem subir containers')
    actions.add_argument('--apply', action='store_true', help='Valida, faz pull e sobe a stack')
    p.add_argument('--env-input', type=Path, help='Arquivo .env inicial; não substitui um .env já existente')
    p.add_argument('--ask-github-token', action='store_true')
    p.add_argument('--registry-user', help='Login GHCR temporário; token é solicitado oculto, não fica no diretório da stack')
    p.add_argument('--accept-host-agent', action='store_true', help='Autoriza o risco root-equivalent do agente CloudPanel')
    p.add_argument('--install-dockge', action='store_true', help='Instala Dockge separado; requer --accept-docker-socket')
    p.add_argument('--accept-docker-socket', action='store_true')
    p.add_argument('--dockge-directory', default='/opt/dockge')
    p.add_argument('--yes', action='store_true', help='Confirma o plano sem interação; não dispensa flags de privilégio')
    p.add_argument('--wait-seconds', type=int, default=180)
    return p


def execute(args) -> int:
    interactive = sys.stdin.isatty() and not args.yes
    if platform.system() != 'Linux': raise InstallError('Execute no VPS Linux que hospeda o Docker/CloudPanel.')
    if not 0 <= args.wait_seconds <= 3600: raise InstallError('--wait-seconds deve estar entre 0 e 3600.')
    if args.install_dockge and (not args.apply or not args.accept_docker_socket):
        raise InstallError('Instalar Dockge requer --apply e --accept-docker-socket; ele acessa o socket administrativo.')
    if not args.environment:
        args.environment = (input('Ambiente [develop/production] [develop]: ').strip() or 'develop') if interactive else 'develop'
    if args.environment not in {'develop', 'production'}: raise InstallError('Ambiente inválido.')
    if args.deployment == 'auto':
        if interactive:
            print('Deployments: ' + ', '.join(CATALOG))
            args.deployment = input(f'Deployment [platform-{args.environment}]: ').strip() or 'platform-' + args.environment
        else: args.deployment = 'platform-' + args.environment
    if args.deployment not in CATALOG: raise InstallError('Deployment não reconhecido.')
    filename, expected_env, full_platform, profiles = CATALOG[args.deployment]
    if expected_env not in {'any', args.environment}: raise InstallError('Deployment não corresponde ao ambiente escolhido.')
    if not args.version:
        default = 'develop' if args.environment == 'develop' else 'latest'
        args.version = (input(f'Versão [{default}]: ').strip() or default) if interactive else default
    if not args.directory:
        default = '/opt/stacks/argws-connect-' + args.deployment
        args.directory = (input(f'Diretório da stack [{default}]: ').strip() or default) if interactive else default
    directory = safe_directory(args.directory)
    token = (secret_from_file_env('GH_TOKEN_FILE') or os.environ.get('GH_TOKEN') or
             os.environ.get('GITHUB_TOKEN', ''))
    if args.ask_github_token: token = getpass.getpass('Token GitHub (somente leitura, não será salvo): ')
    source = GitHubSource(args.repo, token)
    sha, tag = source.resolve(args.version, args.environment)
    compose = source.file(f'deploy/{args.deployment}/{filename}', sha)
    template = source.file(f'deploy/{args.deployment}/env.example', sha)
    if full_platform and 'PLATFORM_TLS_AUTOMATION_ENABLED' not in compose:
        raise InstallError('A release selecionada ainda não inclui a automação CloudPanel. Não haverá fallback para develop.')
    with install_lock(directory), tempfile.TemporaryDirectory(prefix='connect-install-') as temporary:
        if (directory/'.connect-installer-pending.json').exists():
            if not (args.prepare or args.apply):
                raise InstallError('Há uma gravação interrompida. Use --prepare ou --apply para recuperar a configuração; o modo plano não altera arquivos.')
            recover_stack(directory)
        env_path = directory/'.env'
        if env_path.is_symlink(): raise InstallError('O .env não pode ser um link simbólico.')
        existing = env_path.read_text() if env_path.exists() else None
        if existing is not None and args.env_input: raise InstallError('--env-input não pode substituir o .env existente.')
        if args.env_input: existing = args.env_input.read_text()
        environment, changes = prepare_env(template, existing, tag, profiles)
        if interactive and existing is None:
            if 'PLATFORM_ADMIN_EMAIL' in env_values(environment):
                environment = prompt_value(environment, 'PLATFORM_ADMIN_EMAIL', 'E-mail do administrador')
            if full_platform:
                old_root = env_values(environment).get('PLATFORM_DOMAIN', '')
                environment = prompt_value(environment, 'PLATFORM_DOMAIN', 'Domínio base da Platform')
                new_root = env_values(environment)['PLATFORM_DOMAIN']
                if not re.fullmatch(r'[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?', new_root) or '.' not in new_root:
                    raise InstallError('Domínio base inválido.')
                if new_root != old_root:
                    hosts = {key: prefix + '.' + new_root for key, prefix in [
                        ('CONTROL_PLANE_HOST','control'), ('ADMIN_HOST','admin'), ('PARTNER_PLANE_HOST','partner'),
                        ('API_HOST','api'), ('DOCS_HOST','docs'), ('DEMO_HOST','demo')]}
                    for key, value in hosts.items(): environment = set_env(environment, key, value)
                    for key in ['TENANT_DOMAIN_ROOT','ACME_DOMAIN','CLOUDPANEL_SITE_DOMAIN']:
                        environment = set_env(environment, key, new_root)
                    environment = set_env(environment, 'CLOUDPANEL_WILDCARD_DOMAIN', '*.' + new_root)
                    environment = set_env(environment, 'CLOUDFLARE_TENANT_RECORD_TARGET', new_root)
                    environment = set_env(environment, 'PLATFORM_TRUSTED_HOSTS', ','.join([new_root, '.' + new_root, 'localhost', '127.0.0.1', *hosts.values()]))
                    environment = set_env(environment, 'PLATFORM_CORS_ORIGINS', ','.join('https://' + h for h in [new_root,*hosts.values()]))
                    environment = set_env(environment, 'SERVER_URL', 'https://' + hosts['API_HOST'])
                    environment = set_env(environment, 'ARGWS_CONNECT_DOCS_PUBLIC_URL', 'https://' + hosts['DOCS_HOST'])
                environment = prompt_value(environment, 'ACME_EMAIL', 'E-mail ACME')
                environment = prompt_value(environment, 'CLOUDFLARE_API_TOKEN', 'Token Cloudflare', secret=True)
                environment = prompt_value(environment, 'CLOUDFLARE_TENANT_RECORD_TARGET', 'IP público ou hostname DNS-only da origem')
        values = env_values(environment)
        if full_platform and (not values.get('ACME_EMAIL') or not values.get('CLOUDFLARE_API_TOKEN')):
            raise InstallError('Configure ACME_EMAIL e CLOUDFLARE_API_TOKEN no .env inicial via --env-input ou modo interativo.')
        if not full_platform:
            print('ATENÇÃO: deployment clássico/DOCs não inclui a Platform nem a automação wildcard. Use platform-* para o produto completo.')
        if directory.name != values.get('COMPOSE_PROJECT_NAME'):
            raise InstallError('Para compatibilidade Dockge, o último componente do diretório deve ser ' + values.get('COMPOSE_PROJECT_NAME', '(project ausente)'))
        if interactive and full_platform and not args.accept_host_agent:
            args.accept_host_agent = input('O agente CloudPanel terá acesso root-equivalent ao VPS. Autorizar? [sim/não]: ').strip() == 'sim'
        stage = Path(temporary)
        write_private(stage/'compose.yaml', compose.encode())
        write_private(stage/'.env', environment.encode())
        env = sanitized_env(environment)
        if args.registry_user:
            auth = stage/'docker-auth'; auth.mkdir(mode=0o700)
            existing_auth = Path(os.environ.get('DOCKER_CONFIG', str(Path.home()/'.docker')))/'config.json'
            temporary_registry_config(existing_auth, auth)
            env['DOCKER_CONFIG'] = str(auth)
            secret = (secret_from_file_env('ARGWS_CONNECT_GHCR_TOKEN_FILE') or
                      getpass.getpass('Token GHCR read:packages (temporário): '))
            command(['docker', 'login', 'ghcr.io', '--username', args.registry_user, '--password-stdin'], env=env, stdin=secret + '\n')
        command(['docker', 'compose', 'version'], env=env)
        config = rendered(directory, stage, env)
        before = None
        if (directory/'compose.yaml').exists():
            if (directory/'compose.yaml').is_symlink(): raise InstallError('Compose existente não pode ser link.')
            before = rendered(directory, directory, env)
        elif any((directory/name).exists() for name in ('docker-compose.yml', 'docker-compose.yaml', 'compose.argws.yaml')):
            raise InstallError('Há um Compose com outro nome; normalize para compose.yaml sem mover os volumes antes de continuar.')
        if directory.exists() and before is None and any(p.name != '.env' for p in directory.iterdir()):
            raise InstallError('Diretório não vazio sem configuração reconhecida; instalação bloqueada para proteger dados.')
        validate_plan(config, before, full_platform, args.accept_host_agent)
        images = check_images(config, env)
        print(json.dumps({'repository': source.repo, 'commit': sha, 'environment': args.environment, 'version': tag,
                          'deployment': args.deployment, 'directory': str(directory), 'services': len(config['services']),
                          'configuration_changes': changes, 'images': images}, indent=2, ensure_ascii=False))
        if full_platform:
            print('Única ação CloudPanel: Reverse Proxy ' + values['CLOUDPANEL_SITE_DOMAIN'] + ' -> ' + values['CLOUDPANEL_REVERSE_PROXY_URL'])
        if interactive and not (args.prepare or args.apply):
            action = input('Ação [plano/preparar/aplicar] [plano]: ').strip()
            args.prepare, args.apply = action == 'preparar', action == 'aplicar'
        if not (args.prepare or args.apply):
            print('Plano validado. Nenhum arquivo da stack ou container foi alterado.')
            return 0
        if interactive and input('Confirmar esta operação? [sim/não]: ').strip() != 'sim': return 0
        if args.apply:
            info = json.loads(command(['docker', 'info', '--format', '{{json .}}'], env=env))
            if info.get('OSType') != 'linux': raise InstallError('Docker precisa executar containers Linux.')
            context = json.loads(command(['docker', 'context', 'inspect'], env=env))[0]
            endpoint = os.environ.get('DOCKER_HOST') or context.get('Endpoints', {}).get('docker', {}).get('Host', '')
            if not endpoint.startswith('unix://'): raise InstallError('Deploy exige o Docker local do VPS, não um contexto remoto.')
            if full_platform and not shutil.which('clpctl'):
                raise InstallError('CloudPanel/clpctl não está instalado neste VPS. O instalador não modifica o sistema operacional.')
            print('Baixando todas as imagens antes de atualizar containers...')
            command(compose_args(stage, stage) + ['pull'], env=env, timeout=1800)
            if tag == 'develop':
                for key in ('ARGWS_CONNECT_API_IMAGE', 'ARGWS_CONNECT_PLATFORM_API_IMAGE', 'ARGWS_CONNECT_PLATFORM_ACME_IMAGE',
                            'ARGWS_CONNECT_PLATFORM_CLOUDPANEL_AGENT_IMAGE', 'ARGWS_CONNECT_PGBOUNCER_IMAGE'):
                    if key not in values or values[key] not in images: continue
                    label = command(['docker', 'image', 'inspect', values[key], '--format',
                                     '{{index .Config.Labels "org.opencontainers.image.revision"}}'], env=env).strip()
                    if label != sha: raise InstallError('Imagem develop não corresponde ao código selecionado: ' + values[key] + '. Aguarde a publicação completa.')
        receipt = {'schema_version': 1, 'installer_version': VERSION, 'repository': source.repo, 'commit': sha,
                   'environment': args.environment, 'version': tag, 'deployment': args.deployment,
                   'source_blobs': source.proofs, 'prepared_at': datetime.now(timezone.utc).isoformat(),
                   'images': images, 'status': 'PREPARED', 'data_backup': False}
        save_stack(directory, compose, environment, receipt)
        if args.apply:
            if args.install_dockge: install_dockge(Path(args.dockge_directory), directory.parent, env)
            command(compose_args(directory, directory) + ['up', '-d', '--no-build', '--pull', 'never'], env=env, timeout=1800)
            receipt['result'] = readiness(directory, env, args.wait_seconds)
            receipt['status'] = receipt['result']['status']
            write_private(directory/'.connect-install.json', json.dumps(receipt, indent=2, ensure_ascii=False).encode())
            print(json.dumps(receipt['result'], ensure_ascii=False, indent=2))
            if receipt['status'] != 'SERVICES_READY': return 3
        print('Arquivos em ' + str(directory) + '. Mantenha .env/volumes; senhas novas estão somente no .env (0600).')
        print('No Dockge existente, use Scan Stacks Folder se a nova stack ainda não aparecer.')
        return 0


def main() -> int:
    try: return execute(parser().parse_args())
    except InstallError as exc:
        print('ERRO: ' + str(exc), file=sys.stderr)
        return 2
    except KeyboardInterrupt:
        print('Interrompido. Nenhum volume foi removido; confira o estado dos serviços no Dockge.', file=sys.stderr)
        return 130
    except Exception as exc:
        print('ERRO: ' + type(exc).__name__ + '. Dados internos omitidos; confira permissões e configuração.', file=sys.stderr)
        return 2


if __name__ == '__main__':
    raise SystemExit(main())
