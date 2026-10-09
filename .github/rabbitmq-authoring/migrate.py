#!/usr/bin/env python3
"""Source-only healthcheck migration. Never executes Docker or changes live stacks."""
import copy
import hashlib
import json
import re
import subprocess
from pathlib import Path
import yaml

ROOT = Path.cwd()
PROBE = ['CMD', 'timeout', '${RABBITMQ_HEALTHCHECK_CONNECT_TIMEOUT:-2}',
         'bash', '-ec', 'exec 3<>/dev/tcp/127.0.0.1/5672']

def development(name):
    return 'develop' in name or 'homologation' in name or name == 'docker-compose.dev.yaml'

def settings(name):
    return {'test': PROBE, 'interval': '${RABBITMQ_HEALTHCHECK_INTERVAL:-' + ('30s' if development(name) else '60s') + '}',
            'timeout': '${RABBITMQ_HEALTHCHECK_TIMEOUT:-3s}',
            'retries': '${RABBITMQ_HEALTHCHECK_RETRIES:-' + ('10' if development(name) else '5') + '}',
            'start_period': '${RABBITMQ_HEALTHCHECK_START_PERIOD:-120s}'}

def speech_digest(cfg):
    cfg = copy.deepcopy(cfg)
    cfg['services'] = {k:v for k,v in cfg.get('services',{}).items() if not k.startswith('transcription-service')}
    for value in cfg['services'].values():
        if 'environment' in value:
            value['environment'] = {k:v for k,v in value['environment'].items() if not k.startswith(('SPEECH_', 'TRANSCRIPTION_', 'DICTATION_', 'MANAGER_FEATURE_TRANSCRIPTION'))}
    return hashlib.sha256(json.dumps(cfg, sort_keys=True, ensure_ascii=True).encode()).hexdigest()

names = subprocess.check_output(['git', 'ls-files', '-z']).decode().split('\0')
original = {}
changed = []
for name in names:
    if not name.endswith(('.yaml', '.yml')): continue
    text = Path(name).read_text()
    cfg = yaml.safe_load(text)
    if not isinstance(cfg, dict) or not isinstance(cfg.get('services'), dict): continue
    brokers = [k for k,v in cfg['services'].items() if isinstance(v,dict) and 'rabbitmq' in str(v.get('image','')).lower()]
    if not brokers: continue
    original[name] = copy.deepcopy(cfg)
    for key in brokers:
        header = re.search(r'(?m)^  '+re.escape(key)+r':\s*$', text)
        assert header, (name, key)
        following = re.search(r'(?m)^(?:  [\w-]+:|[^\s#])', text[header.end():])
        end = header.end() + following.start() if following else len(text)
        block = text[header.end():end]
        health = re.search(r'(?m)^    healthcheck:\n(?:[ \t]+[^\n]*\n|\n)*', block)
        # Stop at the next service-level field, retaining all unrelated text verbatim.
        start = health.start() if health else len(block)
        next_field = re.search(r'(?m)^    [^\s#]', block[start+len('    healthcheck:\n'):]) if health else None
        finish = start+len('    healthcheck:\n')+next_field.start() if next_field else len(block)
        previous = block[start:finish]
        trailing = '\n' if previous.endswith('\n\n') else ''
        hc = settings(name)
        if 'fersoft' in name:
            replacement = ''.join('    '+line+'\n' for line in yaml.safe_dump({'healthcheck':hc},sort_keys=False,width=120).splitlines())
        else:
            replacement = ('    healthcheck:\n      test: '+json.dumps(hc['test'])+'\n'+
                           ''.join(f'      {k}: {v}\n' for k,v in hc.items() if k!='test'))
        block = block[:start]+replacement+trailing+block[finish:]
        text = text[:header.end()]+block+text[end:]
    cfg2=yaml.safe_load(text)
    safe=copy.deepcopy(cfg2)
    for key in brokers:
        if 'healthcheck' in cfg['services'][key]:safe['services'][key]['healthcheck']=cfg['services'][key]['healthcheck']
        else:safe['services'][key].pop('healthcheck',None)
    assert safe==cfg, f'Non-health field changed in {name}'
    if text!=Path(name).read_text(): Path(name).write_text(text);changed.append(name)

assert len(original)>=10, list(original)
for name in names:
    p=Path(name)
    if not (p.name in ('.env.example','env.example') or p.name.endswith('.env.example')):continue
    text=p.read_text()
    if 'RABBITMQ_URI=' not in text and 'ARGWS_CONNECT_RABBITMQ_IMAGE=' not in text:continue
    values={'RABBITMQ_HEALTHCHECK_CONNECT_TIMEOUT':'2', 'RABBITMQ_HEALTHCHECK_INTERVAL':'30s' if development(name) else '60s',
            'RABBITMQ_HEALTHCHECK_TIMEOUT':'3s', 'RABBITMQ_HEALTHCHECK_RETRIES':'10' if development(name) else '5',
            'RABBITMQ_HEALTHCHECK_START_PERIOD':'120s'}
    missing=[]
    for k,v in values.items():
        if re.search(r'(?m)^'+k+r'=',text): text=re.sub(r'(?m)^'+k+r'=[^\n]*',k+'='+v,text)
        else:missing.append(k+'='+v)
    if missing:text=text.rstrip()+'\n\n# RabbitMQ readiness: local TCP; verify bash and timeout in the actual image before deploying.\n'+'\n'.join(missing)+'\n'
    if text!=p.read_text():p.write_text(text);changed.append(name)

generator=ROOT/'scripts/sync-fersoft-deployments.py'
if generator.exists(): subprocess.run(['python3',str(generator)],check=True)
for name,before in original.items():
    after=yaml.safe_load(Path(name).read_text())
    for key,v in before['services'].items():
        if isinstance(v,dict) and 'rabbitmq' in str(v.get('image','')).lower():
            if 'healthcheck' in v:after['services'][key]['healthcheck']=v['healthcheck']
            else:after['services'][key].pop('healthcheck',None)
    assert after==before, 'Generator changed non-health configuration: '+name

p=ROOT/'test/rabbitmq-startup-deployments.test.py'
if p.exists():
    text=p.read_text()
    a="self.assertEqual(health['interval'], '${RABBITMQ_HEALTHCHECK_INTERVAL:-30s}')"
    b="self.assertEqual(health['retries'], '${RABBITMQ_HEALTHCHECK_RETRIES:-10}')"
    assert a in text and b in text
    text=text.replace(a,"self.assertEqual(health['interval'], '${RABBITMQ_HEALTHCHECK_INTERVAL:-' + ('30s' if 'develop' in name or 'homologation' in name else '60s') + '}')")
    text=text.replace(b,"self.assertEqual(health['retries'], '${RABBITMQ_HEALTHCHECK_RETRIES:-' + ('10' if 'develop' in name or 'homologation' in name else '5') + '}')")
    p.write_text(text)
p=ROOT/'test/fixtures/speech-protected-deployments.json'
if p.exists():
    pins=json.loads(p.read_text())
    for name,before in original.items():
        if name not in pins:continue
        assert pins[name]==speech_digest(before), 'Preexisting fixture did not match baseline: '+name
        pins[name]=speech_digest(yaml.safe_load(Path(name).read_text()))
    p.write_text(json.dumps(pins,indent=2)+'\n')
print(json.dumps({'brokers':list(original),'changed':changed},indent=2))
