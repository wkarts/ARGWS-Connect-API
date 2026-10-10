#!/usr/bin/env python3
"""Promote only the developed optional native speech subsystem without merging develop."""
from pathlib import Path
import sys, re, shutil, json, hashlib, subprocess, yaml
ROOT,DEV = map(lambda s: Path(s).resolve(),sys.argv[1:3])
COPY = """
Dockerfile
prisma/mysql-schema.prisma
prisma/postgresql-schema.prisma
prisma/psql_bouncer-schema.prisma
prisma/mysql-migrations/20261007193000_speech_durable_pool/migration.sql
prisma/postgresql-migrations/20261007193000_speech_durable_pool/migration.sql
scripts/speech-models.json
scripts/speech-model-provision.cjs
scripts/sync-fersoft-deployments.py
scripts/sync-operations-deployments.py
src/main.ts
src/api/routes/index.router.ts
src/api/routes/speech.router.ts
src/api/routes/transcription.router.ts
src/api/routes/speech-upload.middleware.ts
src/api/services/transcription.service.ts
src/api/services/speech-durable.service.ts
src/api/services/speech-policy.ts
src/api/services/speech-source-storage.ts
src/api/services/speech-model-download.service.ts
docs/scripts/generate-openapi.mjs
docs/scripts/speech-schemas.mjs
docs/guides/speech.md
docs/guides/optional-transcription-service.md
deploy/README.md
deploy/fersoft/README.md
.github/actions/speech-native-smoke/action.yml
.github/scripts/preserve-speech-evidence.cjs
.github/workflows/speech-integrity.yml
.github/workflows/transcription-service.yml
.github/workflows/ghcr-publish-application.yml
.github/workflows/image-promotion-integrity.yml
.github/workflows/operations-integrity.yml
.github/workflows/deployment-integrity.yml
test/speech-service-deployment.test.py
test/speech-model-download.test.ts
test/transcription-service.test.ts
test/release-version.test.cjs
test/compose-env-only-deployments.test.py
test/deploy-operations.test.py
tools/connect-deployer/index.cjs
tools/connect-deployer/native/src/lib.rs
tools/connect-deployer/test/index.test.cjs
manager/src/components/DictationButton.vue
manager/src/services/connect.ts
manager/src/services/current.ts
manager/src/services/http.ts
manager/src/services/service.ts
manager/src/services/retry-after.ts
manager/src/services/speech-status.ts
manager/src/types/domain.ts
manager/src/views/SettingsView.vue
manager/src/views/TranscriptionsView.vue
manager/scripts/speech-status.test.mjs
test/speech-ci-evidence.test.cjs
test/speech-durable.integration.test.ts
test/speech-source-storage.test.ts
test/speech-storage.integration.test.ts
test/helpers/speech-fixture.ts
""".split()
def copy(name):
    source=DEV/name;target=ROOT/name
    if not source.is_file():raise RuntimeError('Missing reviewed develop source: '+name)
    target.parent.mkdir(parents=True,exist_ok=True)
    shutil.copyfile(source,target)
for name in COPY:copy(name)
for folder in ('transcription-service','deploy/speech'):
    target=ROOT/folder
    if target.exists():shutil.rmtree(target)
    shutil.copytree(DEV/folder,target)
shutil.rmtree(ROOT/'transcription-worker')
release=ROOT/'.github/workflows/auto-version-release.yml'
text=release.read_text()
assert text.count('component: [api, manager, docs, transcription-worker]')==1
assert '.github/RELEASE_HOLD.md' in text and 'needs.validate.outputs.publish' in text
text=text.replace('argws-connect-transcription-worker','connect-transcription-service')
text=text.replace('transcription-worker','transcription-service')
dev_release=(DEV/'.github/workflows/auto-version-release.yml').read_text()
start=dev_release.index('      - name: Validate native speech before publishing a channel tag')
end=dev_release.index('      - name: Export digest',start)
assert text.count('      - name: Export digest')==1
text=text.replace('      - name: Export digest',dev_release[start:end]+'      - name: Export digest',1)
assert 'transcription-worker' not in text and 'needs.validate.outputs.publish' in text
release.write_text(text)
key=lambda x:x.startswith(('SPEECH_','TRANSCRIPTION_','DICTATION_')) or x=='MANAGER_FEATURE_TRANSCRIPTION'
service_rx=re.compile(r'^  ([\w.-]+):[ \t]*$',re.M)
def sections(text):
    at=text.index('services:\n')+len('services:\n')
    e=re.search(r'^([\w.-]+):\s*$',text[at:],re.M)
    limit=at+e.start() if e else len(text)
    matches=list(service_rx.finditer(text,at,limit))
    return {m.group(1):(m.start(),matches[i+1].start() if i+1<len(matches) else limit) for i,m in enumerate(matches)}
def set_api(main,up):
    def env(segment):
        m=re.search(r'(?m)^    environment:\n',segment)
        if not m:raise RuntimeError('API service missing environment')
        n=re.search(r'(?m)^    [\w.-]+:',segment[m.end():])
        end=m.end()+(n.start() if n else len(segment)-m.end())
        return m.end(),end
    start,end=env(main);ds,de=env(up)
    lines=up[ds:de].splitlines(True)
    wanted=[l for l in lines if re.match(r'^      ([A-Z0-9_]+):',l) and key(l.strip().split(':',1)[0])]
    keep=[l for l in main[start:end].splitlines(True) if not (re.match(r'^      ([A-Z0-9_]+):',l) and key(l.strip().split(':',1)[0]))]
    assert wanted
    return main[:start]+''.join(wanted+keep)+main[end:]
