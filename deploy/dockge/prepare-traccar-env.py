#!/usr/bin/env python3
"""Prepare optional Traccar settings without rotating credentials or changing other channels."""
import argparse, os, re, secrets, stat, tempfile
from pathlib import Path

DEFAULTS = {
 'TRACCAR_ENABLED':'false','TRACCAR_MODE':'disabled','TRACCAR_URL':'','TRACCAR_RECEIVER_URL':'','TRACCAR_ALLOWED_ORIGINS':'',
 'TRACCAR_INTERNAL_URL':'http://traccar:8082','TRACCAR_INTERNAL_RECEIVER_URL':'http://traccar:5055',
 'TRACCAR_TOKEN':'','TRACCAR_ADMIN_EMAIL':'connect-admin@localhost.invalid','TRACCAR_ADMIN_PASSWORD':'',
 'TRACCAR_DATABASE_PASSWORD':'','TRACCAR_REPLICAS':'0',
 'ARGWS_CONNECT_TRACCAR_IMAGE':'ghcr.io/wkarts/argws-connect-traccar:6.15.3-alpine',
 'ARGWS_CONNECT_TRACCAR_DATA_PATH':'./volumes/traccar','ARGWS_CONNECT_TRACCAR_DB_PATH':'./volumes/traccar-postgres',
 'FINDHUB_HISTORY_RETENTION_DAYS':'30','FINDHUB_MAP_TILE_URL':'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
}
LINE = re.compile(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$')
def parse(text):
 result={}
 for line in text.splitlines():
  m=LINE.match(line)
  if not m: continue
  key,value=m.groups()
  if key in DEFAULTS and key in result: raise ValueError('Parametro Traccar duplicado: '+key)
  value=re.split(r'\s+#',value,maxsplit=1)[0].strip()
  if len(value)>=2 and value[0] in "\"'" and value[-1]==value[0]: value=value[1:-1]
  result[key]=value
 return result

def set_value(text,key,value):
 lines=text.splitlines(keepends=True)
 for index,line in enumerate(lines):
  m=LINE.match(line.rstrip('\r\n'))
  if m and m.group(1)==key:
   if parse(line).get(key)==value:return text
   lines[index]=key+'='+value+('\r\n' if line.endswith('\r\n') else '\n');return ''.join(lines)
 return text+('' if not text or text.endswith('\n') else '\n')+key+'='+value+'\n'

def validate(env):
 if env.get('TRACCAR_ENABLED','false')=='false':return
 if env.get('TRACCAR_ENABLED')!='true' or env.get('TRACCAR_MODE') not in ('internal','external'):raise ValueError('Selecione o modo Traccar internal/external ao habilitar.')
 if env['TRACCAR_MODE']=='internal':
  for name in ('TRACCAR_ADMIN_PASSWORD','TRACCAR_DATABASE_PASSWORD'):
   if not re.fullmatch(r'[A-Za-z0-9_-]{32,256}',env.get(name,'')):raise ValueError('Segredo Traccar ausente ou invalido: '+name)

def prepare(text):
 env=parse(text);result=text
 for key,value in DEFAULTS.items():
  if key not in env:result=set_value(result,key,value)
 env=parse(result)
 if env.get('TRACCAR_ENABLED')=='true' and env.get('TRACCAR_MODE')=='internal':
  for key in ('TRACCAR_ADMIN_PASSWORD','TRACCAR_DATABASE_PASSWORD'):
   if not env.get(key):result=set_value(result,key,secrets.token_urlsafe(36))
 env=parse(result);validate(env)
 profiles=[x.strip() for x in env.get('COMPOSE_PROFILES','').split(',') if x.strip() and x.strip()!='traccar']
 enabled=env.get('TRACCAR_ENABLED')=='true' and env.get('TRACCAR_MODE')=='internal'
 if enabled:profiles.append('traccar')
 result=set_value(result,'COMPOSE_PROFILES',','.join(dict.fromkeys(profiles)))
 return set_value(result,'TRACCAR_REPLICAS','1' if enabled else '0')

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--env-file',default='.env');p.add_argument('--check',action='store_true');p.add_argument('--enable',action='store_true',help='Compatibilidade com prepare-env; modo permanece explicito.')
 a=p.parse_args();path=Path(a.env_file).resolve()
 if Path(a.env_file).is_symlink():raise ValueError('O ambiente nao pode ser um link simbolico.')
 with path.open(encoding='utf-8',newline='') as stream:text=stream.read()
 if a.check:validate(parse(text));print('Traccar validado; segredos ocultos.');return
 changed=prepare(text)
 if changed==text:print('Traccar preservado; nenhuma rotacao de segredo.');return
 lock=path.with_name(path.name+'.traccar.lock');fd=os.open(lock,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600);os.close(fd)
 try:
  # Detect a simultaneous edit instead of overwriting it.
  with path.open(encoding='utf-8',newline='') as stream:
   if stream.read()!=text:raise ValueError('Ambiente alterado por outro processo; tente novamente.')
  fd,temp=tempfile.mkstemp(prefix='.traccar-env-',dir=path.parent)
  try:
   os.fchmod(fd,stat.S_IRUSR|stat.S_IWUSR)
   with os.fdopen(fd,'w',encoding='utf-8',newline='') as out:out.write(changed);out.flush();os.fsync(out.fileno())
   os.replace(temp,path)
  finally:
   if os.path.exists(temp):os.unlink(temp)
 finally:lock.unlink()
 print('Traccar preparado; segredos ocultos. Nao remova volumes em atualizacoes.')
if __name__=='__main__':
 try:main()
 except Exception as e:raise SystemExit(str(e))
