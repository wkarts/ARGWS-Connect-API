#!/usr/bin/env python3
"""Materialize optional Traccar services in existing API stacks; never reads a real .env."""
import argparse, importlib.util, json, re
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
def module(file):
 spec=importlib.util.spec_from_file_location(file.stem.replace('-','_'),file);m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);return m

def bootstrap_program(root):
 """Return the tested bootstrap source embedded in Compose, without a host bind mount."""
 source=(root/'scripts/traccar-bootstrap.cjs').read_text(encoding='utf-8')
 return source.removeprefix('#!/usr/bin/env node\n').rstrip()

def traccar_postgres_command():
 """Start a legacy Traccar cluster and reconcile its missing database identity.

 Empty volumes keep the upstream PostgreSQL initialization path. Existing volumes
 are never initialized again. If their original bootstrap role is neither
 ``postgres`` nor ``traccar``, PostgreSQL single-user recovery creates only the
 missing Traccar role, briefly elevates it to create/own its database, then
 removes those recovery privileges before the service becomes healthy.
 """
 return '''set -Eeuo pipefail
: "$${TRACCAR_DATABASE_PASSWORD:?TRACCAR_DATABASE_PASSWORD nao configurada}"
data_directory="$${PGDATA:-/var/lib/postgresql/data}"
postgres_pid=''
recovery_role_pending=false

# Empty volume: retain the upstream PostgreSQL initialization behavior.
if [ ! -s "$$data_directory/PG_VERSION" ]; then
  exec /usr/local/bin/docker-entrypoint.sh postgres
fi

# Existing volume: preserve data and reconcile only the missing Traccar identity.
if ! command -v gosu >/dev/null 2>&1; then
  echo 'gosu nao esta disponivel na imagem PostgreSQL do Traccar.' >&2
  exit 30
fi

start_postgres() {
  /usr/local/bin/docker-entrypoint.sh postgres &
  postgres_pid="$$!"
}

shutdown_postgres() {
  if [ -n "$${postgres_pid:-}" ] && kill -0 "$$postgres_pid" 2>/dev/null; then
    kill -TERM "$$postgres_pid" 2>/dev/null || true
  fi
  if [ -n "$${postgres_pid:-}" ]; then
    wait "$$postgres_pid" || true
  fi
  postgres_pid=''
}

demote_recovery_role() {
  [ "$$recovery_role_pending" = true ] || return 0
  if PGPASSWORD="$$TRACCAR_DATABASE_PASSWORD" psql --no-password -v ON_ERROR_STOP=1 -h 127.0.0.1 -U traccar -d template1 -c 'ALTER ROLE traccar NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS' >/dev/null; then
    recovery_role_pending=false
    return 0
  fi
  return 1
}

cleanup_recovery_role() {
  [ "$$recovery_role_pending" = true ] || return 0
  if demote_recovery_role; then
    return 0
  fi
  shutdown_postgres
  if printf '%s\\n' 'ALTER ROLE traccar NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS;' | gosu postgres postgres --single -D "$$data_directory" template1 >/dev/null; then
    recovery_role_pending=false
    return 0
  fi
  return 1
}

abort_recovery() {
  code="$$1"
  message="$$2"
  echo "$$message" >&2
  if ! cleanup_recovery_role; then
    echo 'Nao foi possivel remover os privilegios temporarios de recuperacao do Traccar.' >&2
  fi
  shutdown_postgres
  exit "$$code"
}

on_signal() {
  cleanup_recovery_role || true
  shutdown_postgres
  exit 0
}
trap on_signal INT TERM

wait_for_server() {
  for attempt in $$(seq 1 60); do
    if [ -S /var/run/postgresql/.s.PGSQL.5432 ]; then
      return 0
    fi
    if ! kill -0 "$$postgres_pid" 2>/dev/null; then
      wait "$$postgres_pid" || true
      return 1
    fi
    sleep 1
  done
  return 1
}

start_postgres
if ! wait_for_server; then
  shutdown_postgres
  echo 'PostgreSQL do Traccar nao ficou disponivel.' >&2
  exit 31
fi

# Standard clusters retain the upstream postgres superuser. Prefer that route.
admin_ready=false
admin_probe=''
for attempt in $$(seq 1 60); do
  if admin_probe="$$(gosu postgres psql --no-password -h /var/run/postgresql -U postgres -d postgres -tAc 'SELECT 1' 2>&1)"; then
    admin_ready=true
    break
  fi
  if printf '%s' "$$admin_probe" | grep -Fq 'role "postgres" does not exist'; then
    break
  fi
  if ! kill -0 "$$postgres_pid" 2>/dev/null; then
    shutdown_postgres
    exit 31
  fi
  sleep 1
done

if [ "$$admin_ready" = true ]; then
  role_exists="$$(gosu postgres psql --no-password -h /var/run/postgresql -U postgres -d postgres -tAc "SELECT 1 FROM pg_roles WHERE rolname = 'traccar'")"
  role_created=false
  if [ "$$role_exists" != 1 ]; then
    gosu postgres psql --no-password -v ON_ERROR_STOP=1 -v traccar_password="$$TRACCAR_DATABASE_PASSWORD" -h /var/run/postgresql -U postgres -d postgres -c "CREATE ROLE traccar LOGIN PASSWORD :'traccar_password'"
    role_created=true
  fi

  database_exists="$$(gosu postgres psql --no-password -h /var/run/postgresql -U postgres -d postgres -tAc "SELECT 1 FROM pg_database WHERE datname = 'traccar'")"
  if [ "$$database_exists" != 1 ]; then
    gosu postgres psql --no-password -v ON_ERROR_STOP=1 -h /var/run/postgresql -U postgres -d postgres -c 'CREATE DATABASE traccar OWNER traccar'
  elif [ "$$role_created" = true ]; then
    gosu postgres psql --no-password -v ON_ERROR_STOP=1 -h /var/run/postgresql -U postgres -d postgres -c 'ALTER DATABASE traccar OWNER TO traccar'
  fi
else
  # A legacy cluster can have a custom initial superuser. Do not mutate an
  # existing Traccar role or password. Recover only when PostgreSQL proves that
  # both standard identities are absent, as in a never-finished first startup.
  target_probe=''
  if target_probe="$$(PGPASSWORD="$$TRACCAR_DATABASE_PASSWORD" psql --no-password -h 127.0.0.1 -U traccar -d traccar -tAc 'SELECT 1' 2>&1)" && [ "$$target_probe" = 1 ]; then
    wait "$$postgres_pid"
    exit $$?
  fi

  if ! printf '%s' "$$admin_probe" | grep -Fq 'role "postgres" does not exist' || ! printf '%s' "$$target_probe" | grep -Fq 'role "traccar" does not exist'; then
    echo 'O volume do PostgreSQL do Traccar possui uma identidade existente que nao sera alterada automaticamente.' >&2
    [ -z "$$admin_probe" ] || printf '%s\\n' "$$admin_probe" >&2
    [ -z "$$target_probe" ] || printf '%s\\n' "$$target_probe" >&2
    shutdown_postgres
    exit 32
  fi

  echo 'Recuperando somente a identidade ausente do PostgreSQL do Traccar.' >&2
  shutdown_postgres
  recovery_password="$$(printf '%s' "$$TRACCAR_DATABASE_PASSWORD" | sed "s/'/''/g")"
  if ! printf "CREATE ROLE traccar LOGIN SUPERUSER CREATEDB CREATEROLE PASSWORD '%s';\\n" "$$recovery_password" | gosu postgres postgres --single -D "$$data_directory" template1 >/dev/null; then
    echo 'Falha ao criar a identidade ausente do Traccar pelo modo de recuperacao do PostgreSQL.' >&2
    exit 33
  fi
  recovery_role_pending=true

  start_postgres
  if ! wait_for_server; then
    abort_recovery 33 'PostgreSQL do Traccar nao reiniciou apos a recuperacao da identidade.'
  fi
  recovery_ready=false
  for attempt in $$(seq 1 60); do
    if PGPASSWORD="$$TRACCAR_DATABASE_PASSWORD" psql --no-password -h 127.0.0.1 -U traccar -d template1 -tAc 'SELECT 1' | grep -qx 1; then
      recovery_ready=true
      break
    fi
    if ! kill -0 "$$postgres_pid" 2>/dev/null; then
      break
    fi
    sleep 1
  done
  if [ "$$recovery_ready" != true ]; then
    abort_recovery 33 'A identidade recuperada do Traccar nao conseguiu acessar o PostgreSQL.'
  fi

  if ! database_exists="$$(PGPASSWORD="$$TRACCAR_DATABASE_PASSWORD" psql --no-password -h 127.0.0.1 -U traccar -d template1 -tAc "SELECT 1 FROM pg_database WHERE datname = 'traccar'")"; then
    abort_recovery 33 'Nao foi possivel verificar o banco dedicado do Traccar.'
  fi
  if [ "$$database_exists" != 1 ]; then
    if ! PGPASSWORD="$$TRACCAR_DATABASE_PASSWORD" psql --no-password -v ON_ERROR_STOP=1 -h 127.0.0.1 -U traccar -d template1 -c 'CREATE DATABASE traccar OWNER traccar'; then
      abort_recovery 33 'Nao foi possivel criar o banco dedicado do Traccar.'
    fi
  elif ! PGPASSWORD="$$TRACCAR_DATABASE_PASSWORD" psql --no-password -v ON_ERROR_STOP=1 -h 127.0.0.1 -U traccar -d template1 -c 'ALTER DATABASE traccar OWNER TO traccar'; then
    abort_recovery 33 'Nao foi possivel atribuir o banco dedicado ao Traccar.'
  fi
  if ! demote_recovery_role; then
    abort_recovery 33 'Nao foi possivel remover os privilegios temporarios de recuperacao do Traccar.'
  fi
fi

# Existing role passwords are intentionally never changed.
PGPASSWORD="$$TRACCAR_DATABASE_PASSWORD" psql --no-password -h 127.0.0.1 -U traccar -d traccar -tAc 'SELECT 1' | grep -qx 1
wait "$$postgres_pid"'''

