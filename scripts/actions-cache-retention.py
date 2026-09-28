#!/usr/bin/env python3
"""Two-hour Actions cache cleanup. No registry, tag, release or artifact deletion capability."""
import argparse
import concurrent.futures
import datetime as dt
import importlib.util
import json
import os
from pathlib import Path
import re
from urllib.parse import quote

spec = importlib.util.spec_from_file_location('retention', Path(__file__).with_name('ghcr-retention.py'))
retention = importlib.util.module_from_spec(spec)
spec.loader.exec_module(retention)
api, pages = retention.api, retention.pages
CLEANUP = ('.github/workflows/ghcr-retention.yml', '.github/workflows/actions-cache-retention.yml')


def publication_proven(repo, sha, branch, source_run_id=None):
    """Validate a real completed publisher, even when its only pending job is this cleanup."""
    if branch not in ('develop', 'main') or not re.fullmatch(r'[0-9a-f]{40}', sha or ''):
        return False
    if api(f'/repos/{repo}/git/ref/heads/{branch}')['object']['sha'] != sha:
        return False
    runs = pages(f'/repos/{repo}/actions/runs?head_sha={sha}', 'workflow_runs')
    if source_run_id:
        runs = [run for run in runs if run['id'] == source_run_id]
    else:
        latest = {}
        for run in sorted(runs, key=lambda row: row['id']):
            latest[run.get('path')] = run
        runs = list(latest.values())
    for run in runs:
        if run.get('path') not in retention.PUBLISH_WORKFLOWS or run.get('head_branch') != branch or run.get('event') not in ('push', 'workflow_dispatch'):
            continue
        if run.get('head_repository', {}).get('full_name', repo) != repo:
            continue
        jobs = pages(f'/repos/{repo}/actions/runs/{run["id"]}/jobs', 'jobs')
        upstream = [job for job in jobs if not job['name'].startswith(('protected-retention /', 'cache-retention /'))]
        if upstream and all(job['status'] == 'completed' and job['conclusion'] in ('success', 'skipped') for job in upstream) and any('publish' in job['name'].lower() and job['conclusion'] == 'success' for job in upstream):
            return True
    return False


def active_refs(repo, current_run):
    protected = set()
    for state in ('in_progress', 'queued', 'waiting', 'pending', 'requested'):
        for run in pages(f'/repos/{repo}/actions/runs?status={state}', 'workflow_runs'):
            if run['id'] == current_run:
                continue
            if run.get('path') in CLEANUP and run.get('head_branch') in ('main', 'develop'):
                continue
            if retention.only_retention_pending(repo, run):
                continue
            branch = run.get('head_branch')
            if not branch:
                return None  # Unknown active scope means no deletion.
            protected.add('refs/heads/' + branch)
            for pull in run.get('pull_requests', []):
                if 'number' in pull:
                    protected.add(f'refs/pull/{pull["number"]}/merge')
                    protected.add(f'refs/pull/{pull["number"]}/head')
    if protected:
        default = api(f'/repos/{repo}')['default_branch']
        protected.add('refs/heads/' + default)  # Other branches may restore default-branch caches.
    return protected


def plan(caches, policy, now, protected):
    decisions = retention.plan_caches(caches, policy, now)
    for cache, row in zip(caches, decisions):
        row.update(ref=cache.get('ref'), size_in_bytes=cache.get('size_in_bytes', 0))
        ref = cache.get('ref', '')
        if protected is None or not ref or ref in protected or ref.startswith('refs/tags/'):
            row.update(decision='preserve', reason='active-canonical-or-unknown-scope')
    return decisions


