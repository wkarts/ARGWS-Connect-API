#!/usr/bin/env python3
"""Fail-closed GHCR/Actions retention. Default is inventory + dry run; release/tag APIs are never deleted."""
import argparse, concurrent.futures, datetime as dt, hashlib, json, os, re, subprocess, sys, time
from pathlib import Path
import base64, http.client, ssl, threading
from urllib.parse import urlencode
UTC=dt.timezone.utc
_DEADLINE = None
_REPORT_PATH = None

class BudgetExpired(RuntimeError):
 """A maintenance time slice ended; this never authorizes further deletion."""

def remaining_timeout(maximum=20):
 if _DEADLINE is None: return maximum
 remaining = _DEADLINE - time.monotonic()
 if remaining < 1: raise BudgetExpired('Maintenance time budget reached; remaining resources preserved.')
 return min(maximum, remaining)

def write_json(path, value):
 path = Path(path)
 temporary = path.with_suffix(path.suffix + '.tmp')
 temporary.write_text(json.dumps(value, indent=2) + '\n')
 temporary.replace(path)

def finish_deferred(reason):
 if _REPORT_PATH is None: raise RuntimeError(reason)
 report = json.loads(_REPORT_PATH.read_text()) if _REPORT_PATH.exists() else {'deleted': []}
 report.update(mode='deferred', reason=reason, finished_at=dt.datetime.now(UTC).isoformat(), remaining_preserved=True)
 write_json(_REPORT_PATH, report)
 print('::warning::' + reason, flush=True)
 print(json.dumps({'mode': 'deferred', 'deleted': len(report.get('deleted', [])), 'remaining_preserved': True}), flush=True)

class ManifestReader:
 """One GHCR bearer credential per package; bounded keep-alive connections per thread.

 Only immutable manifest documents are read. TLS verification, host, digest and
 response-size checks are mandatory. No layer download, redirects or token logs.
 """
 def __init__(self, owner, package):
  if not re.fullmatch(r'[A-Za-z0-9_-]+', owner) or not re.fullmatch(r'argws-connect-[a-z0-9-]+', package):
   raise ValueError('Invalid registry scope.')
  self.owner, self.package = owner, package
  self.local, self.connections, self.lock = threading.local(), [], threading.Lock()
  self.context = ssl.create_default_context()
  token = os.environ.get('GH_TOKEN', '')
  headers = {'User-Agent': 'ARGWS-Connect-Retention/1'}
  if token:
   identity = os.environ.get('GITHUB_ACTOR') or owner
   headers['Authorization'] = 'Basic ' + base64.b64encode((identity + ':' + token).encode()).decode()
  conn = http.client.HTTPSConnection('ghcr.io', timeout=remaining_timeout(), context=self.context)
  try:
   query = urlencode({'service': 'ghcr.io', 'scope': f'repository:{owner}/{package}:pull'})
   conn.request('GET', '/token?' + query, headers=headers)
   response = conn.getresponse()
   body = response.read(65537)
   if response.status != 200 or len(body) > 65536: raise RuntimeError('Registry authorization unavailable.')
   credential = json.loads(body).get('token')
   if not isinstance(credential, str) or not credential or len(credential) > 16384: raise RuntimeError('Invalid registry authorization.')
   self.credential = credential
  finally: conn.close()
 def read(self, digest):
  if not DIGEST.fullmatch(str(digest)): raise ValueError('Invalid manifest digest.')
  timeout = remaining_timeout()
  conn = getattr(self.local, 'connection', None)
  if conn is None:
   conn = self.local.connection = http.client.HTTPSConnection('ghcr.io', timeout=timeout, context=self.context)
   with self.lock: self.connections.append(conn)
  conn.timeout = timeout
  if conn.sock: conn.sock.settimeout(timeout)
  try:
   conn.request('GET', f'/v2/{self.owner}/{self.package}/manifests/{digest}', headers={
    'Authorization': 'Bearer ' + self.credential,
    'Accept': ', '.join(sorted(KNOWN_MEDIA)), 'User-Agent': 'ARGWS-Connect-Retention/1'})
   response = conn.getresponse()
   body = response.read(4 * 1024 * 1024 + 1)
   if response.status != 200 or len(body) > 4 * 1024 * 1024: raise RuntimeError('Manifest unavailable or too large.')
   return self.decode(digest, body)
  except Exception:
   conn.close(); self.local.connection = None
   raise
 @staticmethod
 def decode(digest, body):
  if 'sha256:' + hashlib.sha256(body).hexdigest() != digest: raise ValueError('Manifest content does not match its digest.')
  manifest = json.loads(body)
  if manifest.get('mediaType') not in KNOWN_MEDIA or manifest.get('schemaVersion') != 2: raise ValueError('Unknown manifest format.')
  return manifest
 def close(self):
  for conn in self.connections: conn.close()
  self.credential = ''

