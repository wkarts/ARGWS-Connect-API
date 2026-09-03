from __future__ import annotations

from datetime import date

from app.providers.banking.core.capabilities import (
    BankingAuthType as Auth,
    BankingCapability as Cap,
    BankingEnvironment as Env,
    BankingIntegrationMode as Mode,
    ProviderStatus as Status,
)
from app.providers.banking.core.manifest import (
    AuthenticationManifest,
    BankInstitutionReference,
    CNABManifest,
    CredentialField,
    DocumentationReference,
    ProviderManifest,
    WebhookManifest,
)

CHECKED = date(2026, 8, 23)


def doc(url: str, title: str, version: str | None = None) -> DocumentationReference:
    return DocumentationReference(url=url, title=title, version=version, checked_at=CHECKED)


def institution(name: str, bank_code: str | None = None, ispb: str | None = None) -> BankInstitutionReference:
    return BankInstitutionReference(name=name, bank_code=bank_code, ispb=ispb)


def catalog_only(
    code: str,
    name: str,
    *,
    bank_code: str | None,
    url: str,
    modes: frozenset[Mode] = frozenset({Mode.CNAB}),
    capabilities: frozenset[Cap] = frozenset(),
    notes: tuple[str, ...] = (),
) -> ProviderManifest:
    return ProviderManifest(
        code=code,
        name=name,
        institution=institution(name, bank_code),
        status=Status.HOMOLOGATION_REQUIRED if capabilities else Status.CATALOG_ONLY,
        integration_modes=modes,
        environments=frozenset({Env.HOMOLOGATION, Env.PRODUCTION}),
        capabilities=capabilities,
        authentication=AuthenticationManifest(Auth.NONE),
        documentation=(doc(url, f"Portal oficial {name}"),),
        cnab=CNABManifest(
            layouts=tuple(layout for layout, cap in (("240", Cap.CNAB_240), ("400", Cap.CNAB_400)) if cap in capabilities),
            homologated=False,
            notes="Layout deve ser habilitado somente após validação do manual e homologação do convênio específico.",
        ),
        implementation_available=False,
        requires_homologation=True,
        notes=(
            "Manifesto de catálogo. Nenhum endpoint HTTP é criado por aproximação.",
            *notes,
        ),
    )


SANDBOX = ProviderManifest(
    code="SANDBOX",
    name="Ambiente bancário de testes Connect|API",
    institution=None,
    status=Status.IMPLEMENTED,
    integration_modes=frozenset({Mode.DIRECT_API, Mode.FILE_IMPORT}),
    environments=frozenset({Env.SANDBOX}),
    capabilities=frozenset({Cap.BOLETO_CREATE, Cap.BOLETO_GET, Cap.BOLETO_CANCEL, Cap.PIX_COB, Cap.PIX_AUTOMATIC}),
    authentication=AuthenticationManifest(Auth.NONE),
    documentation=(),
    implementation_available=True,
    requires_homologation=False,
    notes=("Provider determinístico exclusivamente para desenvolvimento/testes; não pode ser usado em produção.",),
)

ASAAS = ProviderManifest(
    code="ASAAS",
    name="Asaas",
    institution=institution("ASAAS GESTÃO FINANCEIRA INSTITUIÇÃO DE PAGAMENTO S.A.", None, "19540550"),
    status=Status.IMPLEMENTED,
    integration_modes=frozenset({Mode.DIRECT_API}),
    environments=frozenset({Env.SANDBOX, Env.PRODUCTION}),
    capabilities=frozenset({
        Cap.BOLETO_CREATE, Cap.BOLETO_GET, Cap.BOLETO_CANCEL, Cap.BOLETO_HYBRID,
        Cap.PIX_COB, Cap.PIX_AUTOMATIC, Cap.WEBHOOK,
    }),
    authentication=AuthenticationManifest(
        Auth.API_KEY,
        fields=(CredentialField("api_key", "Chave de API", secret=True),),
        notes="A credencial pertence ao tenant/empresa e é armazenada criptografada.",
    ),
    documentation=(
        doc("https://docs.asaas.com/docs/visao-geral", "Visão geral da API Asaas"),
        doc("https://docs.asaas.com/reference/criar-nova-cobranca", "Criar cobrança"),
        doc("https://docs.asaas.com/docs/webhooks", "Webhooks Asaas"),
    ),
    webhook=WebhookManifest(True, "Token/cabeçalho conforme documentação Asaas; validação específica do provider."),
    implementation_available=True,
    requires_homologation=False,
)

