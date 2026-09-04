from __future__ import annotations

from pathlib import Path

import yaml

ROOT = Path(__file__).resolve().parents[4]
STACKS = {
    "platform": "argws-connect-platform",
    "platform-develop": "argws-connect-platform-develop",
    "platform-production": "argws-connect-platform-production",
}


def _compose(deployment: str) -> tuple[str, dict]:
    path = ROOT / "deploy" / deployment / "compose.yaml"
    text = path.read_text(encoding="utf-8")
    return text, yaml.safe_load(text)


def test_operational_services_exist_without_changing_deployment_identity() -> None:
    required = {
        "platform-worker-backups",
        "platform-docker-proxy",
        "platform-log-agent",
        "platform-prometheus",
        "platform-grafana",
        "platform-acme",
        "platform-cloudpanel-agent",
    }
    for deployment, project in STACKS.items():
        _, data = _compose(deployment)
        assert data["name"].endswith(project + "}") or project in data["name"]
        suffix = "-" + project
        services = data["services"]
        logical = {name[: -len(suffix)] for name in services if name.endswith(suffix)}
        assert required <= logical
        for name, service in services.items():
            assert service.get("container_name") == name


def test_log_agent_reads_docker_only_through_read_only_proxy() -> None:
    for deployment, project in STACKS.items():
        _, data = _compose(deployment)
        proxy = data["services"][f"platform-docker-proxy-{project}"]
        agent = data["services"][f"platform-log-agent-{project}"]
        assert proxy["environment"]["POST"] == "0"
        assert any("/var/run/docker.sock:ro" in item for item in proxy.get("volumes", []))
        assert not any("docker.sock" in item for item in agent.get("volumes", []))
        assert agent["environment"]["DOCKER_API_URL"] == "http://connect-docker-proxy:2375"
        assert agent.get("read_only") is True


def test_scheduler_uses_writable_tmp_and_backup_worker_has_persistent_archive() -> None:
    for deployment, project in STACKS.items():
        _, data = _compose(deployment)
        scheduler = data["services"][f"platform-scheduler-{project}"]
        backup = data["services"][f"platform-worker-backups-{project}"]
        command = " ".join(scheduler["command"])
        assert "--schedule=/tmp/celerybeat-schedule" in command
        assert "/var/lib/celery" not in command
        assert "connect.backups" in " ".join(backup["command"])
        assert any("/data/backups" in item for item in backup.get("volumes", []))


def test_cloudflare_s3_observability_and_backup_env_are_wired_to_platform_api() -> None:
    required = {
        "LOG_AGENT_URL",
        "CLOUDFLARE_ENABLED",
        "CLOUDFLARE_API_TOKEN",
        "CLOUDFLARE_ZONE_NAME",
        "CLOUDFLARE_TENANT_RECORD_TARGET",
        "BACKUP_ENABLED",
        "BACKUP_UPLOAD_S3",
        "BACKUP_S3_BUCKET",
        "PROMETHEUS_BASE_URL",
        "GRAFANA_BASE_URL",
        "S3_ENDPOINT_URL",
        "S3_BUCKET_PREFIX",
    }
    for deployment, project in STACKS.items():
        _, data = _compose(deployment)
        api = data["services"][f"platform-api-{project}"]
        env = api["environment"]
        assert required <= set(env)
        assert any("/data/backups" in item for item in api.get("volumes", []))


def test_acme_cloudpanel_remain_optional_profile() -> None:
    for deployment, project in STACKS.items():
        _, data = _compose(deployment)
        acme = data["services"][f"platform-acme-{project}"]
        cloudpanel = data["services"][f"platform-cloudpanel-agent-{project}"]
        assert acme.get("profiles") == ["cloudpanel"]
        assert cloudpanel.get("profiles") == ["cloudpanel"]


def test_provisioning_performs_live_database_storage_and_domain_validation() -> None:
    provisioning = (ROOT / "platform/control-api/app/services/provisioning.py").read_text(encoding="utf-8")
    storage = (ROOT / "platform/control-api/app/providers/storage.py").read_text(encoding="utf-8")
    route = (ROOT / "platform/control-api/app/api/routes/control_provisioning.py").read_text(encoding="utf-8")
    assert "async def validate_resources" in provisioning
    assert 'connection.execute(text("select 1"))' in provisioning
    assert "await self.storage.bucket_exists" in provisioning
    assert "await domain_service.verify" in provisioning
    assert "if not validation.get(\"ready\")" in provisioning
    assert "async def bucket_exists" in storage
    assert 'if action == "VALIDATE"' in route
    assert "await provisioning_service.validate_resources" in route


