from __future__ import annotations

from datetime import date

from app.providers.banking.core.capabilities import (
    BankingAuthType,
    BankingCapability,
    BankingEnvironment,
    BankingIntegrationMode,
    ProviderStatus,
)
from app.providers.banking.core.manifest import (
    AuthenticationManifest,
    BankInstitutionReference,
    CNABManifest,
    ConfigurationField,
    CredentialField,
    DocumentationReference,
    ProviderManifest,
    WebhookManifest,
)

CHECKED_AT = date(2026, 8, 25)

BANCO_DO_BRASIL_MANIFEST = ProviderManifest(
    code="BANCO_DO_BRASIL",
    name="Banco do Brasil",
    institution=BankInstitutionReference(
        name="BANCO DO BRASIL S.A.",
        bank_code="001",
        ispb="00000000",
    ),
    status=ProviderStatus.IMPLEMENTED,
    integration_modes=frozenset({
        BankingIntegrationMode.DIRECT_API,
        BankingIntegrationMode.CNAB,
        BankingIntegrationMode.OPEN_FINANCE,
    }),
    implemented_modes=frozenset({BankingIntegrationMode.DIRECT_API, BankingIntegrationMode.CNAB}),
    environments=frozenset({
        BankingEnvironment.SANDBOX,
        BankingEnvironment.HOMOLOGATION,
        BankingEnvironment.PRODUCTION,
    }),
    capabilities=frozenset({
        BankingCapability.BOLETO_CREATE,
        BankingCapability.BOLETO_GET,
        BankingCapability.BOLETO_UPDATE,
        BankingCapability.BOLETO_CANCEL,
        BankingCapability.BOLETO_HYBRID,
        BankingCapability.CNAB_400,
    }),
    authentication=AuthenticationManifest(
        BankingAuthType.OAUTH2_CLIENT_CREDENTIALS,
        fields=(
            CredentialField("client_id", "Client ID"),
            CredentialField("client_secret", "Client Secret", secret=True),
            CredentialField(
                "developer_application_key",
                "Developer Application Key (gw-dev-app-key)",
                secret=True,
                description="Chave de 31 caracteres hexadecimais disponibilizada nas credenciais da aplicação BB for Developers.",
            ),
            CredentialField(
                "numero_convenio",
                "Número do convênio",
                description="Convênio de Cobrança do cliente. Também é utilizado pela composição do Nosso Número.",
            ),
            CredentialField(
                "agencia_beneficiario",
                "Agência do beneficiário",
                required=False,
                description="Necessária para listagem de boletos e baixa operacional quando a operação exigir o filtro.",
            ),
            CredentialField(
                "conta_beneficiario",
                "Conta do beneficiário",
                required=False,
                description="Necessária para listagem de boletos e baixa operacional quando a operação exigir o filtro.",
            ),
            CredentialField("carteira_convenio", "Carteira do convênio", required=False),
            CredentialField("variacao_carteira_convenio", "Variação da carteira", required=False),
        ),
        scopes=(
            "cobrancas.boletos-info",
            "cobrancas.boletos-requisicao",
            "cobrancas.convenio-requisicao",
        ),
        certificate_required=False,
        notes=(
            "API Cobranças v2: OAuth2 Client Credentials + gw-dev-app-key. "
            "O mTLS do OpenAPI anexado pertence ao webhook de baixa operacional, não às operações HTTP normais de boleto."
        ),
    ),
    settings=(
        ConfigurationField(
            "numero_carteira",
            "Carteira padrão",
            field_type="integer",
            minimum=1,
            description="Número da carteira usado como default ao registrar boletos. Se vazio, usa carteira_convenio da credencial.",
        ),
        ConfigurationField(
            "numero_variacao_carteira",
            "Variação da carteira padrão",
            field_type="integer",
            minimum=1,
            description="Variação padrão da carteira. Se vazia, usa variacao_carteira_convenio da credencial.",
        ),
        ConfigurationField(
            "codigo_modalidade",
            "Modalidade de cobrança",
            field_type="select",
            options=(("1", "1 - Simples"), ("4", "4 - Vinculada")),
            default="1",
        ),
        ConfigurationField(
            "indicador_pix",
            "Pix vinculado ao boleto",
            field_type="select",
            options=(
                ("N", "N - Sem Pix"),
                ("S", "S - QR Code Pix dinâmico"),
                ("A", "A - Pix Automático, recorrência numerada pelo BB"),
                ("B", "B - Pix Automático, recorrência numerada pelo cliente"),
                ("C", "C - Pix Automático com Location"),
            ),
            default="S",
        ),
        ConfigurationField(
            "codigo_aceite",
            "Aceite do título",
            field_type="select",
            options=(("A", "A - Aceite"), ("N", "N - Não aceite")),
            default="N",
        ),
        ConfigurationField(
            "codigo_tipo_titulo",
            "Espécie do título",
            field_type="select",
            options=(
                ("1", "Cheque"),
                ("2", "Duplicata Mercantil"),
                ("4", "Duplicata de Serviço"),
                ("12", "Nota Promissória"),
                ("17", "Recibo"),
                ("18", "Fatura"),
                ("19", "Nota de Débito"),
                ("31", "Cartão de Crédito"),
                ("32", "Boleto Proposta"),
                ("33", "Boleto Aporte"),
                ("99", "Outros"),
            ),
            default="99",
        ),
        ConfigurationField("descricao_tipo_titulo", "Descrição da espécie", description="Use quando a espécie exigir descrição complementar."),
        ConfigurationField(
            "indicador_aceite_titulo_vencido",
            "Receber boleto após vencimento",
            field_type="select",
            options=(("S", "Sim"), ("N", "Não")),
        ),
        ConfigurationField("numero_dias_limite_recebimento", "Dias limite após vencimento", field_type="integer", minimum=0),
        ConfigurationField("quantidade_dias_protesto", "Dias para protesto", field_type="integer", minimum=0),
        ConfigurationField("quantidade_dias_negativacao", "Dias para negativação", field_type="integer", minimum=0),
        ConfigurationField(
            "orgao_negativador",
            "Órgão negativador",
            field_type="select",
            options=(("10", "10 - Serasa"),),
        ),
        ConfigurationField(
            "indicador_permissao_recebimento_parcial",
            "Permitir pagamento parcial",
            field_type="select",
            options=(("S", "Sim"), ("N", "Não")),
            default="N",
        ),
        ConfigurationField(
            "campo_utilizacao_beneficiario",
            "Campo de utilização do beneficiário",
            description="Usado também como código da recorrência nos modos B/C do Pix Automático.",
        ),
        ConfigurationField(
            "mensagem_bloqueto_ocorrencia",
            "Mensagem no boleto",
            field_type="textarea",
            description="Até 165 caracteres; o BB distribui em até três linhas de 55 caracteres.",
        ),
        ConfigurationField("id_location_pix", "Location Pix", field_type="integer", minimum=0),
        ConfigurationField("id_location_recorrencia", "Location da recorrência", field_type="integer", minimum=0),
        ConfigurationField(
            "valor_abatimento",
            "Abatimento padrão",
            field_type="number",
            minimum=0,
        ),
        ConfigurationField(
            "desconto",
            "Primeiro desconto (JSON)",
            field_type="json",
            placeholder='{"tipo":1,"dataExpiracao":"10.09.2026","valor":10.00}',
        ),
        ConfigurationField("segundo_desconto", "Segundo desconto (JSON)", field_type="json"),
        ConfigurationField("terceiro_desconto", "Terceiro desconto (JSON)", field_type="json"),
        ConfigurationField(
            "juros_mora",
            "Juros de mora (JSON)",
            field_type="json",
            placeholder='{"tipo":2,"porcentagem":1.0}',
        ),
        ConfigurationField(
            "multa",
            "Multa (JSON)",
            field_type="json",
            placeholder='{"tipo":2,"data":"11.09.2026","porcentagem":2.0}',
        ),
        ConfigurationField(
            "beneficiario_final",
            "Beneficiário final (JSON)",
            field_type="json",
            placeholder='{"tipoInscricao":2,"numeroInscricao":"...","nome":"..."}',
        ),
    ),
    documentation=(
        DocumentationReference(
            url="https://developers.bb.com.br/",
            title="BB for Developers",
            version="Cobranças API 3.2.2",
            checked_at=CHECKED_AT,
            api_spec_version="OpenAPI 3.1.1",
        ),
        DocumentationReference(
            url="https://apoio.developers.bb.com.br/apis/5?versaoApi=2&topico=17458866",
            title="API Cobranças BB v2",
            version="3.2.2",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://www.bb.com.br/docs/pub/emp/empl/dwn/Doc2627CBR641Pos7.pdf",
            title="Cobrança BB — CBR641 CNAB400 — Arquivo Remessa — Convênios de 7 posições",
            version="Junho/2024",
            checked_at=CHECKED_AT,
        ),
        DocumentationReference(
            url="https://www.bb.com.br/docs/pub/emp/empl/dwn/Doc2628CBR643Pos7.pdf",
            title="Cobrança BB — CBR643 CNAB400 — Arquivo Retorno — Convênios de 7 posições",
            checked_at=CHECKED_AT,
        ),
    ),
    webhook=WebhookManifest(
        supported=True,
        authenticity="mTLS validado no terminador TLS/gateway antes da entrega ao backend.",
        notes=(
            "O contrato OpenAPI 3.2.2 documenta webhook de baixa operacional com mutualTLS. "
            "A capability WEBHOOK não é anunciada como efetiva até o gateway de produção possuir validação do certificado cliente BB."
        ),
    ),
    cnab=CNABManifest(
        layouts=("400",),
        homologated=False,
        notes=(
            "Executor baseado nos layouts proprietários CBR641/CBR643 de 400 bytes. "
            "Convênio, carteira e variação precisam ser fornecidos/homologados pelo Banco do Brasil."
        ),
    ),
    implementation_available=True,
    requires_homologation=True,
    notes=(
        "rc.32 executa DIRECT_API Cobranças v2 e CNAB400 CBR641/CBR643 no mesmo provider, com modos explícitos.",
        "API direta: registrar/listar/detalhar/alterar/baixar boleto, gerar/consultar/cancelar Pix vinculado, retorno de movimento e baixa operacional.",
        "O boleto híbrido é anunciado por BOLETO_HYBRID; PIX_COB não é anunciado porque o OpenAPI anexado trata Pix vinculado ao boleto, não cobrança Pix avulsa.",
        "OPEN_FINANCE permanece apenas catalogado, sem executor nesta release.",
        "IMPLEMENTED não significa HOMOLOGATED, SANDBOX_VERIFIED ou PRODUCTION_READY; credenciais reais do cliente ainda são necessárias para homologação.",
    ),
    metadata={
        "documentation_status": "ATTACHED_OPENAPI_VERIFIED",
        "product": "COBRANCAS_API_V2_AND_CBR641_CBR643",
        "api_contract_version": "3.2.2",
        "api_base_paths": {
            "SANDBOX": "https://api.sandbox.bb.com.br/cobrancas/v2",
            "HOMOLOGATION": "https://api.hm.bb.com.br/cobrancas/v2",
            "PRODUCTION": "https://api.bb.com.br/cobrancas/v2",
        },
        "webhook_transport": "mTLS",
        "remittance_layout": "CBR641",
        "return_layout": "CBR643",
        "agreement_digits_cnab": 7,
        "direct_api_operation_fields": {
            "boleto_defaults": [
                "numero_carteira",
                "numero_variacao_carteira",
                "codigo_modalidade",
                "indicador_pix",
                "codigo_aceite",
                "codigo_tipo_titulo",
                "quantidade_dias_protesto",
                "quantidade_dias_negativacao",
                "orgao_negativador",
                "indicador_aceite_titulo_vencido",
                "numero_dias_limite_recebimento",
                "indicador_permissao_recebimento_parcial",
                "campo_utilizacao_beneficiario",
                "mensagem_bloqueto_ocorrencia",
                "id_location_pix",
                "id_location_recorrencia",
                "desconto",
                "segundo_desconto",
                "terceiro_desconto",
                "juros_mora",
                "multa",
                "beneficiario_final",
            ],
            "pix_indicator_domain": ["N", "S", "A", "B", "C"],
        },
        "cnab_settings_schema": [
            {"key": "agreement_number", "source": "BankAgreement.agreement_number", "type": "numeric", "length": 7},
            {"key": "leader_agreement", "source": "BankAgreement.settings", "type": "numeric", "length": 7},
            {"key": "wallet", "source": "BankAgreement.wallet", "allowed": ["11", "17", "31", "51"]},
            {"key": "wallet_variation", "source": "BankAgreement.settings", "type": "numeric", "length": 3},
            {"key": "species_code", "source": "BankAgreement.settings", "allowed": ["01", "02", "03", "05", "08", "09", "10", "12", "13", "15", "25", "26", "27", "31", "32", "33"]},
            {"key": "acceptance", "source": "BankAgreement.settings", "allowed": ["A", "N"]},
        ],
    },
)
