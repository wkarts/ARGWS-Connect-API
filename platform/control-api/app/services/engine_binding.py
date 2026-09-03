from __future__ import annotations

import re


def canonical_engine_instance_name(tenant_slug: str, alias: str) -> str:
    """Build the tenant-scoped instance identifier used by the Engine bridge.

    This helper is intentionally dependency-free so tenant isolation naming can
    be validated without importing the FastAPI routing graph.
    """

    tenant = re.sub(r"[^a-z0-9]+", "-", tenant_slug.lower()).strip("-")[:36]
    clean_alias = re.sub(r"[^a-z0-9_-]+", "-", alias.lower()).strip("-")[:49]
    if not tenant:
        tenant = "tenant"
    if not clean_alias:
        clean_alias = "instance"
    return f"t-{tenant}-{clean_alias}"[:96]
