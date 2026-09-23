import importlib.util,json,unittest,subprocess,re
from pathlib import Path
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
 def test_root_helper_has_correct_relative_path(self):self.assertIn('./scripts/prepare-traccar-env.py',(ROOT/'prepare-env.sh').read_text())
 def test_existing_sync_contracts_still_pass(self):
  for file in ['sync-findhub-deployments.py','sync-operations-deployments.py']:subprocess.run(['python3','scripts/'+file,'--check'],cwd=ROOT,check=True)
if __name__=='__main__':unittest.main()
