#!/usr/bin/env python3
"""Synchronize Find Hub in versioned deployment templates only; never touch an installed .env."""
import argparse
import json
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DEFAULTS = {
    'FINDHUB_CREDENTIALS_KEY': '',
    'FINDHUB_DEFAULT_TRACKING_INTERVAL_SECONDS': '60',
    'FINDHUB_MIN_TRACKING_INTERVAL_SECONDS': '30',
    'FINDHUB_LOCATION_TIMEOUT_MS': '30000',
    'FINDHUB_STORE_POSITION_HISTORY': 'false',
    'FINDHUB_TRACCAR_TIMEOUT_MS': '10000',
}
SOURCE = '{"url":"openapi/findhub.openapi.json","title":"Connect|API Google Find Hub","slug":"findhub"}'
HEADER = '''\n# Google Find Hub: chave LOCAL de criptografia, nao uma chave do Google.
# Execute python3 prepare-findhub-env.py (ou prepare-env.sh) uma vez; nao rotacione a chave em updates.
# Guarde a chave com seguranca junto do backup. Nao enviar para Manager/Scalar/webhooks.
'''
SKIP = {'.git', 'node_modules', '.venv', 'venv', '__pycache__', 'dist', 'third-party'}


def repository_files(root):
    result = []
    for directory, subdirs, filenames in os.walk(root):
        subdirs[:] = sorted(name for name in subdirs if name not in SKIP)
        for name in sorted(filenames):
            result.append((Path(directory) / name).relative_to(root).as_posix())
    return result


def service_blocks(text):
    services = re.search(r'^services:\s*\n', text, re.M)
    if not services:
        return []
    stop = re.search(r'^[^\s#][^\n]*:', text[services.end():], re.M)
    end = services.end() + stop.start() if stop else len(text)
    matches = list(re.finditer(r'^  ([A-Za-z0-9_.-]+):[^\S\n]*\n', text[services.end():end], re.M))
    blocks = []
    for index, match in enumerate(matches):
        start = services.end() + match.start()
        finish = services.end() + matches[index + 1].start() if index + 1 < len(matches) else end
        blocks.append((match.group(1), start, finish, text[start:finish]))
    return blocks


def api_service(name, block):
    return bool(re.search(r'^    image:.*(?:argws-connect-api|ARGWS_CONNECT_API_IMAGE)', block, re.M)) and 'operations-agent/' not in block and not name.startswith('operations')


def with_environment(block):
    if re.search(r'^    environment:\s*\n', block, re.M):
        match = re.search(r'^    environment:\s*\n', block, re.M)
        tail = block[match.end():]
        list_mode = bool(re.match(r'(?:\s*#[^\n]*\n)*\s+- ', tail))
    else:
        first = block.index('\n') + 1
        block = block[:first] + '    environment:\n' + block[first:]
        match = re.search(r'^    environment:\s*\n', block, re.M)
        list_mode = False
    additions = []
    for name, default in DEFAULTS.items():
        interpolation = '${' + name + ':-' + default + '}'
        line = f'      - {name}={interpolation}' if list_mode else f'      {name}: "{interpolation}"'
        pattern = r'^      (?:-\s*)?' + re.escape(name) + r'(?:=|:)[^\n]*$'
        count = len(re.findall(pattern, block, re.M))
        if count > 1:
            raise ValueError('Duplicate Find Hub environment entry: ' + name)
        if count:
            block = re.sub(pattern, lambda _: line, block, flags=re.M)
        else:
            additions.append(line)
    if additions:
        block = re.sub(r'^    environment:\s*\n', lambda m: m.group(0) + '\n'.join(additions) + '\n', block, count=1, flags=re.M)
    return block


def scalar_source(text):
    if 'findhub.openapi.json' in text:
        return text
    return re.sub(r'(\{\s*"url"\s*:\s*"openapi/connect-api\.openapi\.json"[^{}]*\})', lambda m: m.group(1) + ',' + SOURCE, text)


def env_template(text):
    missing = []
    for name, default in DEFAULTS.items():
        pattern = r'^' + re.escape(name) + r'=[^\n]*$'
        if len(re.findall(pattern, text, re.M)) > 1:
            raise ValueError('Duplicate Find Hub template entry: ' + name)
        if re.search(pattern, text, re.M):
            text = re.sub(pattern, lambda _: name + '=' + default, text, flags=re.M)
        else:
            missing.append(name + '=' + default)
    if missing:
        text = text.rstrip() + '\n' + HEADER + '\n'.join(missing) + '\n'
    return text


