#!/usr/bin/env python3
"""Fail-closed GHCR/Actions retention. Default is inventory + dry run; release/tag APIs are never deleted."""
import argparse, concurrent.futures, datetime as dt, hashlib, json, os, re, subprocess, sys, time
from pathlib import Path
UTC=dt.timezone.utc
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
  result=subprocess.run(args,stdout=subprocess.PIPE,stderr=subprocess.PIPE,check=True,timeout=60)
  return result.stdout if raw else result.stdout.decode()
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
 versions=pages(package_path(owner,owner_type,package))
 def inspect(v):
  try:
   manifest=json.loads(command(['skopeo','inspect','--raw',f'docker://ghcr.io/{owner}/{package}@{v["name"]}']))
   v['children']=[d['digest'] for d in manifest.get('manifests',[])]
   v['subject']=manifest.get('subject',{}).get('digest')
   v['complete']=manifest.get('mediaType') in KNOWN_MEDIA and manifest.get('schemaVersion')==2
  except Exception:v['complete']=False
  return v
 with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:return list(pool.map(inspect,versions))

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
 parser=argparse.ArgumentParser(description=__doc__);parser.add_argument('--policy',default='.github/retention-policy.json');parser.add_argument('--output',default='retention-report');parser.add_argument('--inventory-file');parser.add_argument('--apply',action='store_true');parser.add_argument('--validate-policy',action='store_true');parser.add_argument('--previous-policy');parser.add_argument('--wait-seconds',type=int,default=0);parser.add_argument('--verified-sha');parser.add_argument('--source-sha');parser.add_argument('--branch',default='develop');parser.add_argument('--owner-type',choices=['users','orgs'],default='users')
 args=parser.parse_args();policy=validate_policy(json.loads(Path(args.policy).read_text()),json.loads(Path(args.previous_policy).read_text()) if args.previous_policy else None)
 if args.validate_policy:print('Canonical protection policy validated.');return
 now=dt.datetime.now(UTC);out=Path(args.output);out.mkdir(parents=True,exist_ok=True)
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
   except Exception:inventory[package]=[];errors[package]='INVENTORY_UNAVAILABLE_NO_DELETION'
  try:caches=pages(f'/repos/{repo}/actions/caches','actions_caches')
  except Exception:caches=[];errors['caches']='INVENTORY_UNAVAILABLE_NO_DELETION'
  raw={'packages':inventory,'caches':caches,'errors':errors}
 (out/'inventory.json').write_text(json.dumps(raw,indent=2)+'\n')
 (out/'canonical-candidate.json').write_text(json.dumps(canonical_candidate(inventory,policy),indent=2)+'\n')
 decisions=[row for package,versions in inventory.items() for row in plan_package(package,versions,policy,now)]+plan_caches(caches,policy,now)
 report={'mode':'apply' if args.apply else 'dry-run','at':now.isoformat(),'policy_sha256':hashlib.sha256(Path(args.policy).read_bytes()).hexdigest(),'decisions':decisions,'protected_packages':policy['protected_packages'],'deleted':[],'preserve_release_history':True}
 (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 if args.apply:
  # Wait is read-only. Failure/superseded publication never becomes permission to delete.
  wait_deadline=time.monotonic()+min(600,max(0,args.wait_seconds))
  while not verify_gate(repo,args.verified_sha,args.branch,args.source_sha) and time.monotonic()<wait_deadline:
   if api(f'/repos/{repo}/git/ref/heads/{args.branch}')['object']['sha']!=args.verified_sha:break
   time.sleep(min(15,max(0,wait_deadline-time.monotonic())))
  if not verify_gate(repo,args.verified_sha,args.branch,args.source_sha):
   report['mode']='blocked';report['reason']='Publication or quiescence not proven; no destructive cleanup executed.'
   (out/'report.json').write_text(json.dumps(report,indent=2)+'\n');print(report['reason']);return
  budget=policy['max_deletions_per_run']
  # Re-evaluate the complete package immediately before deleting; any tag change invalidates the plan.
  for package,original in inventory.items():
   candidates=[d for d in decisions if d.get('package')==package and d['decision']=='candidate']
   if not candidates:continue
   original_tags={v['name']:v['metadata']['container']['tags'] for v in original}
   for row in candidates:
    if budget<=0:break
    if not no_active_runs(repo):raise RuntimeError('A workflow started during cleanup; remaining resources preserved.')
    fresh=pages(package_path(owner,args.owner_type,package))
    if {v['name']:v['metadata']['container']['tags'] for v in fresh}!=original_tags:break
    current=next((v for v in fresh if v['id']==row['id'] and v['name']==row['digest']),None)
    if not current:continue
    # Replanning after deletions would otherwise treat children as missing. Never delete a protected root/alias.
    if any(t in policy['protected_tags']+policy['canonical_versions'] for t in current['metadata']['container']['tags']):break
    api(package_path(owner,args.owner_type,package)+'/'+str(row['id']),'DELETE')
    report['deleted'].append(row);budget-=1;original_tags.pop(row['digest'],None)
    (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
  fresh_caches=pages(f'/repos/{repo}/actions/caches','actions_caches')
  for row in plan_caches(fresh_caches,policy,dt.datetime.now(UTC)):
   if budget<=0:break
   if row['decision']!='candidate':continue
   if not no_active_runs(repo):break
   # Fetch this cache again: an access after planning must protect it.
   checked=pages(f'/repos/{repo}/actions/caches?key='+__import__('urllib.parse',fromlist=['quote']).quote(row['key'],safe=''),'actions_caches')
   exact=[c for c in checked if c['id']==row['id']]
   if not exact or plan_caches(exact,policy,dt.datetime.now(UTC))[0]['decision']!='candidate':continue
   api(f'/repos/{repo}/actions/caches/{row["id"]}','DELETE');report['deleted'].append(row);budget-=1
   (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
  # Only explicitly intermediate digest artifacts; official release artifacts are never addressed here.
  for artifact in pages(f'/repos/{repo}/actions/artifacts','artifacts'):
   if budget<=0:break
   age=timestamp(artifact.get('created_at'))
   if not age or age>=now-dt.timedelta(hours=policy['cache_hours']) or not any(artifact['name'].startswith(p) for p in policy['temporary_artifact_prefixes']):continue
   if not no_active_runs(repo):break
   run=api(f'/repos/{repo}/actions/runs/{artifact["workflow_run"]["id"]}')
   if run['status']!='completed' or run['conclusion']!='success':continue
   api(f'/repos/{repo}/actions/artifacts/{artifact["id"]}','DELETE');report['deleted'].append({'kind':'intermediate-artifact','id':artifact['id'],'name':artifact['name']});budget-=1
 (out/'report.json').write_text(json.dumps(report,indent=2)+'\n')
 print(json.dumps({'preserved':sum(d['decision']=='preserve' for d in decisions),'candidates':sum(d['decision']=='candidate' for d in decisions),'deleted':len(report['deleted']),'mode':report['mode']}))
if __name__=='__main__':
 try:main()
 except Exception as error:print('RETENTION STOP: '+str(error),file=sys.stderr);sys.exit(1)
