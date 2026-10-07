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
    'SPEECH_WORKER_MODE': 'pool',
    'MANAGER_FEATURE_TRANSCRIPTION': 'false',
    'SPEECH_TRANSCRIPTION_REPLICAS': '1',
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
        '# A transcricao neste exemplo descreve a configuracao futura: release bloqueada ate validacao no develop principal.\n'
    )
    text = text.replace(
        '# Duas portas locais publicadas: API e Connect|API DOCs. Manager permanece em /manager.',
        '# Uma porta local publicada: API. Manager e DOCs permanecem na API.',
    )
    text = text.replace(
        '# Para habilitar o worker local, acrescente `transcription` sem remover os perfis existentes.',
        '# Um pool atende ditado e transcricao com um modelo residente e limites de recursos.',
    )
    text = text.replace(
        '# O perfil transcription acompanha o develop quando a transcrição local está ligada.',
        '# Um pool atende ditado e transcricao com um modelo residente e limites de recursos.',
    )
    return header + text


def readme():
    return '''# Deployments Fersoft

Cada diretório (`develop/` e `production/`) contém somente `compose.yaml` e
`env.example`. Em uma instalação existente, mantenha o `.env` atual e os
diretórios `./volumes/*`; não copie nem execute auxiliares externos.

**Release de áudio suspensa:** as opções de transcrição abaixo descrevem a
configuração futura e não devem ser aplicadas agora aos `.env` instalados.
Mantenha os serviços de voz desativados nas stacks Fersoft enquanto o ensaio
com modelo real é concluído no develop principal. O bloqueio em `main` impede
a publicação da release antes dessa validação.

A full stack é selecionada pelo próprio `.env`. A fala é opt-in e fica
desativada por padrão enquanto a release está suspensa:

```dotenv
COMPOSE_PROFILES=operations,nats,kafka,mysql,traccar
OPERATIONS_ENABLED=true
NATS_ENABLED=true
KAFKA_ENABLED=true
MYSQL_SERVICE_ENABLED=true
TRACCAR_ENABLED=true
TRANSCRIPTION_ENABLED=false
SPEECH_ENABLED=false
DICTATION_ENABLED=false
SPEECH_WORKER_MODE=pool
MANAGER_FEATURE_TRANSCRIPTION=false
SPEECH_TRANSCRIPTION_REPLICAS=1
SPEECH_GLOBAL_CONCURRENCY=1
```

Ditado e transcrição usam o mesmo worker por stack, com perfil `transcription`
e `SPEECH_WORKER_MODE=pool`. O Compose fixa `scale: 1`, inclusive quando um
`.env` antigo contém `SPEECH_TRANSCRIPTION_REPLICAS=2`. O modelo é carregado
no processo filho depois da admissão e permanece residente por até
`SPEECH_MODEL_IDLE_TTL_SECONDS=300` segundos ociosos. A API não carrega o motor.
O worker antigo exclusivo de ditado não integra mais os manifests.

Novos uploads e ditados usam um bucket privado dedicado. A API e o worker
recebem o mesmo `SPEECH_S3_BUCKET_NAME`; vazio deriva `S3_BUCKET` com sufixo
`-speech`. Preserve um valor privado personalizado no `.env` instalado.
Não use o bucket público de mídia. A API verifica a política e não publica
esses objetos; os objetos legados permanecem no bucket de origem.

O adaptador padrão continua `SPEECH_ENGINE=transformers`, com teto de `4g`
para coordenador, processo filho e tmpfs juntos, sem swap adicional.
`TRANSCRIPTION_WORKER_TMPFS_SIZE=256m`, threads explícitas e fila limitada
contêm o trabalho admitido. Esse teto não é uma medição de consumo.
O perfil de configuração `deploy/speech/canary-whisper-cpp.env.example`
seleciona explicitamente whisper.cpp/base multilíngue q5_1, com teto total de
1280 MiB; mantenha-o no develop até medir qualidade pt-BR e carga sustentada.

Em instalações existentes, preserve os segredos, banco, filas, `./models` e
volumes. Somente depois de liberar a release, atualize o Compose e as imagens
da API e do worker no mesmo canal.
Edite o `.env` existente para incluir `transcription` em `COMPOSE_PROFILES`,
ajustar `TRANSCRIPTION_ENABLED=true`, `SPEECH_ENABLED=true`,
`MANAGER_FEATURE_TRANSCRIPTION=true`, `DICTATION_ENABLED=true`,
`SPEECH_TRANSCRIPTION_REPLICAS=1`, `SPEECH_GLOBAL_CONCURRENCY=1` e
`SPEECH_WORKER_MODE=pool` e `TRANSCRIPTION_WORKER_TMPFS_SIZE=256m`.
`DICTATION_MAX_DURATION_SECONDS=60` e `DICTATION_JOB_DEADLINE_SECONDS=120`
limitam os ditados a um prazo útil. O `env.example` não altera o `.env`
instalado. Antes de alternar o protocolo de filas, interrompa a admissão e
drene ou reconcilie os jobs legados conforme `docs/guides/speech.md`.
Faça `pull` e `up -d --remove-orphans` no projeto Compose correto depois da
verificação de jobs e fontes; o comando remove serviços órfãos daquele projeto,
inclusive o worker antigo de ditado, e não deve ser acompanhado de `down -v`.
Em VPS que hospeda develop e production, dimensione o pico simultâneo de todas
as stacks, que podem usar brokers diferentes, antes de ligar os dois perfis.

Suba ou atualize diretamente pelo Dockge/Compose usando esses dois arquivos.
O bootstrap do Traccar é incorporado no `compose.yaml`; os demais comportamentos
de runtime já pertencem às imagens dos services.

O Manager mostra o painel de frota usando somente a API interna do Traccar; não
cria hostname, porta, service ou arquivo de runtime adicional. A senha e a
sessão administrativa do Traccar permanecem no servidor.
'''


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
