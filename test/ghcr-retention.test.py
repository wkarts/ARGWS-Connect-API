from unittest.mock import patch
import copy, datetime as dt, importlib.util, json, unittest
from pathlib import Path
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('retention',ROOT/'scripts/ghcr-retention.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
NOW=dt.datetime(2026,9,23,tzinfo=dt.timezone.utc)
def digest(i):return 'sha256:'+format(i,'064x')
def version(i,tags=None,children=None,age=100):
 stamp=(NOW-dt.timedelta(hours=age)).isoformat()
 return {'id':i,'name':digest(i),'created_at':stamp,'updated_at':stamp,'complete':True,'children':[digest(x) for x in children or []], 'metadata':{'container':{'tags':tags or []}}}
def policy():
 p=json.loads((ROOT/'.github/retention-policy.json').read_text());p['canonical_digests']={'argws-connect-api':{'1.1.3':digest(1)}};return p
class RetentionTests(unittest.TestCase):
 def plan(self,rows,p=None,pkg='argws-connect-api'):return {x['id']:x for x in m.plan_package(pkg,rows,p or policy(),NOW)}
 def test_canonical_index_children_and_attestation_always_preserved(self):
  rows=[version(1,['1.1.3','latest'],[2,3]),version(2),version(3),version(4,['sha-old'])];r=self.plan(rows)
  self.assertEqual([r[i]['decision'] for i in [1,2,3]],['preserve']*3);self.assertEqual(r[4]['decision'],'candidate')
 def test_develop_and_all_its_architectures_are_preserved(self):
  r=self.plan([version(1,['1.1.3']),version(2,['develop'],[3]),version(3),version(4,['pr-13'])]);self.assertEqual(r[3]['decision'],'preserve');self.assertEqual(r[4]['decision'],'candidate')
 def test_referrer_subject_reverse_edge_is_protected(self):
  attachment=version(3);attachment['subject']=digest(1)
  r=self.plan([version(1,['1.1.3']),attachment]);self.assertEqual(r[3]['decision'],'preserve')
 def test_latest_tag_sharing_digest_with_temporary_tag_is_preserved(self):
  r=self.plan([version(1,['1.1.3']),version(2,['latest','sha-foo'])]);self.assertEqual(r[2]['decision'],'preserve')
 def test_missing_child_preserves_entire_package(self):
  r=self.plan([version(1,['1.1.3'],[99]),version(2,['sha-foo'])]);self.assertTrue(all(v['decision']=='preserve' for v in r.values()))
 def test_incomplete_inventory_preserves_entire_package(self):
  rows=[version(1,['1.1.3']),version(2,['sha-foo'])];rows[0]['complete']=False
  self.assertTrue(all(v['decision']=='preserve' for v in self.plan(rows).values()))
 def test_unsealed_canonical_preserves_entire_package(self):
  p=policy();p['canonical_versions'].append('1.2.0');r=self.plan([version(1,['1.1.3']),version(2,['sha-foo'])],p)
  self.assertTrue(all(v['decision']=='preserve' for v in r.values()))
 def test_moved_canonical_tag_preserves_entire_package(self):
  r=self.plan([version(1),version(2,['1.1.3']),version(3,['sha-foo'])]);self.assertTrue(all(v['decision']=='preserve' for v in r.values()))
 def test_unknown_alias_keeps_descendants(self):
  r=self.plan([version(1,['1.1.3']),version(2,['customer-production'],[3]),version(3)]);self.assertEqual(r[3]['decision'],'preserve')
 def test_recent_image_keeps_descendants(self):
  r=self.plan([version(1,['1.1.3']),version(2,['sha-new'],[3],age=1),version(3)]);self.assertEqual(r[3]['decision'],'preserve')
 def test_newest_release_is_additional_rollback(self):
  r=self.plan([version(1,['1.1.3']),version(2,['1.1.4'],age=80),version(3,['1.1.2'],age=90)]);self.assertEqual(r[2]['decision'],'preserve');self.assertEqual(r[3]['decision'],'candidate')
 def test_old_base_is_never_automatically_deleted(self):
  self.assertEqual(self.plan([version(1,['old'])],pkg='argws-connect-postgres')[1]['decision'],'preserve')
 def test_unknown_package_is_never_deleted(self):
  self.assertEqual(self.plan([version(1,['old'])],pkg='someone-else')[1]['decision'],'preserve')
 def test_missing_age_is_preserved(self):
  old=version(2,['sha-old']);old.pop('updated_at');self.assertEqual(self.plan([version(1,['1.1.3']),old])[2]['decision'],'preserve')
 def test_cache_two_hours_is_access_based_not_creation_only(self):
  caches=[{'id':1,'key':'base','created_at':(NOW-dt.timedelta(days=10)).isoformat(),'last_accessed_at':(NOW-dt.timedelta(minutes=50)).isoformat()}, {'id':2,'key':'old','created_at':(NOW-dt.timedelta(days=10)).isoformat(),'last_accessed_at':(NOW-dt.timedelta(hours=3)).isoformat()}]
  self.assertEqual([x['decision'] for x in m.plan_caches(caches,policy(),NOW)],['preserve','candidate'])
 def test_cache_unknown_age_or_exact_boundary_kept(self):
  stamp=(NOW-dt.timedelta(hours=2)).isoformat();r=m.plan_caches([{'id':1,'created_at':stamp,'last_accessed_at':stamp},{'id':2}],policy(),NOW);self.assertTrue(all(x['decision']=='preserve' for x in r))
 def test_policy_cannot_remove_historical_canonical(self):
  before=policy();before['canonical_versions'].append('1.2.0')
  with self.assertRaises(ValueError):m.validate_policy(policy(),before)
 def test_policy_cannot_change_digest_pin(self):
  before=policy();after=copy.deepcopy(before);after['canonical_digests']['argws-connect-api']['1.1.3']=digest(5)
  with self.assertRaises(ValueError):m.validate_policy(after,before)
 def test_release_history_delete_route_is_forbidden(self):
  for path in ['/repos/wkarts/ARGWS-Connect-API/releases/1','/repos/wkarts/ARGWS-Connect-API/git/refs/tags/1.1.3','/repos/wkarts/ARGWS-Connect-API/releases/assets/1']:
   with self.assertRaises(ValueError):m.api(path,'DELETE')
 def test_release_history_setting_cannot_be_enabled(self):
  for key in ['delete_releases','delete_git_tags','delete_release_assets']:
   p=policy();p[key]=True
   with self.assertRaises(ValueError):m.validate_policy(p)
 def test_policy_rejects_scope_expansion_into_bases(self):
  p=policy();p['image_packages'].append('argws-connect-postgres')
  with self.assertRaises(ValueError):m.validate_policy(p)
 def test_policy_protects_aliases(self):
  p=policy();p['protected_tags'].remove('develop')
  with self.assertRaises(ValueError):m.validate_policy(p)
 def test_checked_in_canonical_matches_recorded_readonly_inventory(self):
  p=json.loads((ROOT/'.github/retention-policy.json').read_text());inv=json.loads((ROOT/'docs/deployment/canonical-1.1.3-inventory.json').read_text())
  for pkg,value in inv['packages'].items():self.assertEqual(p['canonical_digests'][pkg]['1.1.3'],value['digest'])
class PublicationGateTests(unittest.TestCase):
 def test_failed_or_incomplete_publication_cannot_delete(self):
  sha='a'*40;required='.github/workflows/ghcr-publish-application.yml'
  for status,conclusion in [('completed','failure'),('completed','cancelled'),('in_progress',None)]:
   run={'id':7,'path':required,'event':'push','head_branch':'develop','status':status,'conclusion':conclusion}
   with patch.object(m,'api',return_value={'object':{'sha':sha}}),patch.object(m,'pages',return_value=[run]),patch.object(m,'only_retention_pending',return_value=False),patch.object(m,'no_active_runs',return_value=True):
    self.assertFalse(m.verify_gate('wkarts/ARGWS-Connect-API',sha,'develop'))
 def test_superseded_commit_and_feature_branch_cannot_delete(self):
  with patch.object(m,'api',return_value={'object':{'sha':'b'*40}}):
   self.assertFalse(m.verify_gate('wkarts/ARGWS-Connect-API','a'*40,'develop'))
   self.assertFalse(m.verify_gate('wkarts/ARGWS-Connect-API','a'*40,'feat/test'))
 def test_accepted_publication_requires_actual_successful_publish_job(self):
  sha='a'*40;run={'id':7,'path':'.github/workflows/ghcr-publish-application.yml','event':'push','head_branch':'develop','status':'completed','conclusion':'success'}
  for conclusion,expected in [('skipped',False),('success',True)]:
   def pages(path,key):return [{'name':'Publish multi-arch API','status':'completed','conclusion':conclusion}] if path.endswith('/jobs') else [run]
   with patch.object(m,'api',return_value={'object':{'sha':sha}}),patch.object(m,'pages',side_effect=pages),patch.object(m,'no_active_runs',return_value=True):
    self.assertEqual(m.verify_gate('wkarts/ARGWS-Connect-API',sha,'develop'),expected)
 def test_only_cleanup_may_remain_in_its_parent_workflow(self):
  run={'id':7,'path':'.github/workflows/ghcr-publish-application.yml','event':'push','head_branch':'develop'}
  jobs=[{'name':'Publish multi-arch API','status':'completed','conclusion':'success'},{'name':'protected-retention / retention','status':'in_progress','conclusion':None}]
  with patch.object(m,'pages',return_value=jobs):self.assertTrue(m.only_retention_pending('wkarts/ARGWS-Connect-API',run))
  jobs[0]['status']='in_progress'
  with patch.object(m,'pages',return_value=jobs):self.assertFalse(m.only_retention_pending('wkarts/ARGWS-Connect-API',run))
 def test_api_delete_route_cannot_target_base_image(self):
  with self.assertRaises(ValueError):m.api('/users/wkarts/packages/container/argws-connect-traccar/versions/99','DELETE')
if __name__=='__main__':unittest.main()