INTER = ProviderManifest(
    code="INTER",
    name="Banco Inter",
    institution=institution("Banco Inter S.A.", "077", "00416968"),
    status=Status.HOMOLOGATION_REQUIRED,
    integration_modes=frozenset({Mode.DIRECT_API, Mode.CNAB}),
    environments=frozenset({Env.SANDBOX, Env.PRODUCTION}),
    capabilities=frozenset({
        Cap.ACCOUNT_INFO, Cap.BALANCE, Cap.STATEMENT,
        Cap.BOLETO_CREATE, Cap.BOLETO_GET, Cap.BOLETO_CANCEL, Cap.BOLETO_HYBRID,
        Cap.PIX_COB, Cap.PIX_COBV, Cap.PIX_RECEIVED, Cap.PIX_PAYMENT, Cap.PIX_REFUND,
        Cap.PIX_WEBHOOK, Cap.PIX_AUTOMATIC, Cap.PAYMENT_BOLETO, Cap.PAYMENT_TAX,
        Cap.TRANSFER_PIX, Cap.WEBHOOK,
    }),
    authentication=AuthenticationManifest(
        Auth.OAUTH2_MTLS,
        fields=(
            CredentialField("client_id", "Client ID"),
            CredentialField("client_secret", "Client Secret", secret=True),
            CredentialField("certificate", "Certificado da integração", secret=True, field_type="file", accepted_extensions=(".crt", ".pem", ".pfx")),
            CredentialField("private_key", "Chave privada", secret=True, field_type="file", accepted_extensions=(".key", ".pem"), required=False),
            CredentialField("certificate_password", "Senha do certificado", secret=True, required=False),
            CredentialField("current_account", "Conta corrente", required=False),
        ),
        scopes=("extrato.read", "boleto-cobranca.read", "boleto-cobranca.write", "cob.read", "cob.write", "cobv.read", "cobv.write", "pix.read", "pix.write", "pagamento-pix.read", "pagamento-pix.write"),
        certificate_required=True,
    ),
    documentation=(
        doc("https://developers.inter.co/", "Portal do desenvolvedor Inter"),
        doc("https://developers.inter.co/references/cobranca-bolepix", "API Cobrança Boleto com Pix"),
        doc("https://developers.inter.co/references/pix", "API Pix"),
        doc("https://developers.inter.co/references/pix-automatico", "API Pix Automático"),
        doc("https://developers.inter.co/references/banking", "API Banking"),
    ),
    webhook=WebhookManifest(True, "Webhook por produto conforme documentação oficial do Inter."),
    implementation_available=False,
    requires_homologation=True,
    rate_limits={"token_validity": "60 minutos", "pix": "documentação oficial define limites por operação"},
    notes=("Capabilities confirmadas documentalmente; executor HTTP não é liberado nesta release sem homologação/contrato do cliente.",),
)

BANRISUL = ProviderManifest(
    code="BANRISUL",
    name="Banrisul",
    institution=institution("Banco do Estado do Rio Grande do Sul S.A.", "041", "92702067"),
    status=Status.HOMOLOGATION_REQUIRED,
    integration_modes=frozenset({Mode.DIRECT_API, Mode.CNAB}),
    environments=frozenset({Env.SANDBOX, Env.PRODUCTION}),
    capabilities=frozenset({Cap.BOLETO_CREATE, Cap.BOLETO_GET, Cap.BOLETO_CANCEL, Cap.PIX_COB, Cap.PIX_COBV, Cap.PIX_RECEIVED, Cap.PIX_WEBHOOK, Cap.PAYMENT_BOLETO, Cap.WEBHOOK, Cap.CNAB_240, Cap.CNAB_400}),
    authentication=AuthenticationManifest(Auth.OAUTH2_CLIENT_CREDENTIALS, certificate_required=False),
    documentation=(
        doc("https://developers.banrisul.com.br/pages/docs/clientes-banrisul/api-cobranca-v1.html", "API Cobrança Banrisul"),
        doc("https://developers.banrisul.com.br/pages/docs/clientes-banrisul/api-pix-v2.8.1.html", "API Pix Banrisul", "2.8.1"),
        doc("https://developers.banrisul.com.br/pages/apis.html", "Catálogo oficial de APIs Banrisul"),
    ),
    webhook=WebhookManifest(True, "Conforme produto/API contratada."),
    cnab=CNABManifest(("240", "400"), False, "Requer manual/convênio correspondente e homologação."),
    implementation_available=False,
    requires_homologation=True,
)

