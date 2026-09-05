#!/usr/bin/env python3
"""Package ONLY a tested static ELF agent, without connecting to a VPS."""
import hashlib,json,os,shutil,subprocess,tomllib
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
arch=os.environ['AGENT_ARCH']
target=os.environ['AGENT_TARGET']
source=ROOT/'target'/target/'release/connect-deploy-agent'
data=source.read_bytes()
assert data[:6]==b'\x7fELF\x02\x01'
assert int.from_bytes(data[18:20],'little')=={'amd64':62,'arm64':183}[arch]
headers=subprocess.check_output(['readelf','-l',str(source)],text=True)
assert 'INTERP' not in headers,'Agent depends on a dynamic loader'
report=json.loads(subprocess.check_output([str(source),'self-test'],text=True))
assert report['ok'] is True and report['os']=='linux'
assert report['arch']=={'amd64':'x86_64','arm64':'aarch64'}[arch]
version=tomllib.loads((ROOT/'Cargo.toml').read_text())['workspace']['package']['version']
assert report['version']==version
out=ROOT/'dist/agents';out.mkdir(parents=True,exist_ok=True)
name='connect-deploy-agent-linux-'+arch
shutil.copyfile(source,out/name);(out/name).chmod(0o755)
sha=hashlib.sha256(data).hexdigest()
(out/(name+'.sha256')).write_text(sha+'  '+name+'\n')
receipt={'source_sha':os.environ['CONNECT_DEPLOYER_EXPECTED_SHA'],'deployer_version':version,
         'sha256':sha,'static':True,'self_test':report}
(out/(name+'.build.json')).write_text(json.dumps(receipt,indent=2)+'\n')
print(json.dumps(receipt))
