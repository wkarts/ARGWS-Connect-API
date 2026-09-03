# Banco Inter — provider rc.31

O provider `INTER` usa diretamente o contrato HTTP publicado pelo Banco Inter. A aplicação **não depende da SDK oficial em runtime**; o repositório `inter-co/pj-sdk-python` é utilizado como fonte oficial de endpoints, scopes, ambientes, autenticação e payloads.

## Autenticação

Contrato oficial confirmado no SDK:

- OAuth2 Client Credentials;
- `POST /oauth/v2/token`;
- `application/x-www-form-urlencoded`;
- corpo com `client_id`, `client_secret`, `grant_type=client_credentials` e `scope`;
- certificado cliente mTLS no token e nas APIs;
- `x-conta-corrente` somente quando a integração possui mais de uma conta.

O tenant informa apenas `client_id`, `client_secret`, certificado, chave privada e, quando necessário, conta corrente/chave Pix. `token_url`, forma de autenticação e formato do token **não são parâmetros livres**.

## Ambientes oficiais

- Produção: `https://cdpj.partners.bancointer.com.br`
- UAT/Homologação: `https://cdpj.partners.uatbi.com.br`
- Sandbox: `https://cdpj-sandbox.partners.uatinter.co`

## Capabilities implementadas

- `BALANCE`
- `STATEMENT` — extrato básico/enriquecido e PDF
- `BOLETO_CREATE`
- `BOLETO_GET`
- `BOLETO_CANCEL`
- `BOLETO_HYBRID`
- `PIX_COB`
- `PIX_COBV`
- `PIX_RECEIVED`
- `PIX_PAYMENT`
- `PIX_REFUND`
- `PIX_WEBHOOK`
- `PAYMENT_BOLETO`
- `PAYMENT_TAX` — DARF
- `PAYMENT_BATCH`

Também estão implementadas as superfícies administrativas publicadas pela SDK: locations Pix, lotes CobV, callbacks de webhook Pix/Billing/Banking e consulta de pagamentos.

## Segurança de transporte

O cliente Inter possui allowlist exclusiva dos hosts oficiais. Headers privados da Connect|API Platform (`Idempotency-Key`/`X-Correlation-ID`) não são enviados ao banco porque não fazem parte do contrato publicado pelo Inter. Escritas não documentadas como idempotentes não recebem retry automático.

Tokens OAuth são mantidos somente em memória do processo, por client/ambiente/scopes, até próximo do vencimento. Client secret não é armazenado em claro no identificador do cache.

## Estado de homologação

`IMPLEMENTED` significa que o executor existe e os contratos foram implementados a partir da documentação/SDK oficial. A rc.31 **não marca** `SANDBOX_VERIFIED`, `HOMOLOGATED` ou `PRODUCTION_READY` sem credenciais reais e evidência de homologação do cliente.

## Ciclo de vida no tenant

Contas bancárias, convênios e conexões podem ser criados e editados. Exclusão física é permitida apenas quando o cadastro nunca foi utilizado operacionalmente. Após transação, cobrança, remessa, operação ou sincronização, o registro deve ser desativado e preservado para auditoria.
