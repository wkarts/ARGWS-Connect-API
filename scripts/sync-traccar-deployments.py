#!/usr/bin/env python3
"""Materialize optional Traccar services in existing API stacks; never reads a real .env."""
import argparse, importlib.util, json, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def module(file):
 spec=importlib.util.spec_from_file_location(file.stem.replace('-','_'),file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def generate(root, overrides=None):
 overrides = overrides or {}
 read = lambda path: overrides.get(str(path), (root/path).read_text() if (root/path).exists() else "")
 base=module(root/'scripts/sync-findhub-deployments.py');env=module(root/'scripts/prepare-traccar-env.py')
 outputs={};profiles=[];excluded=[]
 runtime_keys=['TRACCAR_ENABLED','TRACCAR_MODE','TRACCAR_URL','TRACCAR_RECEIVER_URL','TRACCAR_TOKEN','TRACCAR_ALLOWED_ORIGINS','TRACCAR_INTERNAL_URL','TRACCAR_INTERNAL_RECEIVER_URL','TRACCAR_ADMIN_EMAIL','TRACCAR_ADMIN_PASSWORD','FINDHUB_HISTORY_RETENTION_DAYS','FINDHUB_MAP_TILE_URL']
 for name in base.repository_files(root):
  if not name.endswith(('.yaml','.yml')):continue
  text=read(name);blocks=[b for b in base.service_blocks(text) if base.api_service(b[0],b[3])]
  if not blocks:continue
  api,start,end,block=blocks[0]
  network_match=re.search(r'^networks:\n  ([\w.-]+):',text,re.M)
  if not network_match:excluded.append(name);continue
  network=network_match.group(1)
  list_environment=bool(re.search(r'^    environment:\n      - ',block,re.M))
  additions=[]
  for key in runtime_keys:
   if re.search(r'\b'+key+r'[:=]',block):continue
   default='' if key == 'FINDHUB_MAP_TILE_URL' else env.DEFAULTS[key]
   additions.append(('      - '+key+'=${'+key+':-'+default+'}' if list_environment else '      '+key+': "${'+key+':-'+default+'}"')+'\n')
  block=block.replace('    environment:\n','    environment:\n'+''.join(additions),1)
  text=text[:start]+block+text[end:]
  # Remove only our generated block on subsequent runs, preserving all unrelated services.
  text=re.sub(r'\n  # BEGIN OPTIONAL TRACCAR\n.*?^  # END OPTIONAL TRACCAR\n', '', text, flags=re.M|re.S)
  suffix=api[3:] if api.startswith('api-') else ''
  tracker='traccar'+suffix;db='traccar-postgres'+suffix;bootstrap='traccar-bootstrap'+suffix
  swarm='Docker/swarm/' in name
  optional='    deploy:\n      replicas: ${TRACCAR_REPLICAS:-0}\n' if swarm else '    profiles: [traccar]\n'
  restart='' if swarm else '    restart: unless-stopped\n'
  depends='' if swarm else f'    depends_on:\n      {db}:\n        condition: service_healthy\n'
  bootstrap_optional=optional+('      restart_policy:\n        condition: on-failure\n        max_attempts: 5\n' if swarm else '')
  service=f'''  # BEGIN OPTIONAL TRACCAR
  {tracker}:
{optional}    image: ${{ARGWS_CONNECT_TRACCAR_IMAGE:-ghcr.io/wkarts/argws-connect-traccar:6.15.3-alpine}}
{restart}{depends}    environment:
      CONFIG_USE_ENVIRONMENT_VARIABLES: "true"
      DATABASE_DRIVER: org.postgresql.Driver
      DATABASE_URL: jdbc:postgresql://{db}:5432/traccar
      DATABASE_USER: traccar
      DATABASE_PASSWORD: ${{TRACCAR_DATABASE_PASSWORD:-}}
      WEB_PORT: "8082"
      OSMAND_PORT: "5055"
      OSMAND_ADDRESS: 0.0.0.0
      PROTOCOLS_ENABLE: osmand
      SERVER_STATISTICS: ""
      GEOCODER_ENABLE: "false"
      TZ: ${{TZ:-America/Bahia}}
    expose: ["8082", "5055"]
    volumes:
      - ${{ARGWS_CONNECT_TRACCAR_DATA_PATH:-./volumes/traccar}}:/opt/traccar/data
    networks:
      {network}:
        aliases: [traccar]
    logging:
      driver: json-file
      options:
        max-size: ${{DOCKER_LOG_MAX_SIZE:-20m}}
        max-file: "${{DOCKER_LOG_MAX_FILE:-5}}"
  {db}:
{optional}    image: ${{ARGWS_CONNECT_POSTGRES_IMAGE:-ghcr.io/wkarts/argws-connect-postgres:15}}
{restart}    environment:
      POSTGRES_DB: traccar
      POSTGRES_USER: traccar
      POSTGRES_PASSWORD: ${{TRACCAR_DATABASE_PASSWORD:-}}
    volumes:
      - ${{ARGWS_CONNECT_TRACCAR_DB_PATH:-./volumes/traccar-postgres}}:/var/lib/postgresql/data
    networks: [{network}]
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U traccar -d traccar"]
      interval: 10s
      timeout: 5s
      retries: 10
  {bootstrap}:
{bootstrap_optional}    image: ghcr.io/wkarts/argws-connect-node:22-bookworm-slim
    entrypoint: ["node", "/bootstrap/traccar-bootstrap.cjs"]
    environment:
      TRACCAR_INTERNAL_URL: http://traccar:8082
      TRACCAR_ADMIN_EMAIL: ${{TRACCAR_ADMIN_EMAIL:-connect-admin@localhost.invalid}}
      TRACCAR_ADMIN_PASSWORD: ${{TRACCAR_ADMIN_PASSWORD:-}}
    volumes:
      - ./traccar-bootstrap.cjs:/bootstrap/traccar-bootstrap.cjs:ro
    networks: [{network}]
  # END OPTIONAL TRACCAR
'''
  header=re.search(r'^services:\s*\n',text,re.M)
  end_services=re.search(r'^[^\s#][^\n]*:',text[header.end():],re.M)
  offset=header.end()+end_services.start() if end_services else len(text)
  text=text[:offset]+service+'\n'+text[offset:]
  # Relative helper accompanies each standalone stack, including root/Swarm examples.
  directory=Path(name).parent
  if directory==Path('.'):
   service_path='scripts/traccar-bootstrap.cjs';text=text.replace('./traccar-bootstrap.cjs:/bootstrap/', './scripts/traccar-bootstrap.cjs:/bootstrap/')
  else:outputs[(directory/'traccar-bootstrap.cjs').as_posix()]=(root/'scripts/traccar-bootstrap.cjs').read_text()
  outputs[name]=text;profiles.append(name)
  if directory != Path('.'):outputs[(directory/'prepare-traccar-env.py').as_posix()]=(root/'scripts/prepare-traccar-env.py').read_text()
  for file in (directory/'env.example', directory/'.env.example'):
   if not (root/file).exists():continue
   source=read(file)
   for key,value in env.DEFAULTS.items():
    if not re.search(r'^'+key+r'=',source,re.M):source+=('' if source.endswith('\n') else '\n')+key+'='+value+'\n'
   outputs[file.as_posix()]=source
  prep=directory/'prepare-env.sh'
  if (root/prep).exists():
   source=read(prep)
   if 'prepare-traccar-env.py' not in source:source+='python3 '+('./scripts/prepare-traccar-env.py' if directory==Path('.') else './prepare-traccar-env.py')+' --env-file .env "$@"\n'
   outputs[prep.as_posix()]=source
  op=directory/'prepare-operations-env.py'
  if (root/op).exists():outputs[op.as_posix()]=(root/'scripts/prepare-operations-env.py').read_text()
 outputs['docs/deployment/traccar-inventory.json']=json.dumps({'apiComposeFiles':profiles,'unsupportedComposeFiles':excluded,'defaults':env.DEFAULTS,'policy':'Optional profile, independent database, no published ports, no API dependency. Swarm uses replicas=0 by default.'},indent=2)+'\n'
 return outputs

def main():
 p=argparse.ArgumentParser(description=__doc__);p.add_argument('--check',action='store_true');p.add_argument('--root',type=Path,default=ROOT);a=p.parse_args();changed=[]
 for path,text in generate(a.root).items():
  file=a.root/path
  if not file.exists() or file.read_text()!=text:
   changed.append(path)
   if not a.check:file.parent.mkdir(parents=True,exist_ok=True);file.write_text(text)
 if a.check and changed:raise SystemExit('Traccar deployment drift: '+', '.join(changed))
 print('Traccar deployment contracts synchronized: '+str(len(changed)))
if __name__=='__main__':main()
