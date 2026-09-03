from __future__ import annotations

# Contrato obtido do repositório oficial inter-co/pj-sdk-python.
# Este módulo não importa nem depende da SDK; ele apenas registra endpoints e
# scopes publicados pelo próprio Banco Inter para manter o driver auditável.

INTER_BASE_URLS = {
    "SANDBOX": "https://cdpj-sandbox.partners.uatinter.co",
    "HOMOLOGATION": "https://cdpj.partners.uatbi.com.br",
    "PRODUCTION": "https://cdpj.partners.bancointer.com.br",
}
INTER_ALLOWED_HOSTS = {url.removeprefix("https://") for url in INTER_BASE_URLS.values()}
INTER_TOKEN_PATH = "/oauth/v2/token"

BANKING_BALANCE = "/banking/v2/saldo"
BANKING_STATEMENT = "/banking/v2/extrato"
BANKING_ENRICHED_STATEMENT = "/banking/v2/extrato/completo"
BANKING_STATEMENT_PDF = "/banking/v2/extrato/exportar"
BANKING_PAYMENT = "/banking/v2/pagamento"
BANKING_PAYMENT_DARF = "/banking/v2/pagamento/darf"
BANKING_PAYMENT_BATCH = "/banking/v2/pagamento/lote"
BANKING_PAYMENT_PIX = "/banking/v2/pix"
BANKING_WEBHOOK = "/banking/v2/webhooks"

PIX_RECEIVED = "/pix/v2/pix"
PIX_LOCATIONS = "/pix/v2/loc"
PIX_COB = "/pix/v2/cob"
PIX_COBV = "/pix/v2/cobv"
PIX_COBV_BATCH = "/pix/v2/lotecobv"
PIX_WEBHOOK = "/pix/v2/webhook"
PIX_WEBHOOK_CALLBACKS = "/pix/v2/webhook/callbacks"

BILLING = "/cobranca/v3/cobrancas"
BILLING_SUMMARY = "/cobranca/v3/cobrancas/sumario"
BILLING_WEBHOOK = "/cobranca/v3/cobrancas/webhook"
BILLING_WEBHOOK_CALLBACKS = "/cobranca/v3/cobrancas/webhook/callbacks"

SCOPE_BILLING_READ = "boleto-cobranca.read"
SCOPE_BILLING_WRITE = "boleto-cobranca.write"
SCOPE_STATEMENT_READ = "extrato.read"
SCOPE_BOLETO_PAYMENT_READ = "pagamento-boleto.read"
SCOPE_BOLETO_PAYMENT_WRITE = "pagamento-boleto.write"
SCOPE_DARF_PAYMENT_WRITE = "pagamento-darf.write"
SCOPE_BATCH_PAYMENT_READ = "pagamento-lote.read"
SCOPE_BATCH_PAYMENT_WRITE = "pagamento-lote.write"
SCOPE_PIX_PAYMENT_WRITE = "pagamento-pix.write"
SCOPE_PIX_PAYMENT_READ = "pagamento-pix.read"
SCOPE_BANKING_WEBHOOK_READ = "webhook-banking.read"
SCOPE_BANKING_WEBHOOK_WRITE = "webhook-banking.write"
SCOPE_COB_READ = "cob.read"
SCOPE_COB_WRITE = "cob.write"
SCOPE_COBV_READ = "cobv.read"
SCOPE_COBV_WRITE = "cobv.write"
SCOPE_COBV_BATCH_WRITE = "lotecobv.write"
SCOPE_COBV_BATCH_READ = "lotecobv.read"
SCOPE_PIX_READ = "pix.read"
SCOPE_PIX_WRITE = "pix.write"
SCOPE_LOCATION_READ = "payloadlocation.read"
SCOPE_LOCATION_WRITE = "payloadlocation.write"
SCOPE_PIX_WEBHOOK_READ = "webhook.read"
SCOPE_PIX_WEBHOOK_WRITE = "webhook.write"

ALL_INTER_SCOPES = (
    SCOPE_BILLING_READ,
    SCOPE_BILLING_WRITE,
    SCOPE_STATEMENT_READ,
    SCOPE_BOLETO_PAYMENT_READ,
    SCOPE_BOLETO_PAYMENT_WRITE,
    SCOPE_DARF_PAYMENT_WRITE,
    SCOPE_BATCH_PAYMENT_READ,
    SCOPE_BATCH_PAYMENT_WRITE,
    SCOPE_PIX_PAYMENT_WRITE,
    SCOPE_PIX_PAYMENT_READ,
    SCOPE_BANKING_WEBHOOK_READ,
    SCOPE_BANKING_WEBHOOK_WRITE,
    SCOPE_COB_READ,
    SCOPE_COB_WRITE,
    SCOPE_COBV_READ,
    SCOPE_COBV_WRITE,
    SCOPE_COBV_BATCH_WRITE,
    SCOPE_COBV_BATCH_READ,
    SCOPE_PIX_READ,
    SCOPE_PIX_WRITE,
    SCOPE_LOCATION_READ,
    SCOPE_LOCATION_WRITE,
    SCOPE_PIX_WEBHOOK_READ,
    SCOPE_PIX_WEBHOOK_WRITE,
)