# Version metadata stays live (never reused as deletion permission). Four bounded
# concurrent GETs avoid a serial walk of all pages for EVERY individual deletion.
def package_versions(path):
 rows = []
 for start in range(1, 1001, 4):
  remaining_timeout()
  def fetch(page): return api(path + f'?per_page=100&page={page}')
  with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
   batch = list(pool.map(fetch, range(start, min(start+4, 1001))))
  ended = False
  for part in batch:
   if not isinstance(part, list) or (ended and part): raise ValueError('Unstable package pagination; resources preserved.')
   rows.extend(part)
   if len(part) < 100: ended = True
  if ended:
   if len({v.get('id') for v in rows}) != len(rows) or len({v.get('name') for v in rows}) != len(rows):
    raise ValueError('Duplicate versions in live inventory.')
   return rows
 raise ValueError('Package pagination ceiling reached.')

def deletion_order(candidates, versions):
 """Remove referencing temporary manifests before their children/subjects.

 A stopped batch must not leave a still-listed manifest pointing to a version
 removed by that same batch. Protected nodes never enter this ordering.
 """
 by_digest = {v['name']: v for v in versions}
 nodes = {row['digest']: row for row in candidates}
 edges = {key: set(by_digest[key].get('children', [])) & nodes.keys() for key in nodes}
 for key in nodes:
  subject = by_digest[key].get('subject')
  if subject in nodes: edges[key].add(subject)
 incoming = {key: 0 for key in nodes}
 for children in edges.values():
  for child in children: incoming[child] += 1
 ready = sorted(key for key in nodes if not incoming[key]); ordered = []
 while ready:
  key = ready.pop(0); ordered.append(nodes[key])
  for child in sorted(edges[key]):
   incoming[child] -= 1
   if not incoming[child]: ready.append(child)
 if len(ordered) != len(nodes): raise ValueError('Cyclic manifest references; resources preserved.')
 return ordered

DIGEST=re.compile(r'^sha256:[0-9a-f]{64}$')
KNOWN_MEDIA={'application/vnd.oci.image.index.v1+json','application/vnd.docker.distribution.manifest.list.v2+json',
 'application/vnd.oci.image.manifest.v1+json','application/vnd.docker.distribution.manifest.v2+json','application/vnd.oci.artifact.manifest.v1+json'}

def timestamp(value):
 try:return dt.datetime.fromisoformat(value.replace('Z','+00:00')).astimezone(UTC)
 except (ValueError,TypeError,AttributeError):return None

def validate_policy(policy, previous=None):
 if policy.get('schema')!=1 or '1.1.3' not in policy.get('canonical_versions',[]):raise ValueError('Canonical 1.1.3 must remain protected.')
 if policy.get('delete_releases') is not False or policy.get('delete_git_tags') is not False or policy.get('delete_release_assets') is not False:raise ValueError('Release history must never be deleted.')
 if not {'latest','develop'}.issubset(policy.get('protected_tags',[])):raise ValueError('Channel protection is mandatory.')
 for key in ('cache_hours','image_hours','max_deletions_per_run'):
  if not isinstance(policy.get(key),int) or policy[key]<1:raise ValueError('Invalid retention boundary.')
 if policy['cache_hours']!=2:raise ValueError('Cache policy must retain the last two hours.')
 if set(policy['image_packages']) & set(policy['protected_packages']):raise ValueError('Base packages cannot be candidates.')
 for name in policy['image_packages']+policy['protected_packages']:
  if not re.fullmatch(r'argws-connect-[a-z0-9-]+',name):raise ValueError('Package outside project allowlist.')
 for version in policy['canonical_versions']:
  if not re.fullmatch(r'\d+\.\d+\.\d+',version):raise ValueError('Invalid canonical version.')
 if previous:
  if not set(previous['canonical_versions']).issubset(policy['canonical_versions']):raise ValueError('Historical canonical version removal is forbidden.')
  for package,pins in previous.get('canonical_digests',{}).items():
   for version,digest in pins.items():
    if policy.get('canonical_digests',{}).get(package,{}).get(version)!=digest:raise ValueError('Historical canonical digest cannot change.')
 for package,pins in policy.get('canonical_digests',{}).items():
  if package not in policy['image_packages']:raise ValueError('Pin package not managed.')
  if any(not DIGEST.fullmatch(value) for value in pins.values()):raise ValueError('Invalid canonical digest pin.')
 return policy

