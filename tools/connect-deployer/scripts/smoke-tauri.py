#!/usr/bin/env python3
"""Exercise the actual desktop's embedded agents without initializing GUI/SSH."""
import json,os,subprocess,tempfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
exe=root/'target/release'/('argws-connect-deployer.exe' if os.name=='nt' else 'argws-connect-deployer')
expected=json.loads((root/'src-tauri/build-info.json').read_text())
with tempfile.TemporaryDirectory() as work:
    path=Path(work)/'self-check.json'
    subprocess.run([str(exe),'--self-check-file',str(path)],cwd=work,check=True,timeout=60)
    report=json.loads(path.read_text())
    assert report['ok'] is True and report['build']==expected
    for arch in ['amd64','arm64']:
        assert report['agents'][arch]['embedded'] is True
        assert report['agents'][arch]['sha256']==expected['agents'][arch]['sha256']
print('PASS: native desktop offline identity and both embedded static agents')
