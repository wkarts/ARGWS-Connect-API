# Fontes oficiais — Banco Inter rc.31

Fonte principal auditada: repositório oficial `inter-co/pj-sdk-python`, branch `master`, commit:

`594744c905ca402d9771f943753420ce334eb594`

Arquivos usados como contrato:

- `inter_sdk_python/commons/structures/Constants.py` — endpoints e scopes;
- `inter_sdk_python/commons/utils/TokenUtils.py` — OAuth2 Client Credentials + mTLS;
- `inter_sdk_python/commons/enums/EnvironmentEnum.py` — Production, UAT e Sandbox;
- `inter_sdk_python/commons/utils/HttpUtils.py` — headers e transporte da SDK;
- `inter_sdk_python/banking/**` — saldo, extratos, pagamentos e webhooks Banking;
- `inter_sdk_python/billing/**` — Cobrança v3, PDF, cancelamento, sumário e webhooks;
- `inter_sdk_python/pix/**` — Cob, CobV, lotes, Pix recebidos, devoluções, locations e webhooks.

Links oficiais:

- https://github.com/inter-co/pj-sdk-python
- https://github.com/inter-co

O código Connect|API não importa a SDK. Qualquer divergência futura entre este provider e o contrato oficial deve gerar revisão do manifest e dos testes antes de alteração de status/readiness.