def plan_package(package, versions, policy, now):
 """Complete digest graph, all tags per version, reverse subject edges and immutable pins."""
 result=[]
 def preserve(reason):return [{'package':package,'id':v.get('id'),'digest':v.get('name'),'decision':'preserve','reason':reason,'tags':v.get('metadata',{}).get('container',{}).get('tags',[])} for v in versions]
 if package in policy['protected_packages'] or package not in policy['image_packages']:return preserve('protected-or-unmanaged-package')
 if not versions:return []
 by_digest={v.get('name'):v for v in versions}
 if len(by_digest)!=len(versions) or any(not DIGEST.fullmatch(str(v.get('name',''))) or not v.get('complete') or not isinstance(v.get('metadata',{}).get('container',{}).get('tags'),list) for v in versions):return preserve('incomplete-inventory')
 pins=policy.get('canonical_digests',{}).get(package,{})
 if any(version not in pins or pins[version] not in by_digest for version in policy['canonical_versions']):return preserve('unsealed-or-missing-canonical-digest')
 roots=set(pins.values());aliases={}
 for digest,v in by_digest.items():
  tags=v['metadata']['container']['tags']
  if any(not isinstance(tag,str) for tag in tags):return preserve('invalid-tag-inventory')
  for tag in tags:
   if tag in aliases and aliases[tag]!=digest:return preserve('ambiguous-tag')
   aliases[tag]=digest
   if tag in policy['protected_tags'] or tag in policy['canonical_versions'] or re.match(r'^(?:canonical|base)(?:[-_.]|$)',tag):roots.add(digest)
 for version in policy['canonical_versions']:
  if aliases.get(version)!=pins[version]:return preserve('canonical-tag-missing-or-moved')
 # Keep the newest non-canonical release image for rollback as well as all channel roots.
 release=[v for v in versions if any(re.fullmatch(r'\d+\.\d+\.\d+',t) for t in v['metadata']['container']['tags'])]
 if release:roots.add(max(release,key=lambda v:timestamp(v.get('created_at')) or dt.datetime.min.replace(tzinfo=UTC))['name'])
 edges={digest:set(v.get('children',[])) for digest,v in by_digest.items()}
 for digest,v in by_digest.items():
  if any(child not in by_digest for child in edges[digest]):return preserve('missing-manifest-child')
  subject=v.get('subject')
  if subject:
   if subject not in by_digest:return preserve('missing-artifact-subject')
   edges[subject].add(digest)
 protected=set();pending=list(roots)
 while pending:
  node=pending.pop()
  if node in protected:continue
  protected.add(node);pending.extend(edges[node])
 cutoff=now-dt.timedelta(hours=policy['image_hours'])
 for digest,v in by_digest.items():
  tags=v['metadata']['container']['tags'];created=timestamp(v.get('created_at'));updated=timestamp(v.get('updated_at'))
  reason='expired-temporary';decision='candidate'
  if digest in protected:decision,reason='preserve','protected-digest-or-descendant'
  elif not created or not updated:decision,reason='preserve','unknown-age'
  elif max(created,updated)>=cutoff:decision,reason='preserve','rollback-grace-period'
  elif tags and not all(any(re.fullmatch(pattern,t) for pattern in policy['candidate_tag_patterns']) for t in tags):decision,reason='preserve','unknown-or-permanent-alias'
  result.append({'package':package,'id':v['id'],'digest':digest,'tags':tags,'decision':decision,'reason':reason})
 # A retained unknown alias or recent index also protects ALL of its children/referrers.
 retained={row['digest'] for row in result if row['decision']=='preserve'};pending=list(retained)
 while pending:
  node=pending.pop()
  for child in edges[node]:
   if child not in retained:retained.add(child);pending.append(child)
 for row in result:
  if row['digest'] in retained and row['decision']=='candidate':row['decision']='preserve';row['reason']='referenced-by-retained-manifest'
 return result