composes=['docker-compose.yaml','docker-compose.dev.yaml','deploy/production/compose.yaml',
'deploy/develop/compose.yaml','deploy/canonical/compose.yaml','deploy/dockge/compose.yaml',
'deploy/cloudpanel/docker-compose.yml','deploy/homologation/compose.yaml']
for name in composes:
    path=ROOT/name;original=path.read_text();dev=(DEV/name).read_text()
    old_sections=sections(original);dev_sections=sections(dev)
    old=[k for k in old_sections if k.startswith(('transcription-worker','speech-dictation-worker'))]
    new=[k for k in dev_sections if k.startswith('transcription-service')]
    assert old and len(new)==1,(name,old,new)
    first=min(old_sections[k][0] for k in old)
    anchor=next((k for k,(a,b) in old_sections.items() if a>first and k not in old),None)
    replacement=dev[slice(*dev_sections[new[0]])].rstrip()+'\n'
    for low,high in sorted((old_sections[k] for k in old),reverse=True):
        original=original[:low]+original[high:]
    after=sections(original)
    at=after[anchor][0] if anchor in after else original.index('services:\n')+len('services:\n')
    original=original[:at]+replacement+original[at:]
    after=sections(original)
    api=[k for k in dev_sections if k=='api' or k.startswith('api-')]
    assert len(api)==1 and api[0] in after,name
    lo,hi=after[api[0]]
    original=original[:lo]+set_api(original[lo:hi],dev[slice(*dev_sections[api[0]])])+original[hi:]
    assert 'transcription-worker' not in original and 'speech-dictation-worker' not in original
    path.write_text(original)
envs=['env.example','.env.example','deploy/develop/env.example','deploy/production/env.example',
'deploy/canonical/env.example','deploy/homologation/env.example',
'deploy/dockge/.env.example','deploy/dockge/env.example',
'deploy/cloudpanel/.env.example','deploy/cloudpanel/env.example']
def values(s):
    return {m.group(1):m.group(2) for m in re.finditer(r'^([A-Z][A-Z0-9_]+)=(.*)$',s,re.M)}
for name in envs:
    target=ROOT/name
    original=target.read_text();wanted=values((DEV/name).read_text())
    found=set();result=[]
    for line in original.splitlines(True):
        m=re.match(r'^([A-Z][A-Z0-9_]+)=(.*)$',line)
        if not m:result.append(line);continue
        k=m.group(1)
        if k=='ARGWS_CONNECT_TRANSCRIPTION_WORKER_IMAGE':continue
        if k=='COMPOSE_PROFILES':
            result.append(k+'='+','.join(x for x in m.group(2).split(',') if x!='transcription')+'\n')
        elif key(k):
            if k in wanted:
                result.append(k+'='+wanted[k]+'\n')
                found.add(k)
        else:result.append(line)
    missing=sorted(k for k in wanted if key(k) and k not in found)
    result=''.join(result)
    marker='\n# ------------------------------------------------------------\n# TRANSCRIPTION'
    pos=result.find(marker)
    if pos<0:pos=len(result)
    result=result[:pos]+'\n'+''.join(k+'='+wanted[k]+'\n' for k in missing)+result[pos:]
    result=result.replace('TRANSCRIPTION WORKER (opcional)','TRANSCRIPTION SERVICE (opcional)')
    keys=re.findall(r'^([A-Z][A-Z0-9_]+)=',result,re.M)
    assert len(keys)==len(set(keys)),name
    target.write_text(result)
subprocess.run(['python3','scripts/sync-fersoft-deployments.py'],cwd=ROOT,check=True)
# Protect all non-speech deployment services and their full configuration.
protected={}
all_compose=composes+['deploy/fersoft/production/compose.yaml','deploy/fersoft/develop/compose.yaml','deploy/speech/host-budget.compose.yaml']
for name in all_compose:
    cfg=yaml.safe_load((ROOT/name).read_text()) or {}
    bare={k:v for k,v in cfg.items() if k!='services'}
    bare['services']={k:v for k,v in cfg.get('services',{}).items() if not k.startswith('transcription-service')}
    for v in bare['services'].values():
        if isinstance(v.get('environment'),dict):
            v['environment']={k:item for k,item in v['environment'].items() if not k.startswith(('SPEECH_','TRANSCRIPTION_','DICTATION_','MANAGER_FEATURE_TRANSCRIPTION'))}
    protected[name]=hashlib.sha256(json.dumps(bare,sort_keys=True,ensure_ascii=True).encode()).hexdigest()
(ROOT/'test/fixtures/speech-protected-deployments.json').write_text(json.dumps(protected,indent=2,ensure_ascii=False)+'\n')
for name in all_compose:
    data=yaml.safe_load((ROOT/name).read_text()) or {}
    if name=='deploy/speech/host-budget.compose.yaml':continue
    speech=[k for k in data['services'] if k.startswith('transcription-service')]
    assert len(speech)==1 and data['services'][speech[0]]['scale']==1,name
    assert not any(k.startswith(('transcription-worker','speech-dictation-worker')) for k in data['services'])
    assert data['services'][speech[0]]['profiles']==['transcription']
for name in envs:
    v=values((ROOT/name).read_text())
    assert all(v[k]=='false' for k in ('SPEECH_ENABLED','TRANSCRIPTION_ENABLED','DICTATION_ENABLED','MANAGER_FEATURE_TRANSCRIPTION')),name
    assert 'transcription' not in v.get('COMPOSE_PROFILES','').split(',')
assert (ROOT/'.github/RELEASE_HOLD.md').is_file()
assert 'release-publication-policy.py' in (ROOT/'.github/workflows/auto-version-release.yml').read_text()
print('Speech promotion prepared; all 10 Compose and environment contracts retain opt-in.')