def replace_service(text, base, name, transform):
 for service,start,end,block in base.service_blocks(text):
  if service == name:
   return text[:start] + transform(block).rstrip() + '\n' + text[end:]
 return text

def init_dependency(block, init):
 generated=f'      {init}:\n        condition: service_healthy\n'
 existing=re.search(r'^      '+re.escape(init)+r':\n(?:        [^\n]*\n)*', block, re.M)
 if existing:
  return block[:existing.start()]+generated+block[existing.end():]
 compact=re.search(r'^    depends_on:\s*\[([^\]]*)\]\s*$', block, re.M)
 if compact:
  names=[name.strip() for name in compact.group(1).split(',') if name.strip()]
  dependencies='    depends_on:\n'+''.join('      '+name+':\n        condition: service_started\n' for name in names)
  dependencies+=generated
  return block[:compact.start()] + dependencies + block[compact.end():]
 listed=re.search(r'^    depends_on:\n((?:      - [^\n]+\n)+)', block, re.M)
 if listed:
  names=[line.split('- ',1)[1].strip() for line in listed.group(1).splitlines() if '- ' in line]
  dependencies='    depends_on:\n'+''.join('      '+name+':\n        condition: service_started\n' for name in names)
  dependencies+=generated
  return block[:listed.start()] + dependencies + block[listed.end():]
 mapping=re.search(r'^    depends_on:\n', block, re.M)
 if mapping:
  return block[:mapping.end()] + generated + block[mapping.end():]
 first=block.index('\n')+1
 dependency='    depends_on:\n'+generated
 return block[:first] + dependency + block[first:]

