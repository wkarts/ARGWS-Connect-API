import importlib.util,json,unittest,subprocess,re
from pathlib import Path
import yaml
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('prepare',ROOT/'scripts/prepare-traccar-env.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
class TraccarDeployment(unittest.TestCase):
 def test_disabled_no_secrets_or_profile_required(self):
  out=m.prepare('KEEP=unchanged\nCOMPOSE_PROFILES=operations\n');e=m.parse(out)
  self.assertEqual(e['TRACCAR_ENABLED'],'false');self.assertEqual(e['TRACCAR_ADMIN_PASSWORD'],'');self.assertEqual(e['COMPOSE_PROFILES'],'operations')
 def test_internal_generates_once_preserves_other_configuration(self):
  text='# comment\nWHATSAPP_TOKEN=private\nTRACCAR_ENABLED=true\nTRACCAR_MODE=internal\nCOMPOSE_PROFILES=operations,docs\n'
  out=m.prepare(text);e=m.parse(out);self.assertGreaterEqual(len(e['TRACCAR_ADMIN_PASSWORD']),32);self.assertEqual(m.prepare(out),out);self.assertIn('WHATSAPP_TOKEN=private',out);self.assertEqual(e['COMPOSE_PROFILES'],'operations,docs,traccar');self.assertEqual(e['TRACCAR_REPLICAS'],'1')
 def test_external_does_not_start_internal_service(self):
  e=m.parse(m.prepare('TRACCAR_ENABLED=true\nTRACCAR_MODE=external\nCOMPOSE_PROFILES=operations,traccar\nTRACCAR_TOKEN=secret\n'))
  self.assertEqual(e['COMPOSE_PROFILES'],'operations');self.assertEqual(e['TRACCAR_REPLICAS'],'0');self.assertEqual(e['TRACCAR_TOKEN'],'secret')
 def test_duplicate_secret_rejected_without_replacing(self):
  with self.assertRaises(ValueError):m.prepare('TRACCAR_ADMIN_PASSWORD=a\nTRACCAR_ADMIN_PASSWORD=b\n')
 def test_invalid_existing_secret_is_not_rotated(self):
  with self.assertRaises(ValueError):m.prepare('TRACCAR_ENABLED=true\nTRACCAR_MODE=internal\nTRACCAR_ADMIN_PASSWORD=short\n')
 def test_generation_idempotent_and_in_all_actual_api_stacks(self):
  subprocess.run(['python3','scripts/sync-traccar-deployments.py','--check'],cwd=ROOT,check=True)
  inv=json.loads((ROOT/'docs/deployment/traccar-inventory.json').read_text());self.assertEqual(len(inv['apiComposeFiles']),9);self.assertEqual(inv['unsupportedComposeFiles'],[])
  for name in inv['apiComposeFiles']:
   text=(ROOT/name).read_text();start=text.index('  # BEGIN OPTIONAL TRACCAR');end=text.index('  # END OPTIONAL TRACCAR')
   block=text[start:end];self.assertNotIn('    ports:',block);self.assertIn('SERVER_STATISTICS: ""',block);self.assertIn('argws-connect-traccar:6.15.3-alpine',block)
   if 'swarm' in name:self.assertIn('replicas: ${TRACCAR_REPLICAS:-0}',block)
   else:self.assertEqual(block.count('profiles: [traccar]'),3)
   before=text[:start];self.assertNotRegex(before,r'depends_on:[^\n]*traccar')
 def test_all_deployments_embed_bootstrap_without_host_source_file(self):
  inventory=json.loads((ROOT/'docs/deployment/traccar-inventory.json').read_text())['apiComposeFiles']
  generated=['deploy/fersoft/develop/compose.yaml','deploy/fersoft/production/compose.yaml']
  files=inventory+generated;self.assertEqual(len(files),11)
  program=(ROOT/'scripts/traccar-bootstrap.cjs').read_text().removeprefix('#!/usr/bin/env node\n').rstrip()
  code_extensions=('.cjs','.mjs','.js','.ts','.py','.sh')
  for name in files:
   raw=(ROOT/name).read_text();self.assertNotIn('traccar-bootstrap.cjs',raw,name)
   services=yaml.safe_load(raw)['services']
   bootstrap=[service for service_name,service in services.items() if service_name.startswith('traccar-bootstrap')]
   self.assertEqual(len(bootstrap),1,name);entrypoint=bootstrap[0].get('entrypoint')
   self.assertEqual(entrypoint[:2],['node','-e'],name);self.assertEqual(entrypoint[2].rstrip(),program,name)
   self.assertNotIn('volumes',bootstrap[0],name)
   for service in services.values():
    for volume in service.get('volumes',[]):
     source=str(volume.get('source','')) if isinstance(volume,dict) else str(volume)
     self.assertFalse(source.endswith(code_extensions),f'{name}: source code cannot be mounted at runtime')
  copies=sorted(path.relative_to(ROOT).as_posix() for path in ROOT.rglob('traccar-bootstrap.cjs') if '.git' not in path.parts)
  self.assertEqual(copies,['scripts/traccar-bootstrap.cjs'])
 def test_named_official_stacks_preserve_container_identity(self):
  for stack in ['production','develop','canonical']:
   text=(ROOT/f'deploy/{stack}/compose.yaml').read_text()
   for service in ['traccar','traccar-postgres','traccar-bootstrap']:
    name=f'{service}-argws-connect-{stack}'
    self.assertIn(f'  {name}:\n    container_name: {name}\n',text)
 def test_root_does_not_ship_a_host_prepare_helper(self):self.assertFalse((ROOT/'prepare-env.sh').exists())
 def test_existing_sync_contracts_still_pass(self):
  for file in ['sync-findhub-deployments.py','sync-operations-deployments.py']:subprocess.run(['python3','scripts/'+file,'--check'],cwd=ROOT,check=True)
if __name__=='__main__':unittest.main()
