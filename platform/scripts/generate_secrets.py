#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import secrets
import stat
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
PLACEHOLDER_PREFIXES = ("CHANGE_ME", "__CONFIGURE_")


def token(length: int = 48) -> str:
    return secrets.token_urlsafe(length)


def canonical_version() -> str:
    version_file = ROOT / "VERSION"
    version = version_file.read_text(encoding="utf-8").strip()
    if not version:
        raise SystemExit(f"VERSION vazia: {version_file}")
    return version


def load_env(path: Path) -> list[str]:
    return path.read_text(encoding="utf-8").splitlines()


def parse(lines: list[str]) -> dict[str, str]:
    result: dict[str, str] = {}
    for line in lines:
        if not line or line.lstrip().startswith("#") or "=" not in line:
            continue
        key, value = line.split("=", 1)
        result[key.strip()] = value.strip()
    return result


def replace(lines: list[str], values: dict[str, str]) -> list[str]:
    output: list[str] = []
    found: set[str] = set()
    for line in lines:
        if "=" not in line or line.lstrip().startswith("#"):
            output.append(line)
            continue
        key = line.split("=", 1)[0].strip()
        if key in values:
            output.append(f"{key}={values[key]}")
            found.add(key)
        else:
            output.append(line)
    for key, value in values.items():
        if key not in found:
            output.append(f"{key}={value}")
    return output


def needs_generation(value: str, *, force: bool) -> bool:
    return force or not value or value.startswith(PLACEHOLDER_PREFIXES)


def keep_or_generate(current: dict[str, str], key: str, generated: str, *, force: bool) -> str:
    existing = current.get(key, "")
    return generated if needs_generation(existing, force=force) else existing


def normalize_smtp(current: dict[str, str]) -> str:
    security = current.get("SMTP_SECURITY", "starttls").strip().lower()
    port = current.get("SMTP_PORT", "587").strip()
    if security == "startssl":
        security = "ssl" if port == "465" else "starttls"
    if port == "465" and security == "starttls":
        security = "ssl"
    if security not in {"none", "starttls", "ssl"}:
        security = "starttls"
    return security