def volume_init_service(name, network, named):
 container=f'    container_name: {name}\n' if named else ''
 return f'''  # BEGIN COMPOSE VOLUME INIT
  {name}:
{container}    profiles: ["kafka", "extended"]
    image: ghcr.io/wkarts/argws-connect-node:22-bookworm-slim
    pull_policy: always
    restart: unless-stopped
    user: "0:0"
    entrypoint: ["/bin/sh", "-ec"]
    command:
      - |
        prepare_directory() {{
          path="$$1"
          owner="$$2"
          label="$$3"
          mkdir -p "$$path"
          if [ -n "$$(ls -A "$$path")" ]; then
            actual="$$(stat -c '%u:%g' "$$path")"
            [ "$$actual" = "$$owner" ] || {{
              echo "$$label contem dados e pertence a $$actual; esperado $$owner. Nenhum dado foi alterado." >&2
              exit 23
            }}
            echo "$$label preservado"
            return
          fi
          chown --no-dereference "$$owner" "$$path"
          chmod u+rwx "$$path"
          echo "$$label preparado"
        }}
        prepare_directory /prepared/zookeeper-data 1000:1000 zookeeper-data
        prepare_directory /prepared/zookeeper-log 1000:1000 zookeeper-log
        prepare_directory /prepared/kafka 1000:1000 kafka
        touch /tmp/volume-init-ready
        exec tail -f /dev/null
    cap_drop: [ALL]
    cap_add: [CHOWN, FOWNER, DAC_OVERRIDE]
    security_opt: ["no-new-privileges:true"]
    read_only: true
    tmpfs: [/tmp]
    healthcheck:
      test: ["CMD-SHELL", "test -f /tmp/volume-init-ready"]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 5s
    volumes:
      - ${{ARGWS_CONNECT_ZOOKEEPER_DATA_PATH:-./volumes/zookeeper/data}}:/prepared/zookeeper-data
      - ${{ARGWS_CONNECT_ZOOKEEPER_LOG_PATH:-./volumes/zookeeper/log}}:/prepared/zookeeper-log
      - ${{ARGWS_CONNECT_KAFKA_DATA_PATH:-./volumes/kafka}}:/prepared/kafka
    networks: [{network}]
  # END COMPOSE VOLUME INIT
'''