def plan_caches(caches,policy,now):
 cutoff=now-dt.timedelta(hours=policy['cache_hours']);result=[]
 for cache in caches:
  created=timestamp(cache.get('created_at'));accessed=timestamp(cache.get('last_accessed_at'))
  old=created and accessed and max(created,accessed)<cutoff
  result.append({'kind':'cache','id':cache['id'],'key':cache.get('key',''),'decision':'candidate' if old else 'preserve','reason':'unused-over-two-hours' if old else 'recent-or-unknown-age'})
 return result

def command(args,raw=False):
 try:
  result=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=remaining_timeout(30))
  return result.stdout if raw else result.stdout.decode()
 except BudgetExpired: raise
 except subprocess.TimeoutExpired:
  remaining_timeout()
  raise RuntimeError('External inventory operation timed out; resources preserved.') from None
 except Exception:raise RuntimeError('External inventory operation failed; resources preserved.') from None

def api(path,method='GET'):
 # Guard the only deletion routes this executable is allowed to call.
 if method=='DELETE' and not (re.fullmatch(r'/(?:users|orgs)/[\w-]+/packages/container/argws-connect-(?:api|manager|docs)/versions/\d+',path) or re.fullmatch(r'/repos/[\w.-]+/[\w.-]+/actions/(?:caches|artifacts)/\d+',path)):
  raise ValueError('Destructive endpoint outside allowlist.')
 result=command(['gh','api','-X',method,'-H','Accept: application/vnd.github+json',path])
 return json.loads(result) if result.strip() else None

def pages(path,key=None):
 rows=[]
 for page in range(1,1001):
  data=api(path+('&' if '?' in path else '?')+f'per_page=100&page={page}')
  part=data[key] if key else data
  if not isinstance(part,list):raise ValueError('Incomplete paginated inventory.')
  rows+=part
  if len(part)<100:return rows
 raise ValueError('Pagination ceiling reached; no deletion allowed.')

def package_path(owner,owner_type,package):return f'/{owner_type}/{owner}/packages/container/{package}/versions'

def inventory_package(owner,owner_type,package):
 versions=package_versions(package_path(owner,owner_type,package))
 print(f'Inventory {package}: {len(versions)} versions; bounded digest-verified HTTPS reader.', flush=True)
 if not versions: return []
 reader=ManifestReader(owner,package)
 def inspect(v):
  remaining_timeout()
  try:
   manifest=reader.read(v['name'])
   v['children']=[d['digest'] for d in manifest.get('manifests',[])]
   v['subject']=manifest.get('subject',{}).get('digest')
   v['complete']=True
  except BudgetExpired: raise
  except Exception:v['complete']=False
  return v
 try:
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool: result=list(pool.map(inspect,versions))
 finally: reader.close()
 print(f'Inventory {package}: complete={sum(v["complete"] for v in result)}/{len(result)}.', flush=True)
 return result

PUBLISH_WORKFLOWS={'.github/workflows/ghcr-publish-application.yml','.github/workflows/ghcr-publish-docs.yml',
 '.github/workflows/findhub-extension-release.yml','.github/workflows/auto-version-release.yml'}

def only_retention_pending(repo, run):
 if run.get('path') not in PUBLISH_WORKFLOWS or run.get('event') not in ('push','workflow_dispatch') or run.get('head_branch') not in ('main','develop'):return False
 jobs=pages(f'/repos/{repo}/actions/runs/{run["id"]}/jobs','jobs')
 real=[job for job in jobs if not job['name'].startswith('protected-retention /')]
 retention=[job for job in jobs if job['name'].startswith('protected-retention /')]
 return bool(real and retention) and all(job['status']=='completed' and job['conclusion'] in ('success','skipped') for job in real)

