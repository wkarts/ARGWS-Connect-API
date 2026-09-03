# Santander — executor Pix rc.28

Provider independente `SANTANDER` implementado sobre o Banking Provider Framework existente.

## Capability efetiva

- `PIX_COB` — cobrança imediata via `PUT /api/v1/cob/{txid}`, consulta `GET` e remoção `PATCH`.

## Ambientes

- homologação: `trust-pix-h.santander.com.br`;
- produção: `trust-pix.santander.com.br`.

## Autenticação

OAuth 2.0 Client Credentials com certificado cliente/mTLS, usando os endpoints de token publicados no User Guide oficial da API Pix Recebimentos.

## Fora do escopo efetivo desta release

Boleto, DDA, TED, Pix transferência e Pix Automático existem no portfólio Santander, porém não são anunciados como capabilities deste executor até que seus contratos próprios sejam implementados e testados.

## Maturidade

O status permanece `IMPLEMENTED`. Homologação e produção exigem credenciais reais, certificado válido e evidência de chamadas positivas/negativas antes de qualquer promoção para `HOMOLOGATED` ou `PRODUCTION_READY`.