SANTANDER = ProviderManifest(
    code="SANTANDER",
    name="Santander",
    institution=institution("Banco Santander (Brasil) S.A.", "033", "90400888"),
    status=Status.HOMOLOGATION_REQUIRED,
    integration_modes=frozenset({Mode.DIRECT_API, Mode.CNAB, Mode.OPEN_FINANCE}),
    environments=frozenset({Env.SANDBOX, Env.PRODUCTION}),
    capabilities=frozenset({Cap.BOLETO_CREATE, Cap.BOLETO_GET, Cap.BOLETO_UPDATE, Cap.BOLETO_CANCEL, Cap.BOLETO_HYBRID, Cap.PIX_COB, Cap.PIX_COBV, Cap.PIX_AUTOMATIC, Cap.TRANSFER_PIX, Cap.TRANSFER_TED, Cap.DDA, Cap.WEBHOOK, Cap.CNAB_240, Cap.CNAB_400}),
    authentication=AuthenticationManifest(Auth.OAUTH2_MTLS, certificate_required=True),
    documentation=(
        doc("https://developer.santander.com.br/", "Portal Santander Developers"),
        doc("https://developer.santander.com.br/sites/default/files/2024-04/User_Guide_API_de_Cobranca_PT_BR_V2_6.pdf", "API de Cobrança", "2.6"),
        doc("https://developer.santander.com.br/sites/default/files/2024-01/User_Guide_API_PIX_Recebimentos_v11_15_01_24.pdf", "API Pix Recebimentos", "11"),
    ),
    webhook=WebhookManifest(True, "Mecanismo depende da API contratada; validar guia da versão antes da ativação."),
    cnab=CNABManifest(("240", "400"), False, "Layout por produto/convênio; não marcado como homologado automaticamente."),
    implementation_available=False,
)

SICREDI = ProviderManifest(
    code="SICREDI",
    name="Sicredi",
    institution=institution("Banco Cooperativo Sicredi S.A.", "748", "01181521"),
    status=Status.HOMOLOGATION_REQUIRED,
    integration_modes=frozenset({Mode.DIRECT_API, Mode.CNAB}),
    environments=frozenset({Env.HOMOLOGATION, Env.PRODUCTION}),
    capabilities=frozenset({Cap.PIX_COB, Cap.PIX_COBV, Cap.PIX_AUTOMATIC, Cap.PIX_WEBHOOK, Cap.CNAB_240, Cap.CNAB_400}),
    authentication=AuthenticationManifest(Auth.OAUTH2_MTLS, certificate_required=True),
    documentation=(doc("https://developer.sicredi.com.br/api-portal/sites/default/files/Guia_tecnico_integracoes_APIPix_Sicredi_v1.9.5.pdf", "Guia técnico API Pix Sicredi", "1.9.5"),),
    webhook=WebhookManifest(True, "API Pix segue especificação oficial indicada pelo Sicredi; credenciamento/homologação obrigatórios."),
    cnab=CNABManifest(("240", "400"), False),
    implementation_available=False,
)


