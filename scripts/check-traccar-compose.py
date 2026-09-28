#!/usr/bin/env python3
"""Validate the actual Compose files in disposable directories; never reads or modifies a deployed .env."""
import json,os,shutil,subprocess,tempfile
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
files=json.loads((ROOT/'docs/deployment/traccar-inventory.json').read_text())['apiComposeFiles']
with tempfile.TemporaryDirectory(prefix='connect-compose-') as tmp:
 root=Path(tmp)/'source';shutil.copytree(ROOT,root,ignore=shutil.ignore_patterns('.git','node_modules','dist','volumes','__pycache__'))
 for name in files:
  file=root/name;directory=file.parent
  template=next((p for p in [directory/'env.example',directory/'.env.example',root/'.env.example'] if p.exists()),None)
  if not template:raise RuntimeError('Environment template missing: '+name)
  text=template.read_text();(directory/'.env').write_text(text)
  helper=root/'scripts/prepare-traccar-env.py' if directory==root else directory/'prepare-traccar-env.py'
  for mode in ['disabled','internal','external']:
   import re
   envtext=re.sub(r'^TRACCAR_ENABLED=.*$', 'TRACCAR_ENABLED='+('false' if mode=='disabled' else 'true'),text,flags=re.M)
   envtext=re.sub(r'^TRACCAR_MODE=.*$','TRACCAR_MODE='+mode,envtext,flags=re.M)
   (directory/'.env').write_text(envtext)
   subprocess.run(['python3',str(helper),'--env-file',str(directory/'.env')],check=True,stdout=subprocess.DEVNULL)
   env=os.environ.copy();env.pop('COMPOSE_PROFILES',None)
   command=['docker','compose','--env-file','.env','-f',file.name,'config','--quiet']
   subprocess.run(command,cwd=directory,env=env,check=True,stdout=subprocess.DEVNULL)
   print(name+': '+mode+' valid')