def test_backup_policy_actually_controls_scheduler_and_manual_execution() -> None:
    celery_app = (ROOT / "platform/control-api/app/workers/celery_app.py").read_text(encoding="utf-8")
    operations = (ROOT / "platform/control-api/app/api/routes/control_operations.py").read_text(encoding="utf-8")
    tasks = (ROOT / "platform/control-api/app/workers/tasks.py").read_text(encoding="utf-8")
    assert 'if settings.backup_enabled:' in celery_app
    assert 'beat_schedule["backup-configured-cron"]' in celery_app
    assert '"BACKUP_DISABLED"' in operations
    assert tasks.count('if not settings.backup_enabled:') >= 2


def test_domain_agent_delivery_is_present_in_existing_platform_deploy_family() -> None:
    base = ROOT / "deploy/platform/domain-agent"
    assert (base / "domain-agent.env.example").is_file()
    assert (base / "connect-api-domain-agent.service").is_file()
    assert (base / "connect-api-domain-agent.timer").is_file()
    doc = (ROOT / "platform/docs/operations/DOMAINS_SSL.md").read_text(encoding="utf-8")
    assert "deploy/platform/domain-agent" in doc
    assert "plataforma financeira" not in (ROOT / "platform/scripts/domain_agent.py").read_text(encoding="utf-8")


def test_frontend_keeps_connectapi_light_theme_and_restores_operational_navigation() -> None:
    css = (ROOT / "platform/web/src/styles/main.css").read_text(encoding="utf-8")
    layout = (ROOT / "platform/web/src/layouts/AppLayout.vue").read_text(encoding="utf-8")
    dashboard = (ROOT / "platform/web/src/pages/TenantDashboardPage.vue").read_text(encoding="utf-8")
    two_factor = (ROOT / "platform/web/src/pages/TwoFactorPage.vue").read_text(encoding="utf-8")
    app_store = (ROOT / "platform/web/src/stores/app.ts").read_text(encoding="utf-8")
    assert "--brand-primary: #2563EB" in css
    assert "--brand-accent: #06B6D4" in css
    for route in ["/events", "/pbx", "/voip", "/templates", "/integrations", "/micro-apps", "/automations"]:
        assert f"to: '{route}'" in layout
    assert "Connect PBX" in dashboard
    assert 'to="/voip"' in dashboard
    assert 'min-h-screen bg-slate-50' in two_factor
    assert 'if (tenant.value)' in app_store
    assert "api.get<ApiResponse<PublicSiteData>>('/v1/public/site')" in app_store


def test_readiness_uses_generic_s3_protocol_instead_of_minio_specific_http_endpoint() -> None:
    health = (ROOT / "platform/control-api/app/api/routes/health.py").read_text(encoding="utf-8")
    storage = (ROOT / "platform/control-api/app/providers/storage.py").read_text(encoding="utf-8")
    assert "S3StorageProvider().healthcheck()" in health
    assert 'checks["s3"] = "ok"' in health
    assert "/minio/health/live" not in health
    assert "async def healthcheck" in storage
    assert "self.client.list_buckets" in storage


def test_platform_storage_keeps_bundled_minio_default_but_allows_external_s3_override() -> None:
    for deployment, _project in STACKS.items():
        text, _data = _compose(deployment)
        assert "PLATFORM_S3_ENDPOINT_URL:-http://connect-minio:9000" in text
        assert "PLATFORM_S3_ACCESS_KEY" in text
        assert "PLATFORM_S3_SECRET_KEY" in text
        env = (ROOT / "deploy" / deployment / "env.example").read_text(encoding="utf-8")
        assert "PLATFORM_S3_ENDPOINT_URL=" in env
        assert "PLATFORM_S3_BUCKET_PREFIX=" in env


def test_observability_ui_understands_current_platform_container_contract() -> None:
    page = (ROOT / "platform/web/src/pages/ObservabilityPage.vue").read_text(encoding="utf-8")
    for token in (
        "platform-api-argws-connect-",
        "platform-worker-argws-connect-",
        "platform-scheduler-argws-connect-",
        "platform-log-agent-argws-connect-",
        "platform-prometheus-argws-connect-",
        "platform-grafana-argws-connect-",
        "platform-acme-argws-connect-",
        "platform-cloudpanel-agent-argws-connect-",
    ):
        assert token in page
