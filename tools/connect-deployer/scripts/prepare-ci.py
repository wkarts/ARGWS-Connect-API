#!/usr/bin/env python3
"""Bind the supplied Tauri project to the owning Connect API source and both agents."""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tomllib

ROOT = Path(__file__).resolve().parents[1]
REPO = ROOT.parents[1]
TARGETS = {'amd64': 62, 'arm64': 183}

def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()

def check_elf(path, architecture):
    data = path.read_bytes()
    if data[:6] != b'\x7fELF\x02\x01' or int.from_bytes(data[18:20], 'little') != TARGETS[architecture]:
        raise ValueError('Agent is not ELF64 for ' + architecture)
    return {'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()}

def main():
    sha = subprocess.check_output(['git','rev-parse','HEAD'], cwd=REPO,text=True).strip()
    if sha != os.environ['CONNECT_DEPLOYER_EXPECTED_SHA']:
        raise ValueError('Source revision mismatch')
    source = json.loads((ROOT/'SOURCE-IMPORT.json').read_text())
    expected = source['files']['reference/install-connect-python-original.py']['sha256']
    if digest(ROOT/'reference/install-connect-python-original.py') != expected:
        raise ValueError('Original reference changed')
    workspace = tomllib.loads((ROOT/'Cargo.toml').read_text())
    version = workspace['workspace']['package']['version']
    for file in ['package.json','src-tauri/tauri.conf.json']:
        if json.loads((ROOT/file).read_text())['version'] != version:
            raise ValueError('Deployer version mismatch: ' + file)
    info = {'schema_version': 1,'project':'ARGWS Connect API', 'repository':os.environ['GITHUB_REPOSITORY'],
            'project_version':(REPO/'VERSION').read_text().strip(),'deployer_version':version,
            'source_sha':sha,'channel':os.environ['CONNECT_DEPLOYER_CHANNEL'],
            'release_tag':os.environ.get('CONNECT_DEPLOYER_RELEASE_TAG',''),
            'target':os.environ['CONNECT_DEPLOYER_TARGET'],'agents':{},
            'cargo_lock_sha256':digest(ROOT/'Cargo.lock'),
            'npm_lock_sha256':digest(ROOT/'package-lock.json'),
            'publisher_signed':False}
    for arch in TARGETS:
        directory=REPO/'.agents'/arch
        binary=directory/('connect-deploy-agent-linux-'+arch)
        receipt=json.loads((directory/('connect-deploy-agent-linux-'+arch+'.build.json')).read_text())
        actual=check_elf(binary,arch)
        if receipt['source_sha'] != sha or receipt['deployer_version'] != version or receipt['sha256'] != actual['sha256']:
            raise ValueError('Agent source or digest mismatch: '+arch)
        if receipt['static'] is not True: raise ValueError('Agent must be static')
        destination=ROOT/'src-tauri/embedded'/('agent-linux-'+arch)
        destination.write_bytes(binary.read_bytes())
        destination.chmod(0o755)
        info['agents'][arch]=actual
    (ROOT/'src-tauri/build-info.json').write_text(json.dumps(info,indent=2)+'\n')
    print(json.dumps(info,indent=2))

if __name__=='__main__': main()