def mysql_volume_init_service(name, network, named):
 container=f'    container_name: {name}\n' if named else ''
 return f'''  # BEGIN COMPOSE MYSQL VOLUME INIT
  {name}:
{container}    profiles: ["mysql"]
    image: ghcr.io/wkarts/argws-connect-node:22-bookworm-slim
    pull_policy: always
    restart: unless-stopped
    user: "0:0"
    entrypoint: ["/bin/sh", "-ec"]
    command:
      - |
        mkdir -p /prepared/mysql
        # Percona 8.0 runs as uid 1001. Ownership repair changes metadata only;
        # it never removes or initializes files in an existing data directory.
        chown --no-dereference --recursive 1001:0 /prepared/mysql
        chmod u+rwx /prepared/mysql
        touch /tmp/mysql-volume-init-ready
        exec tail -f /dev/null
    cap_drop: [ALL]
    cap_add: [CHOWN, FOWNER, DAC_OVERRIDE]
    security_opt: ["no-new-privileges:true"]
    read_only: true
    tmpfs: [/tmp]
    healthcheck:
      test: ["CMD-SHELL", "test -f /tmp/mysql-volume-init-ready"]
      interval: 5s
      timeout: 3s
      retries: 12
      start_period: 5s
    volumes:
      - ${{ARGWS_CONNECT_MYSQL_DATA_PATH:-./volumes/mysql}}:/prepared/mysql
    networks: [{network}]
  # END COMPOSE MYSQL VOLUME INIT
'''

def add_volume_init(text, base, network, suffix):
 zookeeper='zookeeper'+suffix
 kafka='kafka'+suffix
 names={name for name, *_ in base.service_blocks(text)}
 if not {zookeeper, kafka} <= names:
  return text
 text=re.sub(r'\n  # BEGIN COMPOSE VOLUME INIT\n.*?^  # END COMPOSE VOLUME INIT\n', '', text, flags=re.M|re.S)
 init='volume-init'+suffix
 text=replace_service(text, base, zookeeper, lambda block: init_dependency(block, init))
 text=replace_service(text, base, kafka, lambda block: init_dependency(block, init))
 header=re.search(r'^services:\s*\n',text,re.M)
 end_services=re.search(r'^[^\s#][^\n]*:',text[header.end():],re.M)
 offset=header.end()+end_services.start() if end_services else len(text)
 return text[:offset]+volume_init_service(init, network, bool(suffix))+'\n'+text[offset:]

