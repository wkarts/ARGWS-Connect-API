# Provider EFI — Connect|API Platform

Provider executável da Efí introduzido na `1.0.0-rc.27`.

## Escopo desta implementação

Esta primeira implementação suporta exclusivamente **Pix Cob imediata** por `DIRECT_API`.

Operações implementadas pelo adapter:

- autenticação OAuth2 Client Credentials com HTTP Basic;
- mTLS com certificado cliente PEM + chave privada;
- criação de cobrança imediata com `PUT /v2/cob/:txid`;
- consulta de cobrança com `GET /v2/cob/:txid`;
- remoção pelo recebedor com `PATCH /v2/cob/:txid`;
- health check não financeiro por autenticação OAuth2+mTLS.

O manifest anuncia apenas `PIX_COB`, porque as demais APIs da Efí ainda não possuem adapter e testes locais nesta release.

## Status

- Driver: `IMPLEMENTED`
- Sandbox/homologação verificada com credenciais reais: **não**
- Produção verificada: **não**
- Homologação comercial: **pendente**
