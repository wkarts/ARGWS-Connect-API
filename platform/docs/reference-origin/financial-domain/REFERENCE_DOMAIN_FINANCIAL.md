# REFERENCE_DOMAIN_FINANCIAL.md

Os componentes abaixo representam o domínio financeiro do projeto de origem e **não devem ser considerados parte obrigatória do template genérico**.

Principais áreas a remover/substituir na especialização:
- `backend/app/providers/banking/`
- rotas `control_banking*`, `tenant_banking*`, `tenant_cnab*`, `tenant_pix_automatic*`, `tenant_finance*`, `public_finance*`
- models `banking*.py`
- serviços/repositórios/migrations ligados exclusivamente a banking, CNAB, Pix, cobrança, recebíveis, pagamentos e reconciliação
- páginas Vue Banking/CNAB/Pix/Charges/Payments/Receivables/Reconciliation/PublicPayment/Fiscal
- documentação `docs/financial/` e integrações bancárias específicas

Não apague por wildcard sem revisar dependências. Extraia primeiro qualquer código de infraestrutura reutilizável.
