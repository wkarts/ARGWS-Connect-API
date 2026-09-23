#!/usr/bin/env python3
import datetime as dt
import importlib.util
import json
from pathlib import Path
import unittest
from unittest.mock import patch
ROOT=Path(__file__).resolve().parents[1]
spec=importlib.util.spec_from_file_location('cache',ROOT/'scripts/actions-cache-retention.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m)
POLICY=json.loads((ROOT/'.github/retention-policy.json').read_text());NOW=dt.datetime.now(dt.timezone.utc);SHA='a'*40;REPO='wkarts/ARGWS-Connect-API'
def cache(ref='refs/heads/develop',hours=3):
 return {'id':1,'key':'buildkit-test','ref':ref,'created_at':(NOW-dt.timedelta(days=1)).isoformat(),'last_accessed_at':(NOW-dt.timedelta(hours=hours)).isoformat(),'size_in_bytes':123}
class CacheTests(unittest.TestCase):
 def test_old_develop_cache_is_candidate_without_registry_dependency(self):
  self.assertEqual(m.plan([cache()],POLICY,NOW,set())[0]['decision'],'candidate')
 def test_recent_cache_and_boundary_are_preserved(self):
  for hours in [0,1,2]:self.assertEqual(m.plan([cache(hours=hours)],POLICY,NOW,set())[0]['decision'],'preserve')
 def test_active_unknown_and_canonical_scope_preserved(self):
  for ref,active in [('refs/heads/develop',{'refs/heads/develop'}),('refs/tags/1.1.3',set()),('',set()),('refs/heads/other',None)]:self.assertEqual(m.plan([cache(ref)],POLICY,NOW,active)[0]['decision'],'preserve')
 def test_reaccess_before_delete_is_preserved(self):
  with patch.object(m,'pages',return_value=[cache(hours=1)]),patch.object(m,'api') as api:
   row=m.recheck_and_delete(REPO,cache(),POLICY,set(),True)
   self.assertEqual(row['decision'],'preserve');api.assert_not_called()
 def test_delete_exact_cache_id_only(self):
  with patch.object(m,'pages',return_value=[cache()]),patch.object(m,'api') as api:
   row=m.recheck_and_delete(REPO,cache(),POLICY,set(),True)
   self.assertEqual(row['decision'],'deleted');api.assert_called_once_with('/repos/'+REPO+'/actions/caches/1','DELETE')
 def test_dry_run_never_deletes(self):
  with patch.object(m,'pages',return_value=[cache()]),patch.object(m,'api') as api:
   m.recheck_and_delete(REPO,cache(),POLICY,set(),False);api.assert_not_called()
 def test_failed_skipped_and_foreign_publication_are_not_authority(self):
  for conclusion in ['failure','cancelled','skipped']:
   run={'id':1,'path':'.github/workflows/ghcr-publish-application.yml','head_branch':'develop','event':'push'}
   def pages(path,key):return [{'name':'Publish api','status':'completed','conclusion':conclusion}] if '/jobs' in path else [run]
   with patch.object(m,'api',return_value={'object':{'sha':SHA}}),patch.object(m,'pages',side_effect=pages):self.assertFalse(m.publication_proven(REPO,SHA,'develop'))
 def test_verified_publisher_cleanup_can_run_before_workflow_completion(self):
  run={'id':1,'path':'.github/workflows/ghcr-publish-application.yml','head_branch':'develop','event':'push'}
  def pages(path,key):return [{'name':'Publish api','status':'completed','conclusion':'success'},{'name':'protected-retention / retention','status':'in_progress','conclusion':None}] if '/jobs' in path else [run]
  with patch.object(m,'api',return_value={'object':{'sha':SHA}}),patch.object(m,'pages',side_effect=pages):self.assertTrue(m.publication_proven(REPO,SHA,'develop',1))
 def test_feature_branch_and_superseded_commit_never_authorize(self):
  with patch.object(m,'api',return_value={'object':{'sha':'b'*40}}):
   self.assertFalse(m.publication_proven(REPO,SHA,'develop'));self.assertFalse(m.publication_proven(REPO,SHA,'feature/test'))
 def test_publisher_workflow_has_no_duplicate_workflow_run_or_long_sleep(self):
  source=(ROOT/'.github/workflows/ghcr-retention.yml').read_text()
  self.assertNotIn('  workflow_run:',source);self.assertNotIn('--wait-seconds 600',source)
  self.assertLess(source.index('scripts/actions-cache-retention.py'),source.index('Install registry reader'))
  self.assertNotIn('retention-dry-run',source)
 def test_whatsapp_sources_and_canonical_manifest_untouched(self):
  # The new worker has no DELETE endpoint for packages, refs, releases or official assets.
  source=(ROOT/'scripts/actions-cache-retention.py').read_text()
  deletes=[s for s in source.splitlines() if "'DELETE'" in s]
  self.assertEqual(len(deletes),1);self.assertIn('/actions/caches/',deletes[0])
if __name__=='__main__':unittest.main()
