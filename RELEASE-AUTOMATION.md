# ARGWS Connect API — Automatic Versioning and Release

## Canonical version line

ARGWS Connect API starts at `1.0.0` and follows Semantic Versioning.

## Automatic release rule

Every successful merge/push to `main` starts `.github/workflows/auto-version-release.yml`.

The workflow executes, in order:

1. `npm ci`;
2. lint validation;
3. Prisma client generation;
4. TypeScript/application build;
5. semantic version calculation;
6. persistence of the version in `VERSION`, `package.json`, `package-lock.json` and `RELEASE-MANIFEST.json`;
7. multi-architecture API and Manager Docker builds (`linux/amd64`, `linux/arm64`);
8. publication to GHCR;
9. immutable Git tag;
10. GitHub Release with generated notes and image digests.

A GitHub Release is **not created** when validation or Docker publication fails.

## Version calculation

If no semantic release tag exists, the first successful release is:

```text
v1.0.0
```

After that, every merge creates at least a patch release.

Default:

```text
1.0.0 -> 1.0.1 -> 1.0.2
```

PR labels can control the next increment:

```text
version:patch  -> 1.0.1 -> 1.0.2
version:minor  -> 1.0.2 -> 1.1.0
version:major  -> 1.1.0 -> 2.0.0
```

When no version label exists, conventional PR titles are also considered:

```text
feat: ...      -> minor
feat(scope):   -> minor
feat!: ...     -> major
BREAKING CHANGE -> major
anything else  -> patch
```

The default always remains `patch`, guaranteeing a version for every merge.

## GHCR tags

For version `1.4.3`, successful publication creates:

```text
ghcr.io/wkarts/argws-connect-api:1.4.3
ghcr.io/wkarts/argws-connect-api:1.4
ghcr.io/wkarts/argws-connect-api:1
ghcr.io/wkarts/argws-connect-api:latest

ghcr.io/wkarts/argws-connect-manager:1.4.3
ghcr.io/wkarts/argws-connect-manager:1.4
ghcr.io/wkarts/argws-connect-manager:1
ghcr.io/wkarts/argws-connect-manager:latest
```

A SHA tag is also published for traceability.

## Develop / homologation

Pushes to `develop` do not create GitHub Releases.

They publish:

```text
argws-connect-api:homolog
argws-connect-manager:homolog
```

plus the commit SHA tag.

## Repository permissions

GitHub Actions requires:

- `contents: write` for the version commit, tag and release;
- `packages: write` for GHCR;
- `pull-requests: read` to inspect the merged PR labels/title.

In repository settings, Workflow permissions must allow read/write operations. If `main` has branch protection/rulesets, the GitHub Actions bot must be allowed to create the automated release metadata commit, or an equivalent dedicated release token must be configured.

## Merge labels

Create these repository labels:

```text
version:patch
version:minor
version:major
```

They are optional. Without a label, every merge still produces a patch release.