def no_active_runs(repo):
 # A publisher waiting only for its cleanup is safe; builds/tests/pushes from any other run block deletion.
 this=int(os.environ.get('GITHUB_RUN_ID','0'))
 for state in ('in_progress','queued','waiting','pending','requested'):
  for run in pages(f'/repos/{repo}/actions/runs?status={state}','workflow_runs'):
   if run['id']==this:continue
   # Standalone cleanup runs share the same serialized concurrency group; they do not build or publish.
   if run.get('path')=='.github/workflows/ghcr-retention.yml' and run.get('head_branch') in ('main','develop') and run.get('event') in ('workflow_run','workflow_dispatch'):continue
   if not only_retention_pending(repo,run):return False
 return True

def verify_gate(repo,sha,branch,source_sha=None):
 source_sha=source_sha or sha
 if branch not in ('main','develop') or not re.fullmatch(r'[a-f0-9]{40}',sha or '') or not re.fullmatch(r'[a-f0-9]{40}',source_sha or ''):return False
 ref=api(f'/repos/{repo}/git/ref/heads/{branch}')
 if ref['object']['sha']!=sha:return False
 if sha!=source_sha:
  comparison=api(f'/repos/{repo}/compare/{source_sha}...{sha}')
  if comparison['status'] not in ('ahead','identical') or comparison.get('behind_by',0):return False
 runs=pages(f'/repos/{repo}/actions/runs?head_sha={source_sha}','workflow_runs')
 latest={}
 for run in sorted(runs,key=lambda x:x['id']):
  if run.get('event') in ('push','workflow_dispatch') and run.get('head_branch')==branch and run.get('path')!='.github/workflows/ghcr-retention.yml':latest[run['path']]=run
 required='.github/workflows/ghcr-publish-application.yml' if branch=='develop' else '.github/workflows/auto-version-release.yml'
 if required not in latest:return False
 for run in latest.values():
  if run['status']=='completed':
   if run['conclusion'] not in ('success','skipped'):return False
  elif not only_retention_pending(repo,run):return False
 required_run=latest[required]
 # Prove an actual publishing job completed, rather than treating an entirely skipped workflow as publication.
 jobs=pages(f'/repos/{repo}/actions/runs/{required_run["id"]}/jobs','jobs')
 if not any('publish' in job['name'].lower() and job['status']=='completed' and job['conclusion']=='success' and not job['name'].startswith('protected-retention /') for job in jobs):return False
 return no_active_runs(repo)

def canonical_candidate(inventory,policy):
 result={}
 for package,versions in inventory.items():
  pins={}
  for version in policy['canonical_versions']:
   matches=[v['name'] for v in versions if version in v.get('metadata',{}).get('container',{}).get('tags',[])]
   if len(matches)==1:pins[version]=matches[0]
  result[package]=pins
 return result