def recheck_and_delete(repo, row, policy, protected, apply):
    fresh = pages(f'/repos/{repo}/actions/caches?key={quote(row["key"], safe="")}', 'actions_caches')
    exact = [cache for cache in fresh if cache['id'] == row['id']]
    if not exact:
        return {**row, 'decision': 'preserve', 'reason': 'already-absent'}
    decision = plan(exact, policy, dt.datetime.now(dt.timezone.utc), protected)[0]
    if decision['decision'] != 'candidate' or not apply:
        return decision
    # Only this exact cache route can ever be deleted from this script.
    api(f'/repos/{repo}/actions/caches/{int(row["id"])}', 'DELETE')
    return {**decision, 'decision': 'deleted'}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--apply', action='store_true')
    parser.add_argument('--verified-sha', required=True)
    parser.add_argument('--branch', choices=['main', 'develop'], required=True)
    parser.add_argument('--source-run-id', type=int)
    parser.add_argument('--output', default='cache-retention-report.json')
    args = parser.parse_args()
    repo = os.environ.get('GITHUB_REPOSITORY', '')
    if not re.fullmatch(r'[\w.-]+/[\w.-]+', repo):
        raise ValueError('Repository must be explicit.')
    policy = retention.validate_policy(json.loads(Path('.github/retention-policy.json').read_text()))
    report = {'mode': 'dry-run', 'at': dt.datetime.now(dt.timezone.utc).isoformat(), 'cache_hours': 2, 'decisions': [], 'results': [], 'deleted_bytes': 0}
    output = Path(args.output)
    output.parent.mkdir(parents=True, exist_ok=True)
    def save():
        temporary = output.with_suffix('.tmp')
        temporary.write_text(json.dumps(report, indent=2) + '\n')
        temporary.replace(output)
    try:
        if not publication_proven(repo, args.verified_sha, args.branch, args.source_run_id):
            report.update(mode='blocked', reason='Successful publication not proven; no deletion.')
            return
        current = int(os.environ.get('GITHUB_RUN_ID', '0'))
        protected = active_refs(repo, current)
        caches = pages(f'/repos/{repo}/actions/caches', 'actions_caches')
        report['decisions'] = plan(caches, policy, dt.datetime.now(dt.timezone.utc), protected)
        save()  # Persist the dry run BEFORE any deletion.
        if not args.apply:
            return
        report['mode'] = 'apply'
        candidates = [row for row in report['decisions'] if row['decision'] == 'candidate'][:1000]
        for offset in range(0, len(candidates), 25):
            if not publication_proven(repo, args.verified_sha, args.branch, args.source_run_id):
                report.update(mode='partial', reason='Publication changed; remaining caches preserved.')
                break
            protected = active_refs(repo, current)
            if protected is None:
                report.update(mode='partial', reason='Unknown active workflow scope; remaining caches preserved.')
                break
            with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
                futures = {pool.submit(recheck_and_delete, repo, row, policy, protected, True): row for row in candidates[offset:offset + 25]}
                for future in concurrent.futures.as_completed(futures):
                    row = futures[future]
                    try:
                        result = future.result()
                    except Exception:
                        result = {**row, 'decision': 'unconfirmed', 'reason': 'API failure; no blind retry. Inspect cache ID.'}
                    report['results'].append(result)
                    if result['decision'] == 'deleted':
                        report['deleted_bytes'] += result.get('size_in_bytes', 0)
                    save()
    finally:
        save()
        print(json.dumps({'mode': report['mode'], 'candidates': sum(r['decision']=='candidate' for r in report['decisions']), 'deleted': sum(r['decision']=='deleted' for r in report['results']), 'deleted_bytes': report['deleted_bytes']}))
        if os.environ.get('GITHUB_STEP_SUMMARY'):
            with open(os.environ['GITHUB_STEP_SUMMARY'], 'a') as summary:
                summary.write('\n### Retenção de cache (2 horas)\n' + json.dumps({'mode':report['mode'],'deleted':sum(r['decision']=='deleted' for r in report['results']),'deleted_bytes':report['deleted_bytes']}) + '\nRelatório completo no artefato de auditoria. Tags, releases e imagens não são alvos deste worker.\n')

if __name__ == '__main__':
    main()
