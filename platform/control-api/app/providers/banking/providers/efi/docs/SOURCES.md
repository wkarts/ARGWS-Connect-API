# Fontes oficiais — EFI

Verificadas em 2026-08-23.

- https://dev.efipay.com.br/docs/api-pix/credenciais/
- https://dev.efipay.com.br/docs/api-pix/cobrancas-imediatas/
- https://dev.efipay.com.br/docs/api-pix/payload-locations/

OAuth2 Client Credentials usa HTTP Basic, `POST /oauth/token` e certificado cliente P12/PEM obrigatório também na autorização. Bases oficiais: `https://pix.api.efipay.com.br` (produção) e `https://pix-h.api.efipay.com.br` (homologação).

Pix Cob imediata documenta `PUT /v2/cob/:txid`, `GET /v2/cob/:txid` e `PATCH /v2/cob/:txid`, com escopos `cob.write`/`cob.read`.

Nenhum endpoint, escopo ou autenticação desta implementação foi inferido de outro provider.