def generate(root, overrides=None):
    overrides = overrides or {}
    outputs = {}
    paths = sorted(set(repository_files(root)) | set(overrides))
    def read(path):
        return overrides[path] if path in overrides else (root / path).read_text(encoding='utf-8')
    api_profiles = []
    scalar_profiles = []
    excluded = []
    api_directories = {'.'}
    for path in paths:
        if not path.endswith(('.yaml', '.yml')) or path.startswith('.github/'):
            continue
        before = read(path)
        blocks = service_blocks(before)
        if not blocks:
            continue
        current = before
        for name, start, end, block in reversed(blocks):
            if api_service(name, block):
                current = current[:start] + with_environment(block) + current[end:]
                api_profiles.append({'path': path, 'service': name})
                api_directories.add(Path(path).parent.as_posix())
        updated = scalar_source(current)
        if 'findhub.openapi.json' in updated and 'API_REFERENCE_CONFIG' in updated:
            scalar_profiles.append(path)
        if not any(api_service(name, block) for name, _, _, block in blocks):
            excluded.append(path)
        if updated != before:
            outputs[path] = updated
    envs = []
    for path in paths:
        if Path(path).name not in ('.env.example', 'env.example'):
            continue
        before = read(path)
        if 'AUTHENTICATION_API_KEY' not in before:
            updated = scalar_source(before)
        else:
            updated = scalar_source(env_template(before))
            envs.append(path)
            api_directories.add(Path(path).parent.as_posix())
        if updated != before:
            outputs[path] = updated
    helper = read('scripts/prepare-findhub-env.py')
    for directory in sorted(api_directories):
        prefix = '' if directory == '.' else directory + '/'
        # Profiles copied out of the repository must remain self-contained.
        if prefix + 'prepare-env.sh' not in paths:
            continue
        outputs[prefix + 'prepare-findhub-env.py'] = helper
        prepare_path = prefix + 'prepare-env.sh'
        prepare = read(prepare_path)
        hook = 'python3 ./prepare-findhub-env.py --env-file .env "$@"\n'
        if hook not in prepare:
            prepare = prepare.rstrip() + '\n' + hook
        outputs[prepare_path] = prepare
        preflight_path = prefix + 'preflight.sh'
        if preflight_path in paths:
            preflight = read(preflight_path)
            hook = 'python3 ./prepare-findhub-env.py --env-file .env --check\n'
            if hook not in preflight:
                anchor = 'cd "$(dirname "$0")"\n'
                if anchor not in preflight:
                    raise ValueError('Unknown preflight entry point: ' + preflight_path)
                preflight = preflight.replace(anchor, anchor + hook, 1)
            outputs[preflight_path] = preflight
    outputs['docs/operations/findhub-deployment-coverage.json'] = json.dumps({
        'apiServices': sorted(api_profiles, key=lambda item: (item['path'], item['service'])),
        'apiEnvironmentTemplates': sorted(envs),
        'scalarComposeFiles': sorted(scalar_profiles),
        'resourceOnlyComposeFiles': sorted(excluded),
        'environmentVariables': DEFAULTS,
        'policy': 'Only API services receive explicit Find Hub settings. No key in Scalar/Manager configuration. No image, port, volume or service topology changes.',
    }, indent=2, ensure_ascii=False) + '\n'
    return outputs


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check', action='store_true')
    parser.add_argument('--root', type=Path, default=ROOT)
    args = parser.parse_args()
    changed = []
    for path, text in generate(args.root).items():
        target = args.root / path
        if not target.exists() or target.read_text(encoding='utf-8') != text:
            changed.append(path)
            if not args.check:
                target.parent.mkdir(parents=True, exist_ok=True)
                target.write_text(text, encoding='utf-8')
    if args.check and changed:
        raise SystemExit('Find Hub deployment contract out of sync: ' + ', '.join(changed))
    print('Find Hub deployment contract: ' + ('verified' if args.check else f'{len(changed)} files synchronized'))


if __name__ == '__main__':
    main()
