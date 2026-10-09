"""Final source review and Git blob preparation; ref writes use the connector."""
import base64, json, os, re, subprocess, time, urllib.error, urllib.request
from pathlib import Path

def git(*args):
    return subprocess.check_output(['git', *args])

root = Path.cwd()
p = root / 'transcription-service/src/config.js'
p.write_text(re.sub(r'^\s*cacheDir: String\(process\.env\.SPEECH_MODEL_CACHE_DIR[^\n]*\n', '', p.read_text(), flags=re.M))
p = root / 'RELEASE-MANIFEST.json'
p.write_text(p.read_text().replace('ghcr.io/wkarts/argws-connect-transcription-worker', 'ghcr.io/wkarts/connect-transcription-service'))
p = root / 'test/speech-service-deployment.test.py'
s = p.read_text()
if 'protected baseline must cover all eleven layouts' not in s:
    s = s.replace("  for name,expected in baseline.items():", "  self.assertEqual(len(baseline),11, 'protected baseline must cover all eleven layouts')\n  for name,expected in baseline.items():")
p.write_text(s)
assert len(json.loads((root/'test/fixtures/speech-protected-deployments.json').read_text())) == 11
for name in ['.github/migrations/speech-review.py', '.github/migrations/speech-finalize.py', '.github/migrations/speech-service-inputs.zip', '.github/workflows/speech-service-migration.yml']:
    (root/name).unlink(missing_ok=True)
if os.environ.get('PREPARE_GIT_BLOBS') != 'true':
    raise SystemExit(0)

repo = os.environ['GITHUB_REPOSITORY']
assert repo == 'wkarts/ARGWS-Connect-API'
event = json.loads(Path(os.environ['GITHUB_EVENT_PATH']).read_text())
pr = event['pull_request']
head = git('rev-parse', 'HEAD').decode().strip()
assert pr['number'] == 226 and pr['head']['repo']['full_name'] == repo
assert pr['head']['ref'] == 'feat/optional-transcription-service-20261008' and head == pr['head']['sha']
git('add', '-A')
existing = {line.split()[2].decode() for line in git('ls-tree', '-r', 'HEAD').splitlines()}
index = {}
for line in git('ls-files', '--stage', '-z').split(b'\0'):
    if not line: continue
    info, name = line.split(b'\t', 1)
    mode, sha, stage = info.decode().split()
    assert stage == '0'
    index[name.decode()] = (mode, sha)
changed = [n.decode() for n in git('diff', '--cached', '--name-only', '--no-renames', '-z').split(b'\0') if n]
new = {index[name][1] for name in changed if name in index} - existing
token = os.environ['GITHUB_TOKEN']
def prepare_blob(sha):
    endpoint = f'https://api.github.com/repos/{repo}/git/blobs'
    headers = {'Authorization': 'Bearer '+token, 'Accept':'application/vnd.github+json', 'Content-Type':'application/json', 'X-GitHub-Api-Version':'2022-11-28'}
    try:
        with urllib.request.urlopen(urllib.request.Request(endpoint+'/'+sha, headers=headers), timeout=60) as response:
            assert json.load(response)['sha'] == sha
            return sha
    except urllib.error.HTTPError as exc:
        if exc.code != 404: raise
    raw = git('cat-file', 'blob', sha)
    payload = json.dumps({'encoding': 'base64', 'content': base64.b64encode(raw).decode()}).encode()
    for attempt in range(5):
        time.sleep(1.25)
        request = urllib.request.Request(endpoint, payload, headers=headers)
        try:
            with urllib.request.urlopen(request, timeout=60) as response: result=json.load(response)
            assert result['sha'] == sha
            return sha
        except urllib.error.HTTPError as exc:
            detail = exc.read().decode('utf-8', errors='replace')[:2000]
            limited = exc.code == 429 or (exc.code == 403 and 'rate limit' in detail.lower())
            if not limited and exc.code not in [500,502,503,504]:
                raise RuntimeError(f'Git blob rejected: HTTP {exc.code}: {detail}') from None
            if attempt == 4: raise RuntimeError(f'Git blob upload deferred: HTTP {exc.code}: {detail}') from None
            delay = max(60, int(exc.headers.get('Retry-After', '60'))) if limited else 2**attempt
            print(f'GitHub retry after {delay} seconds (HTTP {exc.code}).', flush=True)
            time.sleep(delay)
entries=[]
for name in changed:
    if name not in index:
        entries.append({'path':name, 'mode':'100644', 'type':'blob', 'sha':None})
    else:
        mode, sha = index[name]
        assert mode in ['100644', '100755', '120000']
        entries.append({'path':name, 'mode':mode, 'type':'blob', 'sha':sha})
report={'parent':head, 'base_tree_sha':git('rev-parse','HEAD^{tree}').decode().strip(), 'expected_tree_sha':git('write-tree').decode().strip(), 'tree_elements':entries, 'blobsPrepared':0, 'noRefUpdated':True, 'noDeployment':True}
Path(os.environ['RUNNER_TEMP']+'/speech-tree.json').write_text(json.dumps(report,indent=2))
prepared=[]
for sha in sorted(new):
    prepared.append(prepare_blob(sha))
    report['blobsPrepared']=len(prepared)
    Path(os.environ['RUNNER_TEMP']+'/speech-tree.json').write_text(json.dumps(report,indent=2))
print('Prepared blobs for connector commit:',len(prepared))
print('EXPECTED_TREE_SHA='+report['expected_tree_sha'])
