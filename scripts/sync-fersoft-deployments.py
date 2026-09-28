#!/usr/bin/env python3
"""Generate isolated Fersoft normal and full-stack deployments from official templates."""
import argparse
import importlib.util
import re
from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[1]
CHANNELS = ('develop', 'production')
FULL_STACK_DEFAULTS = {
    'COMPOSE_PROFILES': 'operations,nats,kafka,mysql,traccar',
    'OPERATIONS_ENABLED': 'true',
    'NATS_ENABLED': 'true',
    'KAFKA_ENABLED': 'true',
    'KAFKA_AUTO_CREATE_TOPICS': 'true',
    'MYSQL_SERVICE_ENABLED': 'true',
    'TRACCAR_ENABLED': 'true',
    'TRACCAR_MODE': 'internal',
    'TRACCAR_REPLICAS': '1',
    'FINDHUB_MIN_TRACKING_INTERVAL_SECONDS': '0',
    'FINDHUB_STORE_POSITION_HISTORY': 'true',
    'SERVER_DISABLE_DOCS': 'false',
    'SERVER_DISABLE_MANAGER': 'false',
}

spec = importlib.util.spec_from_file_location('ops', ROOT / 'scripts/prepare-operations-env.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


class LiteralBlock(str):
    """Keep an embedded Node bootstrap readable in generated Compose files."""


def literal_block(dumper, value):
    return dumper.represent_scalar('tag:yaml.org,2002:str', value, style='|')


yaml.SafeDumper.add_representer(LiteralBlock, literal_block)


def suffix(channel):
    return f'fersoft-connect-{channel}'


def source_suffix(channel):
    return f'argws-connect-{channel}'


def replace_identity(value, channel):
    source = source_suffix(channel)
    target = suffix(channel)
    if isinstance(value, str):
        return value.replace(source, target)
    if isinstance(value, list):
        return [replace_identity(item, channel) for item in value]
    if isinstance(value, dict):
        return {replace_identity(key, channel): replace_identity(item, channel) for key, item in value.items()}
    return value


def with_volume_hook(text, compose_file='compose.yaml'):
    hook = f'python3 ./prepare-volumes.py --compose-file {compose_file}\n'
    text = re.sub(r'^python3 \./prepare-volumes\.py --compose-file [^\n]+\n', '', text, flags=re.M)
    match = re.search(r'^docker compose\b[^\n]*\bpull\b[^\n]*\n', text, re.M)
    if not match:
        raise ValueError('Deploy Fersoft sem etapa docker compose pull.')
    return text[:match.end()] + hook + text[match.end():]


def fersoft_overrides(channel, full):
    stack = suffix(channel)
    server = 'https://d.api.connect.fersofterp.com.br' if channel == 'develop' else 'https://api.connect.fersofterp.com.br'
    host = server.split('://', 1)[1]
    database = 'fersoft_connect_develop' if channel == 'develop' else 'fersoft_connect_api'
    values = {
        'COMPOSE_PROJECT_NAME': stack,
        'ARGWS_CONNECT_NETWORK_NAME': f'{stack}-net',
        'ARGWS_CONNECT_API_HOST_PORT': '38082' if channel == 'develop' else '38080',
        'ARGWS_CONNECT_DOCS_PUBLIC_URL': f'{server}/manager/docs',
        'SERVER_NAME': 'fersoft-connect-api-develop' if channel == 'develop' else 'fersoft-connect-api',
        'SERVER_URL': server,
        'WEBSOCKET_ALLOWED_HOSTS': f'127.0.0.1,::1,{host}',
        'DATABASE_CONNECTION_URI': f'postgresql://fersoft_connect:CHANGE_ME_POSTGRES_PASSWORD@postgres-{stack}:5432/{database}?schema=public',
        'DATABASE_CONNECTION_CLIENT_NAME': stack,
        'POSTGRES_DATABASE': database,
        'POSTGRES_USERNAME': 'fersoft_connect',
        'MYSQL_DATABASE': database,
        'MYSQL_USERNAME': 'fersoft_connect',
        'TRACCAR_ADMIN_EMAIL': 'suporte@fersofterp.com.br',
        'KAFKA_BROKERS': f'kafka-{stack}:9092',
    }
    if full:
        values.update(FULL_STACK_DEFAULTS)
    return values


def compose_for(channel, full):
    base = ROOT / f'deploy/{channel}/' / ('full-stack/compose.yaml' if full else 'compose.yaml')
    compose = replace_identity(yaml.safe_load(base.read_text(encoding='utf-8')), channel)
    services = compose['services']
    services[f'docs-{suffix(channel)}'].pop('ports', None)
    for name, service in services.items():
        entrypoint = service.get('entrypoint', [])
        if name.startswith('traccar-bootstrap-') and entrypoint[:2] == ['node', '-e']:
            entrypoint[2] = LiteralBlock(entrypoint[2].rstrip())
    text = yaml.safe_dump(compose, sort_keys=False, allow_unicode=True, width=120)
    return text.replace(':-./volumes/', ':-../volumes/') if full else text


def environment_for(channel, full):
    base = ROOT / f'deploy/{channel}/' / ('full-stack/env.example' if full else 'env.example')
    text = base.read_text(encoding='utf-8').replace(source_suffix(channel), suffix(channel))
    for key, value in fersoft_overrides(channel, full).items():
        text = ops.set_value(text, key, value)
    if full:
        text = text.replace('=./volumes/', '=../volumes/')
        header = '# FERSOFT FULL STACK: 14 servicos, uma porta publica e canais isolados.\n'
    else:
        header = '# FERSOFT NORMAL: core oficial, uma porta publica e canais isolados.\n'
    return header + text.replace(
        '# Duas portas locais publicadas: API e Connect|API DOCs. Manager permanece em /manager.',
        '# Uma porta local publicada: API. Manager e DOCs permanecem na API.',
    )


def normal_preflight(channel):
    text = (ROOT / f'deploy/{channel}/preflight.sh').read_text(encoding='utf-8')
    kafka_line = '[[ "$profiles" == *,kafka,* || "$profiles" == *,extended,* ]] && image_vars+=(ARGWS_CONNECT_KAFKA_IMAGE ARGWS_CONNECT_ZOOKEEPER_IMAGE)\n'
    mysql_line = '[[ "$profiles" == *,mysql,* ]] && image_vars+=(ARGWS_CONNECT_MYSQL_IMAGE)\n'
    if mysql_line not in text:
        text = text.replace(kafka_line, kafka_line + mysql_line)
    return text.replace(f'Preflight {channel} concluido.', f'Preflight Fersoft {channel} concluido.')


def normal_deploy(channel, update=False):
    name = 'update.sh' if update else 'deploy.sh'
    text = (ROOT / f'deploy/{channel}/{name}').read_text(encoding='utf-8')
    source_host = 'https://d.api.connect.argws.com.br' if channel == 'develop' else 'https://api.connect.argws.com.br'
    target_host = 'https://d.api.connect.fersofterp.com.br' if channel == 'develop' else 'https://api.connect.fersofterp.com.br'
    text = text.replace(source_host, target_host)
    text = re.sub(r'^echo "DOCs local:.*\n', '', text, flags=re.M)
    return with_volume_hook(text)


def recover_full_stack(channel):
    stack = suffix(channel)
    auxiliary = ' '.join(f'{service}-{stack}' for service in ('mysql', 'kafka', 'zookeeper'))
    return f'''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 ./prepare-operations-env.py --check
export COMPOSE_PROFILES="$(python3 ./prepare-operations-env.py --print-profiles)"
docker compose --env-file .env -f compose.yaml config --quiet
expected="$(docker compose --env-file .env -f compose.yaml config --services | wc -l | tr -d '[:space:]')"
[[ "$expected" == "14" ]] || {{ echo "ERRO: esta recuperacao requer os 14 servicos locais selecionados no .env." >&2; exit 2; }}
docker compose --env-file .env -f compose.yaml pull
# Stop only the three auxiliary services whose bind permissions are checked below.
docker compose --env-file .env -f compose.yaml stop {auxiliary} || true
python3 ./prepare-volumes.py --compose-file compose.yaml
docker compose --env-file .env -f compose.yaml up -d --pull never
python3 ./check-runtime.py --expected 14
'''


def backup_script(levels):
    return f'''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
exec {'../' * levels}scripts/connect-stack-backup.sh backup --stack-dir . --compose-file compose.yaml
'''


def verify_script(levels):
    return f'''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
[[ $# -eq 1 ]] || {{ echo "Uso: $0 arquivo.connectbak" >&2; exit 2; }}
exec {'../' * levels}scripts/connect-stack-backup.sh verify --stack-dir . --compose-file compose.yaml --file "$1"
'''


def full_preflight():
    return '''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 ./prepare-env.py --check
docker compose --env-file .env -f compose.yaml config --quiet
echo "Preflight Fersoft full stack concluido."
'''


def full_deploy(update=False):
    backup = '''if docker compose --env-file .env -f compose.yaml ps -q 2>/dev/null | grep -q .; then
  echo "Criando backup Connect|API antes da atualizacao..."
  BACKUP_FILE="$(./backup.sh)"
  ./verify-backup.sh "$BACKUP_FILE"
fi
''' if update else ''
    return '''#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
python3 ./prepare-env.py --check
docker compose --env-file .env -f compose.yaml config --quiet
docker compose --env-file .env -f compose.yaml pull
python3 ./prepare-volumes.py --compose-file compose.yaml
''' + backup + '''docker compose --env-file .env -f compose.yaml up -d --pull never
python3 ./check-runtime.py --expected 14
'''


def readme(channel, full):
    mode = 'full stack (14 servicos)' if full else 'normal (core oficial e profiles opt-in)'
    data = '../volumes' if full else './volumes'
    source = f'deploy/{channel}' + ('/full-stack' if full else '')
    migration = ' Leia MIGRACAO-FULL-STACK-FERSOFT.md antes de migrar um pacote Fersoft anterior.' if full else ''
    return f'''# Fersoft - {channel} - {mode}

Este deploy e independente do outro canal Fersoft. Projeto, rede, banco, porta e dados nao sao compartilhados.
Somente a API publica porta no host; Manager e DOCs ficam em /manager e /manager/docs.

As referencias de imagem sao herdadas sem alteracao de {source}; nao ha politica, tag ou workflow GHCR Fersoft.
Dados: {data}.
Nunca execute down -v, chmod 777 ou chown -R.

Instalar:
  ./prepare-env.sh
  ./deploy.sh

Atualizar:
  ./update.sh

Recuperar uma full stack configurada com todos os 14 servicos, sem remover dados ou trocar segredos:
  ./recover-full-stack.sh

Antes de iniciar Kafka, ZooKeeper e MySQL, os scripts preparam apenas binds vazios para o UID/GID real
das imagens. Diretorios ja gravados e sem permissao sao recusados sem alteracao; a stack nao e marcada como
saudavel ate que os probes reais passem. O bootstrap Traccar esta incorporado ao proprio `compose.yaml`;
o runtime nao requer arquivo de codigo externo.{migration}
'''


def migration(channel):
    return f'''# Migracao Fersoft full stack - {channel}

O pacote antigo iniciava MySQL, Kafka e ZooKeeper sem preparar os binds. Este perfil preserva o projeto
{suffix(channel)}, a rede e os dados existentes em ../volumes, mas executa a preparacao segura antes do start.

1. Faça backup privado do .env, volumes e chaves.
2. Copie este diretorio full-stack para dentro da instalacao Fersoft atual.
3. No novo diretorio, execute:
   bash prepare-env.sh --from-env ../.env
   bash deploy.sh

A importacao preserva senhas, chaves, caminhos e configuracoes. Production aplica somente GHCR
as mesmas referencias do template ARGWS de production; develop faz o mesmo com o template de develop.

Se prepare-volumes.py recusar um diretorio nao vazio sem permissao, nenhum dado foi alterado. Preserve e
inspecione antes de qualquer acao manual. Nunca apague volumes, use chmod 777 ou chown recursivo para esconder
a falha.
'''


def normal_files(channel):
    folder = Path('deploy/fersoft') / channel
    return {
        folder / 'compose.yaml': '# Generated Fersoft deployment. Do not edit by hand.\n' + compose_for(channel, False),
        folder / 'env.example': environment_for(channel, False),
        folder / 'README.md': readme(channel, False),
        folder / 'prepare-env.sh': (ROOT / f'deploy/{channel}/prepare-env.sh').read_text(encoding='utf-8'),
        folder / 'preflight.sh': normal_preflight(channel),
        folder / 'deploy.sh': normal_deploy(channel),
        folder / 'update.sh': normal_deploy(channel, update=True),
        folder / 'status.sh': (ROOT / f'deploy/{channel}/status.sh').read_text(encoding='utf-8'),
        folder / 'registry-login.sh': (ROOT / f'deploy/{channel}/registry-login.sh').read_text(encoding='utf-8'),
        folder / 'backup.sh': backup_script(3),
        folder / 'verify-backup.sh': verify_script(3),
        folder / 'prepare-operations-env.py': (ROOT / 'scripts/prepare-operations-env.py').read_text(encoding='utf-8'),
        folder / 'prepare-findhub-env.py': (ROOT / 'scripts/prepare-findhub-env.py').read_text(encoding='utf-8'),
        folder / 'prepare-traccar-env.py': (ROOT / 'scripts/prepare-traccar-env.py').read_text(encoding='utf-8'),
        folder / 'prepare-volumes.py': (ROOT / 'scripts/prepare-full-stack-volumes.py').read_text(encoding='utf-8'),
        folder / 'check-runtime.py': (ROOT / 'scripts/check-full-stack-runtime.py').read_text(encoding='utf-8'),
        folder / 'recover-full-stack.sh': recover_full_stack(channel),
    }


def full_files(channel):
    folder = Path('deploy/fersoft') / channel / 'full-stack'
    return {
        folder / 'compose.yaml': '# Generated Fersoft full-stack deployment. Do not edit by hand.\n' + compose_for(channel, True),
        folder / 'env.example': environment_for(channel, True),
        folder / 'README.md': readme(channel, True),
        folder / 'MIGRACAO-FULL-STACK-FERSOFT.md': migration(channel),
        folder / 'prepare-env.py': (ROOT / 'scripts/prepare-full-stack-env.py').read_text(encoding='utf-8'),
        folder / 'prepare-env.sh': '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\npython3 ./prepare-env.py "$@"\n',
        folder / 'preflight.sh': full_preflight(),
        folder / 'deploy.sh': full_deploy(),
        folder / 'update.sh': full_deploy(update=True),
        folder / 'status.sh': '#!/usr/bin/env bash\nset -euo pipefail\ncd "$(dirname "$0")"\ndocker compose --env-file .env -f compose.yaml ps\n',
        folder / 'registry-login.sh': (ROOT / f'deploy/{channel}/registry-login.sh').read_text(encoding='utf-8'),
        folder / 'backup.sh': backup_script(4),
        folder / 'verify-backup.sh': verify_script(4),
        folder / 'prepare-operations-env.py': (ROOT / 'scripts/prepare-operations-env.py').read_text(encoding='utf-8'),
        folder / 'prepare-findhub-env.py': (ROOT / 'scripts/prepare-findhub-env.py').read_text(encoding='utf-8'),
        folder / 'prepare-traccar-env.py': (ROOT / 'scripts/prepare-traccar-env.py').read_text(encoding='utf-8'),
        folder / 'prepare-volumes.py': (ROOT / 'scripts/prepare-full-stack-volumes.py').read_text(encoding='utf-8'),
        folder / 'check-runtime.py': (ROOT / 'scripts/check-full-stack-runtime.py').read_text(encoding='utf-8'),
    }


def generate():
    files = {
        Path('deploy/fersoft/README.md'): '''# Deployments Fersoft

Quatro perfis sao mantidos sem remover os deploys oficiais existentes.

develop/: normal, derivado de deploy/develop.
develop/full-stack/: 14 servicos, derivado de deploy/develop/full-stack.
production/: normal, derivado de deploy/production.
production/full-stack/: 14 servicos, derivado de deploy/production/full-stack.

Cada perfil aponta para nomes de projeto, rede, servicos internos, banco, dominio e dados Fersoft.
As imagens e referencias GHCR sao exatamente as do template de origem e nao sao reescritas por este gerador.
Full stack e alternativa ao normal do mesmo canal e compartilha somente os dados daquele canal em ../volumes.
'''
    }
    for channel in CHANNELS:
        files.update(normal_files(channel))
        files.update(full_files(channel))
    return files


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    changed = []
    for relative, text in generate().items():
        path = ROOT / relative
        if not path.exists() or path.read_text(encoding='utf-8') != text:
            changed.append(str(relative))
            if not args.check:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.write_text(text, encoding='utf-8')
                if path.suffix in ('.sh', '.py'):
                    path.chmod(0o755)
    if args.check and changed:
        raise SystemExit('Deploys Fersoft desatualizados: ' + ', '.join(changed))
    print('Deploys Fersoft sincronizados: ' + str(len(changed)))


if __name__ == '__main__':
    main()
