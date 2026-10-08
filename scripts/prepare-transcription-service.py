#!/usr/bin/env python3
"""Generate an opt-in overlay. Never edit .env, deploy, or delete existing data."""
import argparse
import copy
import json
from pathlib import Path
import sys

import yaml

ROOT = Path(__file__).resolve().parents[1]
MODEL_ENV = {
    'SPEECH_ENGINE': '${SPEECH_ENGINE:-whisper.cpp}',
    'SPEECH_MODEL': '${SPEECH_MODEL:-whisper-base-q5_1}',
    'SPEECH_MODEL_PATH': '${SPEECH_MODEL_PATH:-/models/whisper.cpp/base-q5_1}',
    'SPEECH_MODEL_AUTO_PROVISION': '${SPEECH_MODEL_AUTO_PROVISION:-false}',
    'SPEECH_ENABLED': '${SPEECH_ENABLED:-${TRANSCRIPTION_ENABLED:-false}}',
    'TRANSCRIPTION_ENABLED': '${TRANSCRIPTION_ENABLED:-false}',
    'DICTATION_ENABLED': '${DICTATION_ENABLED:-false}',
}


def make_overlay(base, image=None):
    services = base.get('services', {})
    legacy = {name: value for name, value in services.items()
              if name.startswith(('transcription-worker', 'dictation-worker'))}
    pools = [name for name in legacy if name.startswith('transcription-worker')]
    if len(pools) != 1:
        raise ValueError('Esperado um único serviço transcription-worker no Compose de origem.')
    if 'transcription-service' in services:
        raise ValueError('O Compose já contém transcription-service; não será sobrescrito.')
    apis = [name for name, value in services.items() if name not in legacy
            and isinstance(value.get('environment'), dict)
            and 'SPEECH_ENGINE' in value['environment']
            and 'TRANSCRIPTION_ENABLED' in value['environment']]
    if len(apis) != 1:
        raise ValueError('Não foi possível identificar univocamente o backend com o módulo de fala.')
    service = copy.deepcopy(legacy[pools[0]])
    for key in ['container_name', 'ports', 'expose', 'build']:
        service.pop(key, None)
    service.update({
        'profiles': ['transcription'], 'scale': 1, 'init': True,
        'image': image or 'connect-transcription-service:local',
        'pull_policy': 'missing' if image else 'build',
        'restart': 'on-failure:3',
        'mem_limit': '${SPEECH_SERVICE_MEMORY:-1280m}',
        'memswap_limit': '${SPEECH_SERVICE_MEMORY:-1280m}',
        'cpus': '${SPEECH_SERVICE_CPUS:-1.0}', 'pids_limit': 128,
        'read_only': True, 'cap_drop': ['ALL'],
        'security_opt': ['no-new-privileges:true'],
        'tmpfs': ['/tmp:size=${SPEECH_SERVICE_TMPFS_SIZE:-128m},mode=1777,noexec,nosuid,nodev'],
    })
    if not image:
        service['build'] = {'context': str(ROOT / 'transcription-worker'), 'dockerfile': 'Dockerfile.service'}
    environment = service.setdefault('environment', {})
    if not isinstance(environment, dict):
        raise ValueError('O ambiente do executor precisa estar em formato de mapa.')
    environment.update(MODEL_ENV)
    environment.update({
        'SPEECH_WORKER_MODE': 'pool', 'SPEECH_WORKER_CONCURRENCY': '1',
        'SPEECH_GLOBAL_CONCURRENCY': '${SPEECH_GLOBAL_CONCURRENCY:-1}',
        'SPEECH_INFERENCE_THREADS': '${SPEECH_INFERENCE_THREADS:-1}',
        'SPEECH_POOL_PREFETCH': '${SPEECH_POOL_PREFETCH:-4}',
        'SPEECH_SOURCE_CACHE_MAX_BYTES': '${SPEECH_SOURCE_CACHE_MAX_BYTES:-33554432}',
        'SPEECH_CHUNK_SECONDS': '${SPEECH_CHUNK_SECONDS:-15}',
        'SPEECH_STRIDE_SECONDS': '${SPEECH_STRIDE_SECONDS:-1}',
        'SPEECH_DICTATION_CHUNK_SECONDS': '${SPEECH_DICTATION_CHUNK_SECONDS:-5}',
        'SPEECH_DICTATION_STRIDE_SECONDS': '${SPEECH_DICTATION_STRIDE_SECONDS:-1}',
        'SPEECH_PCM_FAST_PATH': '${SPEECH_PCM_FAST_PATH:-true}',
        'SPEECH_SKIP_DIGITAL_SILENCE': '${SPEECH_SKIP_DIGITAL_SILENCE:-true}',
        'SPEECH_PREWARM': '${SPEECH_PREWARM:-false}',
        'SPEECH_MODEL_KEEP_WARM': '${SPEECH_MODEL_KEEP_WARM:-false}',
    })
    # scale=0 remains effective even when profiles are merged as a union.
    # Stopping legacy containers during migration is an explicit operator step.
    result = {name: {'scale': 0} for name in legacy}
    result[apis[0]] = {'environment': dict(MODEL_ENV)}
    result['transcription-service'] = service
    return {'services': result}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--compose', required=True, type=Path)
    parser.add_argument('--output', required=True, type=Path)
    parser.add_argument('--image', help='Use an already built native service image; omit to build this checkout.')
    parser.add_argument('--force', action='store_true', help='Replace the output overlay only, never the base Compose.')
    args = parser.parse_args()
    source, output = args.compose.resolve(), args.output.resolve()
    if source == output:
        parser.error('O overlay não pode substituir o Compose de origem.')
    if output.exists() and not args.force:
        parser.error('O destino existe. Escolha outro arquivo ou use --force explicitamente.')
    try:
        base = yaml.safe_load(source.read_text(encoding='utf-8'))
        if not isinstance(base, dict):
            raise ValueError('Compose inválido.')
        overlay = make_overlay(base, args.image)
        output.parent.mkdir(parents=True, exist_ok=True)
        with output.open('w' if args.force else 'x', encoding='utf-8') as handle:
            handle.write('# Opt-in native speech overlay. Original provider/message contracts are unchanged.\n')
            yaml.safe_dump(overlay, handle, sort_keys=False, allow_unicode=True)
        print(json.dumps({'overlay': str(output), 'base': str(source), 'enabled': False,
                          'service': 'transcription-service', 'legacyReplicas': 0}, ensure_ascii=False))
    except (OSError, ValueError, yaml.YAMLError) as error:
        print(str(error), file=sys.stderr)
        return 1
    return 0


if __name__ == '__main__':
    raise SystemExit(main())