def main() -> int:
    parser = argparse.ArgumentParser(description="Gera/repara segredos consistentes para Connect|API Platform.")
    parser.add_argument("--env", type=Path, default=Path(".env"))
    parser.add_argument("--force", action="store_true", help="Regenera credenciais primárias. Não use em stack com dados sem planejar a rotação.")
    args = parser.parse_args()
    if not args.env.exists():
        raise SystemExit(f"Arquivo não encontrado: {args.env}")

    lines = load_env(args.env)
    current = parse(lines)
    version = canonical_version()
    # INITIAL_ADMIN_PASSWORD identifica apenas o modelo legado/central. A senha
    # interna do agente de observabilidade também existe no compose canônico e
    # jamais deve mudar o modo de geração dos demais segredos.
    central_mode = "INITIAL_ADMIN_PASSWORD" in current

    values: dict[str, str] = {
        "APP_SECRET_KEY": keep_or_generate(current, "APP_SECRET_KEY", token(64), force=args.force),
        "FIELD_ENCRYPTION_KEY": keep_or_generate(current, "FIELD_ENCRYPTION_KEY", base64.urlsafe_b64encode(secrets.token_bytes(32)).decode(), force=args.force),
        "INTERNAL_SERVICES_PASSWORD": keep_or_generate(
            current, "INTERNAL_SERVICES_PASSWORD", token(36), force=args.force
        ),
        "DOMAIN_RECONCILIATION_TOKEN": keep_or_generate(current, "DOMAIN_RECONCILIATION_TOKEN", token(48), force=args.force),
        "BANKING_WEBHOOK_SECRET": keep_or_generate(current, "BANKING_WEBHOOK_SECRET", token(48), force=args.force),
        "SMTP_SECURITY": normalize_smtp(current),
    }

    if "APP_VERSION" in current:
        values["APP_VERSION"] = ""
    if "VITE_APP_VERSION" in current:
        values["VITE_APP_VERSION"] = ""
    if "EVOLUTION_WEBHOOK_SECRET" in current:
        values["EVOLUTION_WEBHOOK_SECRET"] = keep_or_generate(current, "EVOLUTION_WEBHOOK_SECRET", token(48), force=args.force)

    if central_mode:
        values["INITIAL_ADMIN_PASSWORD"] = keep_or_generate(current, "INITIAL_ADMIN_PASSWORD", token(24), force=args.force)
    else:
        values["POSTGRES_PASSWORD"] = keep_or_generate(current, "POSTGRES_PASSWORD", token(36), force=args.force)
        values["RABBITMQ_PASSWORD"] = keep_or_generate(current, "RABBITMQ_PASSWORD", token(36), force=args.force)
        values["MINIO_ROOT_PASSWORD"] = keep_or_generate(current, "MINIO_ROOT_PASSWORD", token(36), force=args.force)
        values["PLATFORM_ADMIN_PASSWORD"] = keep_or_generate(current, "PLATFORM_ADMIN_PASSWORD", token(24), force=args.force)
        if "DEMO_TENANT_ADMIN_PASSWORD" in current:
            values["DEMO_TENANT_ADMIN_PASSWORD"] = keep_or_generate(current, "DEMO_TENANT_ADMIN_PASSWORD", token(24), force=args.force)
        if "GRAFANA_ADMIN_PASSWORD" in current:
            values["GRAFANA_ADMIN_PASSWORD"] = keep_or_generate(current, "GRAFANA_ADMIN_PASSWORD", token(24), force=args.force)
        if "CLOUDPANEL_SITE_USER_PASSWORD" in current:
            values["CLOUDPANEL_SITE_USER_PASSWORD"] = keep_or_generate(current, "CLOUDPANEL_SITE_USER_PASSWORD", token(24), force=args.force)

        admin_user = current.get("POSTGRES_ADMIN_USER") or current.get("POSTGRES_USER") or "connect_api_admin"
        postgres_user = current.get("POSTGRES_USER") or "connect_api_admin"
        if admin_user == postgres_user:
            values["POSTGRES_ADMIN_PASSWORD"] = values["POSTGRES_PASSWORD"]
        elif "POSTGRES_ADMIN_PASSWORD" in current:
            values["POSTGRES_ADMIN_PASSWORD"] = keep_or_generate(current, "POSTGRES_ADMIN_PASSWORD", token(36), force=args.force)

        minio_user = current.get("MINIO_ROOT_USER") or "connectapi"
        values["S3_ACCESS_KEY"] = minio_user
        values["S3_SECRET_KEY"] = values["MINIO_ROOT_PASSWORD"]

        rabbit_user = current.get("RABBITMQ_USER") or "connectapi"
        values["RABBITMQ_URL"] = f"amqp://{rabbit_user}:{values['RABBITMQ_PASSWORD']}@connect-rabbitmq:5672/connectapi"
        values["CELERY_BROKER_URL"] = values["RABBITMQ_URL"]

    final_lines = replace(lines, values)
    args.env.write_text("\n".join(final_lines) + "\n", encoding="utf-8")
    args.env.chmod(stat.S_IRUSR | stat.S_IWUSR)

    final_values = parse(final_lines)
    admin_password = final_values.get("INITIAL_ADMIN_PASSWORD", "") if central_mode else final_values.get("PLATFORM_ADMIN_PASSWORD", "")
    demo_password = final_values.get("DEMO_TENANT_ADMIN_PASSWORD", "")
    if demo_password == "${INITIAL_ADMIN_PASSWORD}":
        demo_password = final_values.get("INITIAL_ADMIN_PASSWORD", "")

    credentials = args.env.parent / ".bootstrap-credentials.txt"
    credential_lines = [
        f"Connect|API Platform {version} — credenciais iniciais",
        f"Administração: {final_values.get('PUBLIC_SCHEME','https')}://{final_values.get('CONTROL_PLANE_HOST','control.localhost')}",
        f"Usuário: {final_values.get('PLATFORM_ADMIN_EMAIL','admin@example.com')}",
        f"Senha: {admin_password}",
    ]
    if final_values.get("BOOTSTRAP_DEMO_TENANT", "false").lower() == "true":
        credential_lines.extend(["", f"Empresa demo: {final_values.get('PUBLIC_SCHEME','https')}://{final_values.get('DEMO_TENANT_SLUG','demo')}.{final_values.get('TENANT_DOMAIN_ROOT','localhost')}", f"Usuário demo: {final_values.get('DEMO_TENANT_ADMIN_EMAIL','admin.demo@example.com')}", f"Senha demo: {demo_password}"])
    credential_lines.extend(["", "Troque a senha administrativa após o primeiro acesso e guarde este arquivo fora do servidor."])
    credentials.write_text("\n".join(credential_lines) + "\n", encoding="utf-8")
    credentials.chmod(stat.S_IRUSR | stat.S_IWUSR)

    print(f"Versão da imagem/repositório: {version}")
    print(f"Segredos e dependências reparados em {args.env}")
    print(f"Credenciais iniciais gravadas em {credentials}")
    print("Execute o preflight antes do deploy: docker compose run --rm connect-preflight")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
