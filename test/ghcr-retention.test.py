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

class BoundedRegistryTests(unittest.TestCase):
 def tearDown(self):m._DEADLINE=None;m._REPORT_PATH=None
 def test_raw_manifest_requires_matching_digest_and_schema(self):
  body=json.dumps({'schemaVersion':2,'mediaType':'application/vnd.oci.image.manifest.v1+json','layers':[]}).encode()
  key='sha256:'+m.hashlib.sha256(body).hexdigest()
  self.assertEqual(m.ManifestReader.decode(key,body)['schemaVersion'],2)
  with self.assertRaises(ValueError):m.ManifestReader.decode(digest(7),body)
  for value in [{'schemaVersion':1,'mediaType':'application/vnd.oci.image.manifest.v1+json'}, {'schemaVersion':2,'mediaType':'unknown'}]:
   raw=json.dumps(value).encode()
   with self.assertRaises(ValueError):m.ManifestReader.decode('sha256:'+m.hashlib.sha256(raw).hexdigest(),raw)
 def test_authorization_redirect_is_not_followed(self):
  from unittest.mock import MagicMock
  conn=MagicMock();conn.getresponse.return_value.status=302;conn.getresponse.return_value.read.return_value=b'{}'
  with patch.object(m.http.client,'HTTPSConnection',return_value=conn):
   with self.assertRaises(RuntimeError):m.ManifestReader('wkarts','argws-connect-api')
  conn.request.assert_called_once();conn.close.assert_called_once()
 def test_manifest_redirect_is_not_followed_and_connection_closed(self):
  from unittest.mock import MagicMock
  token_conn=MagicMock();token_conn.getresponse.return_value.status=200;token_conn.getresponse.return_value.read.return_value=b'{"token":"test-credential"}'
  data_conn=MagicMock();data_conn.getresponse.return_value.status=302;data_conn.getresponse.return_value.read.return_value=b'{}'
  with patch.object(m.http.client,'HTTPSConnection',side_effect=[token_conn,data_conn]):
   reader=m.ManifestReader('wkarts','argws-connect-api')
   with self.assertRaises(RuntimeError):reader.read(digest(7))
   reader.close()
  data_conn.request.assert_called_once();self.assertTrue(data_conn.close.called)
 def test_one_authorization_per_package_and_keepalive_per_thread(self):
  from unittest.mock import MagicMock
  body=json.dumps({'schemaVersion':2,'mediaType':'application/vnd.oci.image.manifest.v1+json'}).encode();key='sha256:'+m.hashlib.sha256(body).hexdigest()
  token=MagicMock();token.getresponse.return_value.status=200;token.getresponse.return_value.read.return_value=b'{"token":"not-logged"}'
  connection=MagicMock();connection.getresponse.return_value.status=200;connection.getresponse.return_value.read.return_value=body
  with patch.object(m.http.client,'HTTPSConnection',side_effect=[token,connection]) as factory:
   reader=m.ManifestReader('wkarts','argws-connect-api');reader.read(key);reader.read(key);reader.close()
  self.assertEqual(factory.call_count,2);self.assertEqual(connection.request.call_count,2);self.assertEqual(reader.credential,'')
 def test_scope_and_digest_are_validated_before_request(self):
  with patch.object(m.http.client,'HTTPSConnection') as conn:
   for owner,package in [('owner/path','argws-connect-api'),('wkarts','other-package'),('wkarts','argws-connect-api/evil')]:
    with self.assertRaises(ValueError):m.ManifestReader(owner,package)
   conn.assert_not_called()
 def test_complete_paginated_metadata_is_not_cached(self):
  rows=[version(i+1) for i in range(101)];calls=[]
  def api(path):
   calls.append(path);page=int(path.rsplit('=',1)[1]);return copy.deepcopy(rows[(page-1)*100:page*100])
  with patch.object(m,'api',side_effect=api):
   self.assertEqual(len(m.package_versions('/versions')),101)
   rows[0]['metadata']['container']['tags']=['latest']
   self.assertEqual(m.package_versions('/versions')[0]['metadata']['container']['tags'],['latest'])
  self.assertEqual(len(calls),8)
 def test_duplicate_versions_or_unstable_pagination_preserve(self):
  for responses in [[version(1),version(1)],None]:
   def api(path):
    page=int(path.rsplit('=',1)[1])
    if responses is not None:return responses if page==1 else []
    return [version(3)] if page==2 else []
   with patch.object(m,'api',side_effect=api):
    with self.assertRaises(ValueError):m.package_versions('/versions')
 def test_deletion_order_keeps_parent_before_child_and_artifact_before_subject(self):
  rows=[version(1),version(2,children=[1]),version(3)];rows[2]['subject']=digest(2)
  candidates=[{'digest':r['name'],'id':r['id']} for r in rows]
  self.assertEqual([r['id'] for r in m.deletion_order(candidates,rows)],[3,2,1])
 def test_cyclic_reference_preserves_before_any_delete(self):
  rows=[version(1,children=[2]),version(2,children=[1])]
  with self.assertRaises(ValueError):m.deletion_order([{'digest':r['name']} for r in rows],rows)
 def test_expired_budget_cannot_start_external_request(self):
  m._DEADLINE=m.time.monotonic()-1
  with patch.object(m.subprocess,'run') as run:
   with self.assertRaises(m.BudgetExpired):m.api('/repos/owner/repo')
   run.assert_not_called()
 def test_budget_report_preserves_confirmed_deletions(self):
  import tempfile
  with tempfile.TemporaryDirectory() as folder:
   m._REPORT_PATH=Path(folder)/'report.json';m.write_json(m._REPORT_PATH,{'deleted':[{'id':7}]})
   m.finish_deferred('Time budget reached.')
   report=json.loads(m._REPORT_PATH.read_text())
   self.assertEqual(report['mode'],'deferred');self.assertEqual(report['deleted'],[{'id':7}]);self.assertTrue(report['remaining_preserved'])
 def test_bounded_batch_reports_partial_and_images_only_does_not_scan_caches(self):
  import tempfile,sys
  rows=[version(1,['1.1.3']),version(2,['sha-old']),version(3,['sha-older'])];deleted=[]
  def api(path,method='GET'):
   if method=='DELETE':deleted.append(path);return None
   raise AssertionError('Unexpected endpoint '+path)
  with tempfile.TemporaryDirectory() as folder:
   config=Path(folder)/'policy.json';config.write_text(json.dumps(policy()))
   argv=['retention','--policy',str(config),'--output',folder,'--apply','--images-only','--verified-sha','a'*40,'--max-image-deletions','1']
   with patch.object(sys,'argv',argv),patch.dict(m.os.environ,{'GITHUB_REPOSITORY':'wkarts/ARGWS-Connect-API'}),patch.object(m,'inventory_package',side_effect=lambda o,t,p:copy.deepcopy(rows) if p=='argws-connect-api' else []),patch.object(m,'verify_gate',return_value=True),patch.object(m,'no_active_runs',return_value=True),patch.object(m,'package_versions',return_value=rows),patch.object(m,'api',side_effect=api),patch.object(m,'pages',side_effect=AssertionError('No cache/artifact scan permitted')):
    m.main()
   report=json.loads((Path(folder)/'report.json').read_text());self.assertEqual(report['mode'],'partial');self.assertEqual(report['remaining_candidates'],1);self.assertEqual(len(deleted),1)
 def test_live_read_error_preserves_entire_package(self):
  from unittest.mock import MagicMock
  reader=MagicMock();reader.read.side_effect=RuntimeError('unavailable')
  with patch.object(m,'package_versions',return_value=[version(1,['1.1.3']),version(2,['sha-old'])]),patch.object(m,'ManifestReader',return_value=reader):
   rows=m.inventory_package('wkarts','users','argws-connect-api')
  self.assertTrue(all(r['decision']=='preserve' for r in m.plan_package('argws-connect-api',rows,policy(),NOW)))
  reader.close.assert_called_once()
 def test_reusable_workflow_has_internal_time_budget_and_unbuffered_progress(self):
  text=(ROOT/'.github/workflows/ghcr-retention.yml').read_text()
  self.assertIn('--images-only --max-seconds 480 --max-image-deletions 20',text)
  self.assertIn('python3 -u scripts/ghcr-retention.py',text)
  self.assertNotIn('continue-on-error',text)
  self.assertNotIn('skopeo',text)
  self.assertIn('timeout-minutes: 15',text)

if __name__=='__main__':unittest.main()
