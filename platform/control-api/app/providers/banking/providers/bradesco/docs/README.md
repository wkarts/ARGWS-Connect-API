# Bradesco — executor Pix rc.28

Provider independente `BRADESCO` implementado sobre o Banking Provider Framework existente.

## Capability efetiva

- `PIX_COB` — contrato de cobrança imediata `PUT/GET/PATCH /cob/{txid}`.

## Homologação

O manual oficial publica:

- OAuth2 Client Credentials;
- `Authorization: Basic base64(client_id:client_secret)`;
- `grant_type=client_credentials` em `application/x-www-form-urlencoded`;
- conexão mTLS com certificado cliente;
- token de homologação `https://qrpix-h.bradesco.com.br/oauth/token`;
- base Pix de homologação `https://qrpix-h.bradesco.com.br/v2`;
- base Pix de produção `https://qrpix.bradesco.com.br/v2`.

## Produção

O manual público consultado fixa a base Pix de produção, mas não fixa de forma inequívoca o endpoint completo de token de produção. Assim, `production_token_url` é obrigatório quando a conexão estiver em produção e só é aceito em HTTPS no host `qrpix.bradesco.com.br`.

## Maturidade

O status é `IMPLEMENTED`. Não é `HOMOLOGATED` nem `PRODUCTION_READY` sem credenciais reais e evidência operacional.
