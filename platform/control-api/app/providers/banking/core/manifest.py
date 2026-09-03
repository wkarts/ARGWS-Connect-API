from __future__ import annotations

from dataclasses import asdict, dataclass, field
from datetime import date
from typing import Any

from app.providers.banking.core.capabilities import (
    BankingAuthType,
    BankingCapability,
    BankingEnvironment,
    BankingIntegrationMode,
    ProviderStatus,
)


@dataclass(frozen=True, slots=True)
class BankInstitutionReference:
    name: str
    bank_code: str | None = None
    ispb: str | None = None
    cnpj: str | None = None


@dataclass(frozen=True, slots=True)
class CredentialField:
    key: str
    label: str
    required: bool = True
    secret: bool = False
    field_type: str = "text"
    description: str | None = None
    accepted_extensions: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ConfigurationField:
    """Campo operacional declarativo de uma conexão bancária.

    Diferente de ``CredentialField``, estes valores não são segredos de
    autenticação. Eles representam defaults do contrato bancário (carteira,
    modalidade, indicador Pix, limites etc.) e são persistidos em
    ``BankConnection.settings``. O schema é publicado para o frontend para que
    nenhuma integração precise de JSON livre ou campo hard-coded por banco.
    """

    key: str
    label: str
    required: bool = False
    field_type: str = "text"
    description: str | None = None
    options: tuple[tuple[str, str], ...] = ()
    default: Any = None
    minimum: int | float | None = None
    maximum: int | float | None = None
    placeholder: str | None = None


@dataclass(frozen=True, slots=True)
class AuthenticationManifest:
    auth_type: BankingAuthType
    fields: tuple[CredentialField, ...] = ()
    scopes: tuple[str, ...] = ()
    certificate_required: bool = False
    notes: str | None = None


@dataclass(frozen=True, slots=True)
class DocumentationReference:
    url: str
    title: str
    version: str | None = None
    checked_at: date | None = None
    api_spec_version: str | None = None


@dataclass(frozen=True, slots=True)
class WebhookManifest:
    supported: bool = False
    authenticity: str | None = None
    notes: str | None = None


@dataclass(frozen=True, slots=True)
class CNABManifest:
    layouts: tuple[str, ...] = ()
    homologated: bool = False
    notes: str | None = None


@dataclass(frozen=True, slots=True)
class ProviderManifest:
    code: str
    name: str
    institution: BankInstitutionReference | None
    status: ProviderStatus
    integration_modes: frozenset[BankingIntegrationMode]
    environments: frozenset[BankingEnvironment]
    capabilities: frozenset[BankingCapability]
    authentication: AuthenticationManifest
    documentation: tuple[DocumentationReference, ...] = ()
    webhook: WebhookManifest = field(default_factory=WebhookManifest)
    cnab: CNABManifest = field(default_factory=CNABManifest)
    settings: tuple[ConfigurationField, ...] = ()
    implementation_available: bool = False
    implemented_modes: frozenset[BankingIntegrationMode] = field(default_factory=frozenset)
    requires_homologation: bool = True
    rate_limits: dict[str, str] = field(default_factory=dict)
    notes: tuple[str, ...] = ()
    metadata: dict[str, Any] = field(default_factory=dict)

    def supports(self, capability: BankingCapability) -> bool:
        return capability in self.capabilities

    def effective_implemented_modes(self) -> frozenset[BankingIntegrationMode]:
        """Retorna somente modos com executor efetivo nesta versão.

        Manifests anteriores à rc.28 não possuíam ``implemented_modes``. Para
        preservar compatibilidade, um manifest já marcado como implementado
        continua considerando seus ``integration_modes`` como efetivos. Novos
        providers multimodo podem declarar somente o subconjunto realmente
        implementado, impedindo que CNAB seja apresentado como DIRECT_API.
        """
        if self.implemented_modes:
            return self.implemented_modes
        if self.implementation_available:
            return self.integration_modes
        return frozenset()

    def public_dict(self) -> dict[str, Any]:
        data = asdict(self)
        data["status"] = self.status.value
        data["integration_modes"] = sorted(item.value for item in self.integration_modes)
        data["implemented_modes"] = sorted(item.value for item in self.effective_implemented_modes())
        data["environments"] = sorted(item.value for item in self.environments)
        data["capabilities"] = sorted(item.value for item in self.capabilities)
        data["authentication"]["auth_type"] = self.authentication.auth_type.value
        for doc in data["documentation"]:
            if doc.get("checked_at"):
                doc["checked_at"] = doc["checked_at"].isoformat()
        # O frontend precisa saber quais campos solicitar, mas nunca recebe valores secretos.
        data["credential_schema"] = [
            {
                "key": field.key,
                "label": field.label,
                "required": field.required,
                "secret": field.secret,
                "field_type": field.field_type,
                "description": field.description,
                "accepted_extensions": list(field.accepted_extensions),
            }
            for field in self.authentication.fields
        ]
        data["settings_schema"] = [
            {
                "key": item.key,
                "label": item.label,
                "required": item.required,
                "field_type": item.field_type,
                "description": item.description,
                "options": [{"value": value, "label": label} for value, label in item.options],
                "default": item.default,
                "minimum": item.minimum,
                "maximum": item.maximum,
                "placeholder": item.placeholder,
            }
            for item in self.settings
        ]
        return data
