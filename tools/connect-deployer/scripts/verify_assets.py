#!/usr/bin/env python3
"""Release gate: do not publish partial/mismatched Tauri or agent outputs."""
import hashlib,json,os,sys,zipfile
from pathlib import Path
root=Path(sys.argv[1]);expected=os.environ['EXPECTED_SHA'];version=os.environ['EXPECTED_VERSION'];channel=os.environ['EXPECTED_CHANNEL']
platforms=set()
for path in root.glob('*.zip'):
    expected_hash=path.with_suffix('.zip.sha256').read_text().split()[0]
    assert hashlib.sha256(path.read_bytes()).hexdigest()==expected_hash
    with zipfile.ZipFile(path) as z:
        assert z.testzip() is None
        info=json.loads(z.read('BUILD-INFO.json'))
        assert info['source_sha']==expected and info['project_version']==version and info['channel']==channel
        assert info['target'] not in platforms
        platforms.add(info['target'])
        for line in z.read('SHA256SUMS.txt').decode().splitlines():
            digest,name=line.split('  ',1)
            assert hashlib.sha256(z.read(name)).hexdigest()==digest
        for arch in ['amd64','arm64']:
            agent=root/('connect-deploy-agent-linux-'+arch)
            receipt=json.loads(agent.with_name(agent.name+'.build.json').read_text())
            assert receipt['static'] is True and receipt['source_sha']==expected
            assert info['agents'][arch]['sha256']==hashlib.sha256(agent.read_bytes()).hexdigest()==receipt['sha256']
assert platforms=={'windows-x64','linux-x64','linux-arm64','macos-arm64'},platforms
manifest=root/'CONNECT-DEPLOYER-SHA256SUMS.txt'
manifest.write_text(''.join(hashlib.sha256(p.read_bytes()).hexdigest()+'  '+p.name+'\n' for p in sorted(root.iterdir()) if p.is_file() and p!=manifest))
print('PASS: 4 GUI packages and 2 static agents match source, checksums and channel')
