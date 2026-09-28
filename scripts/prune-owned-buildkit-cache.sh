#!/usr/bin/env bash
set -euo pipefail
# Opt-in for owned persistent CI builders only. Hosted buildx builders are already disposed by setup-buildx.
: "${PUBLISH_VALIDATED:?Set only after verifying the published artifact}"
[[ "$PUBLISH_VALIDATED" == true ]] || exit 1
: "${OWNED_BUILDX_BUILDER:?Explicit builder required; never target an arbitrary Docker host}"
docker buildx prune --builder "$OWNED_BUILDX_BUILDER" --filter 'until=2h' --force
