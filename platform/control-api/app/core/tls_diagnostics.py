"""Safe TLS reason codes shared by the API and SSL service images. No credentials."""
from __future__ import annotations

import re
import ssl
import subprocess

KNOWN_CODES = frozenset(['ACME_COMMAND_FAILED', 'ACME_EMAIL_AND_CLOUDFLARE_TOKEN_REQUIRED', 'AMBIGUOUS_REVERSE_PROXY_UPSTREAM', 'BASE_REVERSE_PROXY_MISSING', 'BASE_SITE_IS_NOT_A_REVERSE_PROXY', 'BASE_VHOST_CONTAINS_UNMANAGED_NAMES', 'CERTIFICATE_CHAIN_LEAF_MISMATCH', 'CERTIFICATE_EXPIRED', 'CERTIFICATE_EXPIRED_OR_NOT_YET_VALID', 'CERTIFICATE_KEY_MISMATCH', 'CERTIFICATE_NOT_READY', 'CERTIFICATE_PATH_ESCAPE', 'CERTIFICATE_PATH_OUTSIDE_MANAGED_NGINX', 'CERTIFICATE_SAN_LIMIT', 'CERTIFICATE_SAN_MISMATCH', 'CERTIFICATE_SAN_MISSING', 'CLOUDFLARE_OPERATION_FAILED', 'CLOUDFLARE_RESPONSE_TOO_LARGE', 'CLOUDFLARE_TOKEN_REQUIRED', 'CLOUDFLARE_UNAVAILABLE', 'CLOUDFLARE_ZONE_NOT_ACTIVE', 'CLOUDFLARE_ZONE_NOT_AUTHORIZED', 'CLOUDPANEL_WILDCARD_NOT_IN_CERTIFICATE_NAMES', 'DNS_SCOPE_MISMATCH', 'DNS_ZONE_NOT_ACTIVE', 'DNS_ZONE_NOT_AUTHORIZED', 'DOMAIN_NOT_COVERED_BY_DNS_PROOF', 'DOMAIN_OUTSIDE_MANAGED_CUSTOMER_SCOPE', 'EXACT_DNS_NODE_SHADOWS_WILDCARD', 'EXACT_VHOST_NOT_FOUND', 'HOST_PATH_ESCAPE', 'INVALID_CLOUDFLARE_ZONE_ID', 'INVALID_DOMAIN', 'INVALID_HOST_PATH', 'INVALID_MANAGED_DNS_ORIGIN', 'JOURNAL_CORRUPTED', 'JOURNAL_INVALID', 'JOURNAL_SCOPE_INVALID', 'LEGACY_DNS_READBACK_MISMATCH', 'LEGACY_DNS_RECORD_CONFLICT', 'LEGACY_DNS_TOO_MANY_RECORDS', 'PLATFORM_ALIAS_OWNED_BY_ANOTHER_VHOST', 'PLATFORM_DNS_CNAME_LOOP', 'PLATFORM_DNS_READBACK_MISMATCH', 'PLATFORM_DNS_RECORD_CONFLICT', 'PLATFORM_DNS_TOO_MANY_RECORDS', 'PLATFORM_ORIGIN_CHAIN_PROXIED', 'PLATFORM_ORIGIN_CHAIN_TOO_LONG', 'PLATFORM_ORIGIN_DNS_MISSING', 'PLATFORM_ORIGIN_MUST_BE_PUBLIC', 'RECOVERY_REQUIRED', 'REVERSE_PROXY_MUST_BE_LOCAL_HTTP', 'SERVED_CERTIFICATE_MISMATCH', 'SITE_AND_ACME_ROOT_MUST_MATCH', 'SNAPSHOT_SCOPE_INVALID', 'TLS_AUTOMATION_DISABLED', 'TLS_CERTIFICATE_VERIFY_FAILED', 'TLS_COMMAND_NOT_FOUND', 'TLS_COMMAND_TIMEOUT', 'TLS_HOST_COMMAND_FAILED', 'TLS_RESOURCE_MISSING', 'TLS_SERVICE_NOT_READY', 'TLS_STATUS_INVALID', 'TLS_STATUS_MISSING', 'TLS_STATUS_STALE', 'TLS_STATUS_UNREADABLE', 'TLS_UNEXPECTED_ERROR', 'TLS_VOLUME_PERMISSION_DENIED', 'UNMANAGED_REVERSE_PROXY_UPSTREAM', 'VHOST_CHANGED_PATH', 'WILDCARD_DNS_PROOF_PENDING', 'WILDCARD_DNS_PROOF_REQUIRES_SERVICE_UPDATE'])

