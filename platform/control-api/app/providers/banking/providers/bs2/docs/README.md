# Banco BS2 — executor Pix rc.28

Provider independente `BS2` implementado sobre o Banking Provider Framework existente.

## Capability efetiva

- `PIX_COB` — criação de QR Code dinâmico BS2, consulta da cobrança por TxId e remoção via revisão da cobrança.

## Autenticação

A documentação oficial do BS2 define OAuth2 Client Credentials com:

- `Authorization: Basic base64(client_id:client_secret)`;
- `grant_type=client_credentials` em `application/x-www-form-urlencoded`;
- `scope` liberado para a aplicação;
- token obtido em `/auth/oauth/v2/token` no host entregue pelo ambiente.

Os hosts/base URLs de homologação e produção são entregues pelo onboarding e, por isso, ficam em `token_url` e `resource_base_url`. O driver aceita apenas HTTPS em domínios oficiais `*.bs2.com` ou `*.bancobonsucesso.com.br`.

Em produção, `user_agent` é obrigatório conforme a documentação do BS2.

## Pix Cob

Criação utiliza o modelo BS2 de QR Code dinâmico:

`POST /pix/direto/forintegration/v1/qrcodes/dinamico`

O TxId é mantido como identificador externo da cobrança para que consulta e remoção usem o mesmo contrato:

- `GET /pix/direto/forintegration/v1/cob/{txId}`;
- `PATCH /pix/direto/forintegration/v1/cob/{txId}` com status de remoção do usuário recebedor.

O endpoint de QR Code retorna o código copia-e-cola quando disponibilizado pelo BS2; ele não é sintetizado pela Connect|API Platform.

## Maturidade

`IMPLEMENTED` indica executor real e contrato documentado. Homologação e produção exigem credenciais reais e evidência operacional antes de promoção de status.
