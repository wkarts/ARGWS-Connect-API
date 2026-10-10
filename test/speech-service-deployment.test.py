#!/usr/bin/env python3
"""Eliminatory checks for optional speech; no service can intercept normal media."""
import json, re, subprocess, unittest, shutil
from pathlib import Path
import yaml
ROOT=Path(__file__).resolve().parents[1]
class SpeechDeploymentTests(unittest.TestCase):
 def test_no_retired_executables_or_heavy_dependency_graph(self):
  self.assertFalse((ROOT/'transcription-worker').exists())
  runtime=ROOT/'transcription-service'
  for name in ['src/worker.js','src/index.js','src/inference-thread.js','Dockerfile.service','native/package.json']:
   self.assertFalse((runtime/name).exists(),name)
  pkg=json.loads((runtime/'package.json').read_text())
  self.assertEqual(pkg['scripts']['start'],'node src/service.js')
  lock=json.loads((runtime/'package-lock.json').read_text())
  self.assertEqual(lock['packages']['']['dependencies'],pkg['dependencies'])
  self.assertEqual(set(pkg['dependencies']),{'amqplib','minio'})
  self.assertFalse(any('onnxruntime' in k or 'transformers' in k or 'cuda' in k.lower() for k in lock['packages']))
  self.assertNotIn("require('./worker')",(runtime/'src/service.js').read_text())
 def test_all_ten_bases_contain_exactly_one_private_optional_service(self):
  paths=[ROOT/'docker-compose.yaml',ROOT/'docker-compose.dev.yaml']+list((ROOT/'deploy').rglob('*.yaml'))+list((ROOT/'deploy').rglob('*.yml'))
  checked=[]
  for p in paths:
   text=p.read_text(); self.assertNotRegex(text,r'transcription-worker|dictation-worker|(?:SPEECH|TRANSCRIPTION|DICTATION)_WORKER_',str(p))
   services=(yaml.safe_load(text) or {}).get('services',{})
   speech=[(k,v) for k,v in services.items() if k.startswith('transcription-service') and ('image' in v or 'build' in v)]
   if not speech: continue
   self.assertEqual(len(speech),1,str(p));name,service=speech[0];checked.append(str(p.relative_to(ROOT)))
   self.assertEqual(service['scale'],1)
   self.assertEqual(service['profiles'],['transcription'])
   self.assertFalse(service.get('ports'))
   self.assertFalse(service.get('privileged'))
   self.assertEqual(service['mem_limit'],service['memswap_limit'])
   self.assertEqual(service['mem_limit'],'${SPEECH_SERVICE_MEMORY:-1280m}')
   self.assertEqual(service['cpus'],'${SPEECH_SERVICE_CPUS:-1.00}')
   self.assertEqual(service['pids_limit'],128)
   self.assertTrue(service['read_only']);self.assertTrue(service['init'])
   self.assertEqual(service['environment']['SPEECH_ENGINE'],'${SPEECH_ENGINE:-whisper.cpp}')
   self.assertEqual(service['environment']['SPEECH_MODEL_KEEP_WARM'],'${SPEECH_MODEL_KEEP_WARM:-false}')
   for other,value in services.items():
    if other != name:self.assertNotIn(name,value.get('depends_on',{}),(p,other))
   api=next(v for k,v in services.items() if k=='api' or k.startswith('api-'))
   self.assertEqual(api['environment']['SPEECH_ENGINE'],service['environment']['SPEECH_ENGINE'])
  self.assertEqual(len(checked),10,checked)
  self.assertIn('deploy/fersoft/develop/compose.yaml',checked)
  self.assertIn('deploy/fersoft/production/compose.yaml',checked)
 def test_every_env_example_is_explicitly_opt_in_and_contains_no_worker_keys(self):
  paths=[p for p in ROOT.rglob('*') if p.is_file() and (p.name in ['.env.example','env.example'] or p.name.endswith('.env.example')) and 'node_modules' not in p.parts and '.git' not in p.parts]
  count=0
  for p in paths:
   text=p.read_text()
   self.assertNotRegex(text,r'(?m)^(?:(?:SPEECH|TRANSCRIPTION|DICTATION)_WORKER[A-Z_]*|ARGWS_CONNECT_TRANSCRIPTION_WORKER_IMAGE|SPEECH_TRANSCRIPTION_REPLICAS|SPEECH_DICTATION_REPLICAS)=',str(p))
   self.assertNotIn('argws-connect-transcription-worker',text)
   values=dict(line.split('=',1) for line in text.splitlines() if line and not line.startswith('#') and '=' in line)
   if 'SPEECH_ENABLED' not in values:continue
   count+=1
   for key in ['SPEECH_ENABLED','TRANSCRIPTION_ENABLED','DICTATION_ENABLED','MANAGER_FEATURE_TRANSCRIPTION','SPEECH_MODEL_AUTO_PROVISION']:
    self.assertEqual(values[key],'false',(p,key))
   self.assertNotIn('transcription',values.get('COMPOSE_PROFILES','').split(','))
   self.assertEqual(values['SPEECH_ENGINE'],'whisper.cpp')
   self.assertEqual(values['SPEECH_MODEL'],'whisper-base-q5_1')
  self.assertGreaterEqual(count,13)
 def test_disabled_runtime_opens_no_model_or_network_and_needs_no_dependencies(self):
  # Empty environment plus invalid broker/model prove opt-out before dependency load.
  result=subprocess.run([shutil.which('node'),str(ROOT/'transcription-service/src/service.js')],
   env={'PATH':'/usr/local/bin:/usr/bin:/bin','SPEECH_ENABLED':'false','SPEECH_ENGINE':'unsupported','RABBITMQ_URI':'amqp://127.0.0.1:1','SPEECH_MODEL_PATH':'/missing'},capture_output=True,text=True,timeout=10)
  self.assertEqual(result.returncode,0,result.stderr)
  self.assertIn('desabilitada',result.stdout)
 def test_regular_services_networks_and_volumes_match_the_reviewed_baseline(self):
  import hashlib
  baseline=json.loads((ROOT/'test/fixtures/speech-protected-deployments.json').read_text())
  self.assertEqual(len(baseline),11, 'protected baseline must cover all eleven layouts')
  for name,expected in baseline.items():
   cfg=yaml.safe_load((ROOT/name).read_text()) or {}
   actual={k:v for k,v in cfg.items() if k!='services'}
   actual['services']={k:v for k,v in cfg.get('services',{}).items() if not k.startswith('transcription-service')}
   for service in actual['services'].values():
    if 'environment' in service:
     service['environment']={k:v for k,v in service['environment'].items() if not k.startswith(('SPEECH_','TRANSCRIPTION_','DICTATION_','MANAGER_FEATURE_TRANSCRIPTION'))}
   digest=hashlib.sha256(json.dumps(actual,sort_keys=True,ensure_ascii=True).encode()).hexdigest()
   self.assertEqual(digest,expected,name)
 def test_fersoft_generator_is_reproducible(self):
  result=subprocess.run(['python3','scripts/sync-fersoft-deployments.py','--check'],cwd=ROOT,capture_output=True,text=True,timeout=15)
  self.assertEqual(result.returncode,0,result.stderr)
if __name__=='__main__':unittest.main()
