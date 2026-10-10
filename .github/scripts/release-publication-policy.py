#!/usr/bin/env python3
"""Classify publication independently from validation; never bypass a release hold."""
import os
from pathlib import Path
import sys

HOLD_PATH = Path('.github/RELEASE_HOLD.md')


def publication_policy(event: str, ref: str, root: Path = Path('.')) -> tuple[bool, str]:
    if event not in {'push', 'workflow_dispatch', 'pull_request'}:
        raise ValueError('Unsupported release event; publication denied.')
    if event != 'pull_request' and ref != 'refs/heads/main':
        raise ValueError('Production releases must run on main.')
    try:
        # lstat also sees empty files, directories and dangling symlinks. Only
        # genuine absence can release the hold; permission/I/O errors fail closed.
        (root / HOLD_PATH).lstat()
    except FileNotFoundError:
        held = False
    else:
        held = True
    if held:
        return False, 'held'
    if event == 'pull_request':
        return False, 'validation-only'
    return True, 'eligible'


def main() -> int:
    try:
        allowed, reason = publication_policy(
            os.environ.get('GITHUB_EVENT_NAME', ''), os.environ.get('GITHUB_REF', '')
        )
        output_path = os.environ.get('GITHUB_OUTPUT')
        if not output_path:
            raise ValueError('GITHUB_OUTPUT is required; publication denied.')
        with open(output_path, 'a', encoding='utf-8') as output:
            output.write(f'publish={str(allowed).lower()}\nreason={reason}\n')
        messages = {
            'held': 'Publication suspended by .github/RELEASE_HOLD.md. Validation continues; no version, tag or image will be published.',
            'validation-only': 'Pull request validation only. Publication is disabled even when no release hold exists.',
            'eligible': 'No release hold exists. Publication still requires every validation to succeed on main.',
        }
        message = messages[reason]
        print(f'::notice::{message}')
        summary_path = os.environ.get('GITHUB_STEP_SUMMARY')
        if summary_path:
            with open(summary_path, 'a', encoding='utf-8') as summary:
                summary.write(f'## Release publication policy: {reason}\n\n{message}\n')
        return 0
    except (OSError, ValueError):
        # No path, environment, hold contents or exception details reach logs.
        print('::error::Unable to evaluate release publication policy; publication denied.', file=sys.stderr)
        return 1


if __name__ == '__main__':
    raise SystemExit(main())
