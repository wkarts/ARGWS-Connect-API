#!/usr/bin/env python3
"""Collect Tauri binaries/installers with unambiguous names and verified metadata."""
import hashlib,json,os,re,stat,zipfile
from pathlib import Path
root=Path(__file__).resolve().parents[1]
info=json.loads((root/'src-tauri/build-info.json').read_text())
target=info['target'];assert target in {'windows-x64','linux-x64','linux-arm64','macos-arm64'}
name=f"Connect-Deployer-{info['deployer_version']}-{info['channel']}-{info['source_sha'][:12]}-{target}"
assert re.fullmatch('[A-Za-z0-9._-]+',name)
built=root/'target/release'
exe=built/('argws-connect-deployer.exe' if target.startswith('windows') else 'argws-connect-deployer')
assert exe.is_file()
files={exe.name:(exe.read_bytes(),0o755), 'BUILD-INFO.json':(json.dumps(info,indent=2).encode(),0o644)}
expected={'windows-x64':{'.exe'},'linux-x64':{'.deb','.AppImage'},'linux-arm64':{'.deb','.AppImage'},'macos-arm64':{'.dmg'}}[target]
found=set()
for path in sorted((built/'bundle').rglob('*')):
    if path.is_file() and path.suffix in expected:
        dest='installers/'+path.name
        assert dest not in files
        files[dest]=(path.read_bytes(),0o755 if path.suffix in {'.exe','.AppImage'} else 0o644)
        found.add(path.suffix)
assert found==expected,('Missing installers',expected-found)
for name_in in ['README.md','SECURITY.md','NOTICE.md','Cargo.lock','package-lock.json','SOURCE-IMPORT.json']:
    files[name_in]=((root/name_in).read_bytes(),0o644)
files['SHA256SUMS.txt']=(''.join(hashlib.sha256(data).hexdigest()+'  '+path+'\n' for path,(data,_) in sorted(files.items())).encode(),0o644)
out=root/'dist/release';out.mkdir(parents=True,exist_ok=True)
archive=out/(name+'.zip')
with zipfile.ZipFile(archive,'w',compression=zipfile.ZIP_DEFLATED,compresslevel=6) as z:
    for path,(data,mode) in sorted(files.items()):
        meta=zipfile.ZipInfo(path);meta.create_system=3;meta.external_attr=(stat.S_IFREG|mode)<<16
        z.writestr(meta,data,compress_type=zipfile.ZIP_DEFLATED)
archive.with_suffix('.zip.sha256').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n')
print(archive)