def add_mysql_volume_init(text, base, network, suffix):
 mysql='mysql'+suffix
 names={name for name, *_ in base.service_blocks(text)}
 if mysql not in names:
  return text
 text=re.sub(r'\n  # BEGIN COMPOSE MYSQL VOLUME INIT\n.*?^  # END COMPOSE MYSQL VOLUME INIT\n', '', text, flags=re.M|re.S)
 init='mysql-volume-init'+suffix
 text=replace_service(text, base, mysql, lambda block: init_dependency(block, init))
 header=re.search(r'^services:\s*\n',text,re.M)
 end_services=re.search(r'^[^\s#][^\n]*:',text[header.end():],re.M)
 offset=header.end()+end_services.start() if end_services else len(text)
 return text[:offset]+mysql_volume_init_service(init, network, bool(suffix))+'\n'+text[offset:]

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
  # The Manager uses a server-side internal API facade. Remove the former
  # hostname handoff from generated contracts so no public Traccar domain is
  # required and stale generated Compose values cannot keep that mode alive.
  block=re.sub(r'^      TRACCAR_PUBLIC_URL:\s*.*\n', '', block, flags=re.M)
  block=re.sub(r'^      - TRACCAR_PUBLIC_URL=.*\n', '', block, flags=re.M)
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
  bootstrap_source='\n'.join(('          '+line) if line else '' for line in bootstrap_program(root).splitlines())
  postgres_command='\n'.join(('        '+line) if line else '' for line in traccar_postgres_command().splitlines())
  swarm='Docker/swarm/' in name
  optional='    deploy:\n      replicas: ${TRACCAR_REPLICAS:-0}\n' if swarm else '    profiles: [traccar]\n'
  restart='' if swarm else '    restart: unless-stopped\n'
  depends='' if swarm else f'    depends_on:\n      {db}:\n        condition: service_healthy\n'
  bootstrap_optional=optional+('      restart_policy:\n        condition: on-failure\n        max_attempts: 5\n' if swarm else '')
  bootstrap_depends='' if swarm else f'    depends_on:\n      {tracker}:\n        condition: service_healthy\n'
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
    healthcheck:
      test: ["CMD-SHELL", "wget -S --spider -T 5 http://127.0.0.1:8082/api/server 2>&1 | grep -Eq 'HTTP/[0-9.]+ (200|401)'"]
      interval: 15s
      timeout: 5s
      retries: 12
      start_period: 60s
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
      TRACCAR_DATABASE_PASSWORD: ${{TRACCAR_DATABASE_PASSWORD:-}}
    entrypoint: ["/bin/bash", "-ec"]
    command:
      - |
{postgres_command}
    volumes:
      - ${{ARGWS_CONNECT_TRACCAR_DB_PATH:-./volumes/traccar-postgres}}:/var/lib/postgresql/data
    networks: [{network}]
    healthcheck:
      test: ['CMD-SHELL', 'PGPASSWORD="$${{TRACCAR_DATABASE_PASSWORD}}" psql --no-password -h 127.0.0.1 -U traccar -d traccar -tAc "SELECT 1" | grep -qx 1']
      interval: 10s
      timeout: 5s
      retries: 15
      start_period: 75s
  {bootstrap}:
{bootstrap_optional}    image: ghcr.io/wkarts/argws-connect-node:22-bookworm-slim
    pull_policy: always
{restart}{bootstrap_depends}    entrypoint: ["/bin/sh", "-ec"]
    command:
      - |
        node - <<'NODE'
{bootstrap_source}
        NODE
        touch /tmp/traccar-bootstrap-ready
        exec tail -f /dev/null
    environment:
      TRACCAR_INTERNAL_URL: http://traccar:8082
      TRACCAR_ADMIN_EMAIL: ${{TRACCAR_ADMIN_EMAIL:-connect-admin@localhost.invalid}}
      TRACCAR_ADMIN_PASSWORD: ${{TRACCAR_ADMIN_PASSWORD:-}}
    read_only: true
    cap_drop: [ALL]
    security_opt: ["no-new-privileges:true"]
    tmpfs: [/tmp]
    healthcheck:
      test: ["CMD-SHELL", "test -f /tmp/traccar-bootstrap-ready"]
      interval: 10s
      timeout: 3s
      retries: 12
      start_period: 5s
    networks: [{network}]
    logging:
      driver: json-file
      options:
        max-size: ${{DOCKER_LOG_MAX_SIZE:-20m}}
        max-file: "${{DOCKER_LOG_MAX_FILE:-5}}"
  # END OPTIONAL TRACCAR
'''
  # Preserve the explicit container-name convention of the existing named API stacks.
  if suffix and not swarm:
   for service_name in (tracker,db,bootstrap):
    service=re.sub(rf'^  {re.escape(service_name)}:\n',f'  {service_name}:\n    container_name: {service_name}\n',service,count=1,flags=re.M)
  header=re.search(r'^services:\s*\n',text,re.M)
  end_services=re.search(r'^[^\s#][^\n]*:',text[header.end():],re.M)
  offset=header.end()+end_services.start() if end_services else len(text)
  text=text[:offset]+service+'\n'+text[offset:]
  if not swarm:
   text=add_volume_init(text,base,network,suffix)
   text=add_mysql_volume_init(text,base,network,suffix)
  # Each Compose embeds the bootstrap program so the runtime requires only the
  # Compose file, its .env, and data volumes.
  directory=Path(name).parent
  outputs[name]=text;profiles.append(name)
  for file in (directory/'env.example', directory/'.env.example'):
   if not (root/file).exists():continue
   source=read(file)
   source=re.sub(r'^TRACCAR_PUBLIC_URL=.*(?:\r?\n|$)', '', source, flags=re.M)
   for key,value in env.DEFAULTS.items():
    if re.search(r'^'+key+r'=',source,re.M):continue
    line=key+'='+value+'\n'
    source+=('' if source.endswith('\n') else '\n')+line
   outputs[file.as_posix()]=source
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