MESSAGES = {
    "CLOUDFLARE_TOKEN_REQUIRED": "Configure CLOUDFLARE_API_TOKEN no .env; não é necessário criar arquivos DNS.",
    "CLOUDFLARE_ZONE_NOT_AUTHORIZED": "O token não permite acessar a zona DNS dos domínios configurados.",
    "CLOUDFLARE_ZONE_NOT_ACTIVE": "A zona Cloudflare ainda não está ativa.",
    "INVALID_CLOUDFLARE_ZONE_ID": "Confira CLOUDFLARE_ZONE_ID no .env.",
    "CLOUDFLARE_OPERATION_FAILED": "A Cloudflare não confirmou a operação; confira autorização da zona e token.",
    "CLOUDFLARE_UNAVAILABLE": "Não foi possível consultar a API Cloudflare; o serviço tentará novamente.",
    "PLATFORM_ORIGIN_DNS_MISSING": "Informe a origem em CLOUDFLARE_TENANT_RECORD_TARGET ou mantenha o registro base válido.",
    "PLATFORM_ORIGIN_MUST_BE_PUBLIC": "CLOUDFLARE_TENANT_RECORD_TARGET deve resolver para o IP público da origem, não 127.0.0.1/IP privado.",
    "PLATFORM_ORIGIN_CHAIN_PROXIED": "A cadeia DNS da origem ainda possui proxy Cloudflare habilitado.",
    "PLATFORM_DNS_CNAME_LOOP": "A origem CNAME aponta para um dos nomes que a própria stack deve configurar.",
    "PLATFORM_DNS_RECORD_CONFLICT": "Há registros DNS conflitantes; a stack não apagou os registros existentes.",
    "INVALID_DOMAIN": "Confira ACME_DOMAIN e os hosts no .env: somente hostname, sem https://, porta ou caminho.",
    "CLOUDPANEL_WILDCARD_NOT_IN_CERTIFICATE_NAMES": "CLOUDPANEL_WILDCARD_DOMAIN não coincide com os nomes de ACME_DOMAIN/TENANT_DOMAIN_ROOT.",
    "ACME_EMAIL_AND_CLOUDFLARE_TOKEN_REQUIRED": "Preencha ACME_EMAIL e CLOUDFLARE_API_TOKEN no .env.",
    "BASE_REVERSE_PROXY_MISSING": "O agente aguarda o único Reverse Proxy base declarado no CloudPanel.",
    "CERTIFICATE_NOT_READY": "O agente aguarda o certificado emitido pelo ACME; não importe arquivos manualmente.",
    "TLS_STATUS_MISSING": "O serviço ainda não publicou seu estado; confira os serviços SSL e a montagem compartilhada do Compose.",
    "TLS_STATUS_UNREADABLE": "O serviço não consegue ler o volume interno de estado TLS; confira as permissões da montagem.",
    "TLS_STATUS_INVALID": "O estado interno do serviço está incompleto ou inválido; não edite arquivos de prova.",
    "TLS_STATUS_STALE": "O estado interno expirou; confira se o serviço correspondente continua executando.",
    "TLS_AUTOMATION_DISABLED": "A automação está desativada; confira PLATFORM_TLS_AUTOMATION_ENABLED no .env.",
    "TLS_VOLUME_PERMISSION_DENIED": "Sem permissão de leitura/escrita no volume interno necessário ao serviço.",
    "TLS_RESOURCE_MISSING": "O serviço não encontrou um recurso interno; confira a etapa registrada, sem criar certificados fictícios.",
    "ACME_COMMAND_FAILED": "O cliente ACME não concluiu a emissão. O certificado anterior foi preservado.",
    "TLS_HOST_COMMAND_FAILED": "A validação/instalação no NGINX/CloudPanel falhou; não foi confirmado SSL ativo.",
    "TLS_CERTIFICATE_VERIFY_FAILED": "O certificado não passou na validação de cadeia, validade ou hostname.",
    "TLS_COMMAND_NOT_FOUND": "A imagem do serviço não contém o executável necessário; confira a versão da imagem.",
    "TLS_COMMAND_TIMEOUT": "A operação do serviço excedeu o tempo limite; nenhuma prontidão foi simulada.",
    "TLS_UNEXPECTED_ERROR": "Falha interna sem detalhe seguro disponível. Consulte a etapa do serviço nos logs do Dockge.",
}


def error_code(value: object) -> str:
    raw = str(value) if isinstance(value, (str, ValueError, RuntimeError)) else ""
    # Older service images persisted only the exception class name. Classify
    # narrowly without inventing which file or credential was missing.
    legacy = {"FileNotFoundError": "TLS_RESOURCE_MISSING", "PermissionError": "TLS_VOLUME_PERMISSION_DENIED"}
    if raw in legacy:
        return legacy[raw]
    if raw in KNOWN_CODES:
        return raw
    if re.fullmatch(r"CLOUDFLARE_HTTP_[1-5][0-9]{2}", raw):
        return raw
    if re.fullmatch(r"acme\.sh_EXIT_[0-9]{1,3}", raw):
        return "ACME_COMMAND_FAILED"
    if re.fullmatch(r"chroot_EXIT_[0-9]{1,3}", raw):
        return "TLS_HOST_COMMAND_FAILED"
    if re.fullmatch(r"openssl_EXIT_[0-9]{1,3}", raw) or isinstance(value, ssl.SSLCertVerificationError):
        return "TLS_CERTIFICATE_VERIFY_FAILED"
    if isinstance(value, PermissionError): return "TLS_VOLUME_PERMISSION_DENIED"
    if isinstance(value, FileNotFoundError): return "TLS_RESOURCE_MISSING"
    if isinstance(value, subprocess.TimeoutExpired): return "TLS_COMMAND_TIMEOUT"
    return "TLS_UNEXPECTED_ERROR"


def error_details(value: object) -> dict[str, str]:
    code = error_code(value)
    if code in {"CLOUDFLARE_HTTP_401", "CLOUDFLARE_HTTP_403"}:
        message = "A Cloudflare recusou a credencial/permissão. Confira o token e a zona no .env."
    elif code == "CLOUDFLARE_HTTP_429":
        message = "A API Cloudflare limitou as requisições; aguarde a nova tentativa do serviço."
    else:
        message = MESSAGES.get(code, "O serviço informou " + code + ". Confira a configuração correspondente no .env.")
    return {"error": code, "message": message}
