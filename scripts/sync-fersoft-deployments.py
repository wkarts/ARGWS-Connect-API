#!/usr/bin/env python3
"""Generate the Fersoft deployment contract: Compose, environment and volumes only.

An installed Fersoft stack never needs a helper executable. Service selection is
declared in .env and every runtime bootstrap lives in its image or Compose
entrypoint.
"""
import argparse
import importlib.util
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
    'TRANSCRIPTION_ENABLED': 'false',
    'SPEECH_ENABLED': 'false',
    'DICTATION_ENABLED': 'false',
    'MANAGER_FEATURE_TRANSCRIPTION': 'false',
    'SPEECH_GLOBAL_CONCURRENCY': '1',
    'TRANSCRIPTION_PROVIDER': 'local',
}

spec = importlib.util.spec_from_file_location('ops', ROOT / 'scripts/prepare-operations-env.py')
ops = importlib.util.module_from_spec(spec)
spec.loader.exec_module(ops)


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


def overrides(channel):
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
    values.update(FULL_STACK_DEFAULTS)
    return values


def compose_for(channel):
    compose = replace_identity(
        yaml.safe_load((ROOT / f'deploy/{channel}/compose.yaml').read_text(encoding='utf-8')),
        channel,
    )
    services = compose['services']
    services[f'docs-{suffix(channel)}'].pop('ports', None)
    return yaml.safe_dump(compose, sort_keys=False, allow_unicode=True, width=120)


def environment_for(channel):
    text = (ROOT / f'deploy/{channel}/env.example').read_text(encoding='utf-8')
    text = text.replace(source_suffix(channel), suffix(channel))
    for key, value in overrides(channel).items():
        text = ops.set_value(text, key, value)
    header = (
        '# FERSOFT FULL STACK: um compose, um .env e os volumes existentes.\n'
        '# Todos os services opcionais sao selecionados aqui; nao use arquivos auxiliares.\n'
        '# Transcricao e ditado sao opt-in no servico nativo unico; nenhum provider depende deles.\n'
    )
    text = text.replace(
        '# Duas portas locais publicadas: API e Connect|API DOCs. Manager permanece em /manager.',
        '# Uma porta local publicada: API. Manager e DOCs permanecem na API.',
    )
    text = text.replace(
        '# Para habilitar o worker local, acrescente `transcription` sem remover os perfis existentes.',
        '# Um servico nativo opcional atende ditado e transcricao com limites de recursos.',
    )
    text = text.replace(
        '# O perfil transcription acompanha o develop quando a transcrição local está ligada.',
        '# Um servico nativo opcional atende ditado e transcricao com limites de recursos.',
    )
    return header + text


def readme():
    return """# Deployments Fersoft

Cada canal contém apenas `compose.yaml` e `env.example`. Preserve o `.env`
instalado, os segredos, os identificadores e todos os volumes.

A transcrição e o ditado agora usam somente `transcription-service-fersoft-connect-<canal>`.
Os workers anteriores não integram mais os manifests, imagens ou dependências novas.
O perfil `transcription` é opcional e não é incluído por padrão.
Nenhum envio/recebimento, áudio, vídeo, PTT, chamada ou provider depende do ASR.

A full stack mantém os perfis `operations,nats,kafka,mysql,traccar` e seus serviços.
Para habilitar fala, acrescente `transcription` sem remover outros perfis, configure
`SPEECH_ENABLED`, `TRANSCRIPTION_ENABLED`, `DICTATION_ENABLED` e
`MANAGER_FEATURE_TRANSCRIPTION` explicitamente, e provisione o modelo nativo com checksum.
Não copie o exemplo sobre um `.env` instalado. Migre o seletor de motor/modelo antes
 de habilitar. O antigo modelo Transformers não é reinterpretado como GGML.

O runtime padrão é whisper.cpp/base-q5_1, CPU-only. `SPEECH_SERVICE_MEMORY=1280m`,
`SPEECH_SERVICE_CPUS=1.00` e `SPEECH_SERVICE_TMPFS_SIZE=128m` são limites, não benchmarks.
O modelo pode descarregar quando ocioso; `SPEECH_MODEL_KEEP_WARM` e `SPEECH_PREWARM`
são opt-in. Uma inferência por vez atende as duas modalidades e todas as instâncias.
O bucket de fala permanece privado e separado do bucket público de mídia.

Antes da atualização: interrompa novas admissões de fala, drene/cancele os jobs em
andamento pelos contratos existentes e pare/remova apenas os containers antigos de
transcrição/ditado do projeto correto. Não apague volumes, banco, filas nem modelos.
Não use `down -v`. Substitua o Compose, migre somente as variáveis documentadas e
suba o novo serviço quando o modelo e a imagem correspondente estiverem disponíveis.
A PR não publica imagens nem altera VPS automaticamente.

Consulte `docs/guides/optional-transcription-service.md` para a matriz completa,
ativação offline, limites, retirada seletiva dos containers antigos e rollback Git.
"""


def generate():
    files = {Path('deploy/fersoft/README.md'): readme()}
    for channel in CHANNELS:
        folder = Path('deploy/fersoft') / channel
        files[folder / 'compose.yaml'] = '# Generated Fersoft Compose deployment. Do not edit by hand.\n' + compose_for(channel)
        files[folder / 'env.example'] = environment_for(channel)
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
    if args.check and changed:
        raise SystemExit('Deploys Fersoft desatualizados: ' + ', '.join(changed))
    print('Deploys Fersoft sincronizados: ' + str(len(changed)))


if __name__ == '__main__':
    main()
