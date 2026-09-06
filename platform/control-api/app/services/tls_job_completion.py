"""Finish a waiting job after resource validation, including already active customers."""
from datetime import UTC, datetime
from app.services.audit import platform_audit
from app.services.provisioning import provisioning_service


async def complete_waiting_job(session, job) -> bool:
    if job.status != "WAITING_TLS" or job.tenant.status not in {"PROVISIONING", "ACTIVE"}:
        return False
    primary = next((item for item in job.tenant.domains if item.is_primary), None)
    if not primary or primary.status != "ACTIVE":
        return False
    validation = await provisioning_service.validate_resources(session, job.tenant, reconcile_domain=False)
    if not validation.get("ready"):
        return False
    job.tenant.status = "ACTIVE"
    if job.tenant.activated_at is None:
        job.tenant.activated_at = datetime.now(UTC)
    job.status, job.current_step, job.progress = "SUCCEEDED", "COMPLETED", 100
    job.finished_at, job.last_error = datetime.now(UTC), None
    job.add_event("COMPLETED", "DNS/SSL verificados; banco e armazenamento revalidados pelo serviço.")
    await platform_audit(session, action="tenant.provisioning.tls_completed", entity_type="ProvisioningJob",
                         entity_id=str(job.id), tenant_id=str(job.tenant_id), actor_id=None,
                         after={"status": "SUCCEEDED", "domain": primary.hostname})
    # The caller commits while holding the existing job lock; do not rerun provisioning.
    return True