def main():
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--policy',default='.github/retention-policy.json');parser.add_argument('--output',default='retention-report');parser.add_argument('--inventory-file');parser.add_argument('--apply',action='store_true');parser.add_argument('--validate-policy',action='store_true');parser.add_argument('--previous-policy');parser.add_argument('--wait-seconds',type=int,default=0);parser.add_argument('--verified-sha');parser.add_argument('--source-sha');parser.add_argument('--branch',default='develop');parser.add_argument('--owner-type',choices=['users','orgs'],default='users');parser.add_argument('--max-seconds',type=int,default=480);parser.add_argument('--max-image-deletions',type=int,default=20);parser.add_argument('--images-only',action='store_true')
 args=parser.parse_args();policy=validate_policy(json.loads(Path(args.policy).read_text()),json.loads(Path(args.previous_policy).read_text()) if args.previous_policy else None)
 if args.validate_policy:print('Canonical protection policy validated.');return
 if not 30<=args.max_seconds<=720 or not 1<=args.max_image_deletions<=100:raise ValueError('Invalid bounded maintenance budget.')
 global _DEADLINE, _REPORT_PATH
 _DEADLINE=time.monotonic()+args.max_seconds
 now=dt.datetime.now(UTC);out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
 _REPORT_PATH=out/'report.json'
 write_json(_REPORT_PATH,{'mode':'inventory','at':now.isoformat(),'deleted':[],'complete':False})
 if args.apply and not verify_gate(os.environ.get('GITHUB_REPOSITORY',''),args.verified_sha,args.branch,args.source_sha):
  (out/'report.json').write_text(json.dumps({'mode':'blocked','reason':'Publication or quiescence not proven before inventory; images preserved.','deleted':[]})+'\n')
  print('Image retention deferred without waiting; cache cleanup is independent.');return
 repo=os.environ.get('GITHUB_REPOSITORY','');owner=repo.split('/')[0]
 if not re.fullmatch(r'[\w.-]+/[\w.-]+',repo) and not args.inventory_file:raise ValueError('Explicit GitHub repository is required.')
 if args.inventory_file:
  raw=json.loads(Path(args.inventory_file).read_text());inventory=raw['packages'];caches=raw.get('caches',[])
  if args.apply:raise ValueError('Offline snapshots cannot authorize deletion.')
 else:
  inventory={};errors={}
  for package in policy['image_packages']:
   try:inventory[package]=inventory_package(owner,args.owner_type,package)
   except BudgetExpired:raise
   except Exception:inventory[package]=[];errors[package]='INVENTORY_UNAVAILABLE_NO_DELETION'
   write_json(out/'inventory.json',{'packages':inventory,'errors':errors,'complete':False})
  try:caches=[] if args.images_only else pages(f'/repos/{repo}/actions/caches','actions_caches')
  except BudgetExpired:raise
  except Exception:caches=[];errors['caches']='INVENTORY_UNAVAILABLE_NO_DELETION'
  raw={'packages':inventory,'caches':caches,'errors':errors,'complete':not errors and all(v.get('complete') for rows in inventory.values() for v in rows)}
 write_json(out/'inventory.json',raw)
 write_json(out/'canonical-candidate.json',canonical_candidate(inventory,policy))
 decisions=[row for package,versions in inventory.items() for row in plan_package(package,versions,policy,now)]+plan_caches(caches,policy,now)
 report={'mode':'apply' if args.apply else 'dry-run','at':now.isoformat(),'policy_sha256':hashlib.sha256(Path(args.policy).read_bytes()).hexdigest(),'decisions':decisions,'protected_packages':policy['protected_packages'],'deleted':[],'preserve_release_history':True,'complete':raw.get('complete',True),'max_seconds':args.max_seconds}
 write_json(out/'report.json',report)
 if args.apply:
  # Wait is read-only. Failure/superseded publication never becomes permission to delete.
  wait_deadline=time.monotonic()+min(600,max(0,args.wait_seconds))
  while not verify_gate(repo,args.verified_sha,args.branch,args.source_sha) and time.monotonic()<wait_deadline:
   if api(f'/repos/{repo}/git/ref/heads/{args.branch}')['object']['sha']!=args.verified_sha:break
   time.sleep(min(15,max(0,wait_deadline-time.monotonic())))
  if not verify_gate(repo,args.verified_sha,args.branch,args.source_sha):
   report['mode']='blocked';report['reason']='Publication or quiescence not proven; no destructive cleanup executed.'
   write_json(out/'report.json',report);print(report['reason']);return
  budget=min(policy['max_deletions_per_run'],args.max_image_deletions)
  # Re-evaluate the complete package immediately before deleting; any tag change invalidates the plan.
  for package,original in inventory.items():
   candidates=[d for d in decisions if d.get('package')==package and d['decision']=='candidate']
   if not candidates:continue
   original_tags={v['name']:v['metadata']['container']['tags'] for v in original}
   for row in deletion_order(candidates,original):
    if budget<=0:break
    remaining_timeout()
    if not no_active_runs(repo):
     finish_deferred('A workflow started during cleanup; remaining resources preserved.');return
    fresh=package_versions(package_path(owner,args.owner_type,package))
    if {v['name']:v['metadata']['container']['tags'] for v in fresh}!=original_tags:
     print(f'{package}: live tags changed; remaining package preserved.',flush=True);break
    current=next((v for v in fresh if v['id']==row['id'] and v['name']==row['digest']),None)
    if not current:continue
    # A recently updated version must not be deleted merely because its tags stayed the same.
    ages=[timestamp(current.get('created_at')),timestamp(current.get('updated_at'))]
    if not all(ages) or max(ages)>=dt.datetime.now(UTC)-dt.timedelta(hours=policy['image_hours']):continue
    # Replanning after deletions would otherwise treat children as missing. Never delete a protected root/alias.
    if any(t in policy['protected_tags']+policy['canonical_versions'] for t in current['metadata']['container']['tags']):break
    remaining_timeout()
    try:api(package_path(owner,args.owner_type,package)+'/'+str(row['id']),'DELETE')
    except Exception:
     # Never retry an ambiguous DELETE. Preserve its identity in the audit without claiming deletion.
     report.setdefault('unconfirmed',[]).append(row);write_json(out/'report.json',report)
     raise
    report['deleted'].append(row);budget-=1;original_tags.pop(row['digest'],None)
    print(f'Deleted {package} version {row["id"]}; remaining batch budget={budget}.',flush=True)
    write_json(out/'report.json',report)
  fresh_caches=[] if args.images_only else pages(f'/repos/{repo}/actions/caches','actions_caches')
  for row in plan_caches(fresh_caches,policy,dt.datetime.now(UTC)):
   if budget<=0:break
   if row['decision']!='candidate':continue
   if not no_active_runs(repo):break
   # Fetch this cache again: an access after planning must protect it.
   checked=pages(f'/repos/{repo}/actions/caches?key='+__import__('urllib.parse',fromlist=['quote']).quote(row['key'],safe=''),'actions_caches')
   exact=[c for c in checked if c['id']==row['id']]
   if not exact or plan_caches(exact,policy,dt.datetime.now(UTC))[0]['decision']!='candidate':continue
   api(f'/repos/{repo}/actions/caches/{row["id"]}','DELETE');report['deleted'].append(row);budget-=1
   write_json(out/'report.json',report)
  # Only explicitly intermediate digest artifacts; official release artifacts are never addressed here.
  for artifact in ([] if args.images_only else pages(f'/repos/{repo}/actions/artifacts','artifacts')):
   if budget<=0:break
   age=timestamp(artifact.get('created_at'))
   if not age or age>=now-dt.timedelta(hours=policy['cache_hours']) or not any(artifact['name'].startswith(p) for p in policy['temporary_artifact_prefixes']):continue
   if not no_active_runs(repo):break
   run=api(f'/repos/{repo}/actions/runs/{artifact["workflow_run"]["id"]}')
   if run['status']!='completed' or run['conclusion']!='success':continue
   api(f'/repos/{repo}/actions/artifacts/{artifact["id"]}','DELETE');report['deleted'].append({'kind':'intermediate-artifact','id':artifact['id'],'name':artifact['name']});budget-=1
 report['remaining_candidates']=max(0,sum(d['decision']=='candidate' for d in decisions)-len(report['deleted']))
 report['finished_at']=dt.datetime.now(UTC).isoformat()
 if args.apply and report['remaining_candidates']:
  report['mode']='partial';report['reason']='Bounded maintenance batch complete; remaining candidates preserved for subsequent verified publications.'
  print('::notice::'+report['reason'],flush=True)
 if not report['complete']:
  report['mode']='deferred';report['reason']='Incomplete registry inventory; affected packages preserved.'
  print('::warning::'+report['reason'],flush=True)
 write_json(out/'report.json',report)
 print(json.dumps({'preserved':sum(d['decision']=='preserve' for d in decisions),'candidates':sum(d['decision']=='candidate' for d in decisions),'deleted':len(report['deleted']),'mode':report['mode']}))
if __name__=='__main__':
 try:main()
 except BudgetExpired as error:finish_deferred(str(error))
 except Exception:
  if _REPORT_PATH is not None:
   report=json.loads(_REPORT_PATH.read_text())
   report.update(mode='failed',reason='Maintenance stopped on an unverified operation; no automatic retry.',remaining_preserved=True)
   write_json(_REPORT_PATH,report)
  print('RETENTION STOP: unverified operation; inspect the audit. Remaining resources preserved.',file=sys.stderr);sys.exit(1)