def _mandatory_catalog() -> list[ProviderManifest]:
    cnab = frozenset({Cap.CNAB_240, Cap.CNAB_400})
    return [
        catalog_only("BANCO_DO_BRASIL", "Banco do Brasil", bank_code="001", url="https://apoio.developers.bb.com.br/", modes=frozenset({Mode.DIRECT_API, Mode.CNAB, Mode.OPEN_FINANCE}), capabilities=frozenset({Cap.BALANCE, Cap.STATEMENT, Cap.TRANSFER_PIX, Cap.PAYMENT_BOLETO, Cap.WEBHOOK, *cnab}), notes=("Portal oficial confirma client_id/client_secret, sandbox e autenticação variável por API; executor permanece bloqueado até especificação do produto contratada.",)),
        catalog_only("ITAU", "Itaú", bank_code="341", url="https://developer.itau.com.br/", modes=frozenset({Mode.DIRECT_API, Mode.CNAB, Mode.OPEN_FINANCE}), capabilities=cnab),
        catalog_only("BRADESCO", "Bradesco", bank_code="237", url="https://developers.bradesco.com.br/", modes=frozenset({Mode.DIRECT_API, Mode.CNAB, Mode.OPEN_FINANCE}), capabilities=cnab),
        SANTANDER,
        catalog_only("CAIXA", "Caixa Econômica Federal", bank_code="104", url="https://www.caixa.gov.br/empresa/pagamentos-recebimentos/cobranca-bancaria/Paginas/default.aspx", modes=frozenset({Mode.CNAB, Mode.OPEN_FINANCE}), capabilities=cnab),
        INTER,
        catalog_only("SICOOB", "Sicoob", bank_code="756", url="https://developers.sicoob.com.br/", modes=frozenset({Mode.DIRECT_API, Mode.CNAB}), capabilities=cnab),
        SICREDI,
        catalog_only("C6", "C6 Bank", bank_code="336", url="https://developers.c6bank.com.br/", modes=frozenset({Mode.DIRECT_API}), capabilities=frozenset({Cap.PIX_COB, Cap.PAYMENT_BOLETO, Cap.DDA})),
        catalog_only("BTG_PACTUAL", "BTG Pactual", bank_code="208", url="https://developer.btgpactual.com/", modes=frozenset({Mode.DIRECT_API}), capabilities=frozenset({Cap.ACCOUNT_INFO, Cap.BALANCE, Cap.STATEMENT, Cap.PIX_COB, Cap.BOLETO_CREATE, Cap.TRANSFER_PIX, Cap.TRANSFER_TED})),
        BANRISUL,
        catalog_only("BANCO_DO_NORDESTE", "Banco do Nordeste", bank_code="004", url="https://portal.dev.bnb.gov.br/", modes=frozenset({Mode.DIRECT_API, Mode.CNAB}), capabilities=frozenset({Cap.PIX_COB, Cap.PIX_COBV, Cap.PIX_RECEIVED, Cap.PIX_REFUND, Cap.PIX_WEBHOOK, *cnab})),
        catalog_only("BANCO_DA_AMAZONIA", "Banco da Amazônia", bank_code="003", url="https://www.bancoamazonia.com.br/", modes=frozenset({Mode.CNAB}), capabilities=cnab),
        catalog_only("BRB", "BRB Banco de Brasília", bank_code="070", url="https://novo.brb.com.br/", modes=frozenset({Mode.CNAB, Mode.OPEN_FINANCE}), capabilities=cnab),
        catalog_only("SAFRA", "Banco Safra", bank_code="422", url="https://www.safra.com.br/", modes=frozenset({Mode.CNAB, Mode.OPEN_FINANCE}), capabilities=cnab),
        catalog_only("DAYCOVAL", "Banco Daycoval", bank_code="707", url="https://www.daycoval.com.br/", modes=frozenset({Mode.CNAB, Mode.OPEN_FINANCE}), capabilities=cnab),
        catalog_only("MERCANTIL", "Banco Mercantil do Brasil", bank_code="389", url="https://bancomercantil.com.br/", modes=frozenset({Mode.CNAB, Mode.OPEN_FINANCE}), capabilities=cnab),
        catalog_only("BS2", "Banco BS2", bank_code="218", url="https://www.bs2.com/", modes=frozenset({Mode.CNAB, Mode.OPEN_FINANCE}), capabilities=cnab),
        catalog_only("PAGBANK", "PagBank", bank_code="290", url="https://developer.pagbank.com.br/", modes=frozenset({Mode.DIRECT_API}), capabilities=frozenset({Cap.PIX_COB, Cap.BOLETO_CREATE, Cap.WEBHOOK})),
        catalog_only("MERCADO_PAGO", "Mercado Pago", bank_code=None, url="https://www.mercadopago.com.br/developers/pt/reference", modes=frozenset({Mode.DIRECT_API}), capabilities=frozenset({Cap.PIX_PAYMENT, Cap.BOLETO_CREATE, Cap.WEBHOOK})),
        catalog_only("STONE", "Stone", bank_code=None, url="https://docs.openbank.stone.com.br/", modes=frozenset({Mode.DIRECT_API}), capabilities=frozenset({Cap.PIX_COB, Cap.PIX_COBV, Cap.BOLETO_CREATE, Cap.WEBHOOK})),
        catalog_only("EFI", "Efí Bank", bank_code=None, url="https://dev.efipay.com.br/", modes=frozenset({Mode.DIRECT_API}), capabilities=frozenset({Cap.PIX_COB, Cap.PIX_COBV, Cap.PIX_RECEIVED, Cap.PIX_PAYMENT, Cap.PIX_REFUND, Cap.PIX_WEBHOOK, Cap.PIX_AUTOMATIC, Cap.BOLETO_CREATE, Cap.WEBHOOK})),
        catalog_only("PICPAY", "PicPay", bank_code=None, url="https://developers-business.picpay.com/", modes=frozenset({Mode.DIRECT_API}), capabilities=frozenset({Cap.PIX_COB, Cap.WEBHOOK})),
    ]


ALL_PROVIDER_MANIFESTS: tuple[ProviderManifest, ...] = tuple([SANDBOX, ASAAS, *_mandatory_catalog()])
