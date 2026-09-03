# Release Notes — v1.0.0-rc.28

A rc.28 continua diretamente a arquitetura bancária capability-based consolidada nas rc.26/rc.27. Não há recomeço, migração destrutiva, alteração das credenciais existentes ou promoção artificial de catálogo para driver.

## Novos executores independentes

Além de `SANDBOX`, `ASAAS` e `EFI`, esta release instala:

- `BANRISUL` — Pix Cob imediata;
- `SICREDI` — Pix Cob imediata com mTLS;
- `PICPAY` — Pix Cob via API Pix/Charge;
- `MERCADO_PAGO` — Pix via Orders API;
- `PAGBANK` — Pix via Orders/QR Codes;
- `STONE` — saldo, extrato e Pix Cob;
- `INTER` — saldo, extrato enriquecido/scroll e Pix Cob;
- `SANTANDER` — Pix Cob imediata com OAuth2 + mTLS;
- `BRADESCO` — Pix Cob imediata com OAuth2 Basic + mTLS;
- `BS2` — Pix Cob via QR Code Dinâmico/API Banking;
- `CAIXA` — Pix Cob imediata na API Pix do Convênio Pix Automático;
- `BANCO_DO_NORDESTE` — Pix Cob imediata na API Pix 1.0.0.

Cada provider possui executor e manifest próprios. Utilitários de transporte/autenticação podem ser compartilhados pelo core, porém host, autenticação, credenciais, paths e payloads continuam definidos por instituição.

## Inter

O executor Inter usa os recursos oficiais de Banking e Pix:

- `GET /banking/v2/saldo`;
- `GET /banking/v2/extrato/completo` com suporte a scroll;
- `PUT/GET/PATCH /pix/v2/cob/{txid}`.

O portal público confirma Client ID/Secret, certificado/chave, token reutilizável e scopes por produto, porém a URL/wire do endpoint OAuth não ficou exposta de forma estável na revisão atual. Para não inventar contrato, a conexão Inter exige `token_url`, `oauth_client_auth` e `oauth_body_mode` conforme onboarding oficial. A URL só é aceita em domínio oficial Inter.

Os scopes são solicitados por operação: `extrato.read` para Banking e `cob.read`/`cob.write` para Pix Cob.

## Santander

O executor Santander implementa somente Pix Cob a partir do User Guide oficial de Pix Recebimentos:

- OAuth2 Client Credentials + certificado cliente/mTLS;
- endpoints oficiais separados de homologação e produção;
- `PUT/GET/PATCH /api/v1/cob/{txid}`.

Boleto, DDA, transferências e Pix Automático permanecem fora das capabilities efetivas até que seus contratos específicos sejam implementados e testados.

## Bradesco

O manual oficial de API Pix sustenta:

- OAuth2 Client Credentials;
- HTTP Basic com `client_id:client_secret`;
- `grant_type=client_credentials` em form-urlencoded;
- conexão mTLS;
- token de homologação `https://qrpix-h.bradesco.com.br/oauth/token`;
- API Pix de homologação em `https://qrpix-h.bradesco.com.br/v2`;
- API Pix de produção em `https://qrpix.bradesco.com.br/v2`;
- contrato de cobrança imediata `/cob/{txid}`.

A URL completa do token de produção não é inferida quando não estiver explicitamente documentada: `production_token_url` deve vir do onboarding e é limitada ao host oficial `qrpix.bradesco.com.br`.

## BS2

O portal oficial BS2 publica OAuth2 Client Credentials com HTTP Basic, `grant_type=client_credentials`, scope por aplicação, o recurso de QR Code Dinâmico e as operações de consulta/revisão por TxId.

A rc.28 usa:

- `POST /pix/direto/forintegration/v1/qrcodes/dinamico` para criar a cobrança e obter o QR/copia-e-cola retornado pelo BS2;
- `GET /pix/direto/forintegration/v1/cob/{txId}` para consultar;
- `PATCH /pix/direto/forintegration/v1/cob/{txId}` para remoção.

Os hosts efetivos de homologação/produção são entregues no onboarding; `token_url` e `resource_base_url` são obrigatórios e só aceitam HTTPS em domínios oficiais BS2/Banco Bonsucesso. Em produção, o `user_agent` fornecido pelo banco também é obrigatório.

## CAIXA

O executor CAIXA usa as bases publicadas no documento técnico do Convênio Pix Automático:

- Sandbox: `https://api.caixa.gov.br:8443/sandbox/servicos-bancarios/requisicoes/pix-automatico`;
- Produção: `https://api.caixa.gov.br:8443/servicos-bancarios/requisicoes/pix-automatico`;
- `PUT /cob/{txid}` — criar cobrança imediata;
- `GET /cob/{txid}` — consultar cobrança;
- `PATCH /cob/{txid}` — alterar/remover cobrança.

A documentação oficial confirma Grant Client Credentials, `cliente_id`, `cliente_secret`, scope por Swagger e recomendação de `http_user_agent` não genérico. Como o wire completo do Token Endpoint depende do onboarding e não foi publicado de forma inequívoca na referência consultada, `token_url`, `oauth_client_auth` e `oauth_body_mode` são parâmetros explícitos do `BankConnection`; o token URL só aceita HTTPS em domínio oficial CAIXA. O core OAuth ganhou suporte retrocompatível a nomes de campos por provider, preservando os defaults existentes.

## Banco do Nordeste

A referência OAS3 oficial BNB 1.0.0 publica:

- homologação: `https://api-h.bnb.gov.br/pix/v1/`;
- produção: `https://api.bnb.gov.br/pix/v1/`;
- `PUT /cob/{txid}`;
- `GET /cob/{txid}`;
- `PATCH /cob/{txid}`.

O Developer Portal confirma que aplicações recebem API Key e Secret. Os nomes dos headers não são publicados de forma inequívoca; portanto `api_key_header` e `api_secret_header` são informados pelo onboarding e validados sintaticamente. O driver não presume `X-IBM-Client-Id`, `X-IBM-Client-Secret` ou qualquer outro header proprietário.

## Governança preservada

A migration `0008_bank_provider_governance` da rc.27 continua sendo suficiente. Não há migration nova.

O Control Plane descobre os novos manifests automaticamente e mantém a precedência:

1. executor instalado;
2. disponibilidade global;
3. override do tenant;
4. política do plano.

Novos providers continuam nascendo globalmente bloqueados até liberação administrativa explícita.

## Segurança

- credenciais permanecem em `BankConnection` no banco do tenant;
- certificados/chaves nunca são gravados no Control Plane;
- arquivos PEM temporários usam permissão 0600 e são apagados ao fim da chamada mTLS;
- hosts possuem allowlist HTTPS;
- Inter aceita `token_url` de onboarding somente sob domínio oficial;
- Bradesco aceita token de produção fornecido pelo onboarding somente no host oficial;
- BS2 aceita hosts de onboarding somente sob domínios oficiais e não envia header de idempotência não documentado;
- CAIXA aceita Token Endpoint de onboarding somente sob `*.caixa.gov.br` e não presume BASIC/BODY ou FORM/JSON;
- BNB exige nomes de headers explícitos do onboarding e rejeita nomes sintaticamente inseguros;
- Sicredi não recebe URL de homologação inferida: as URLs do credenciamento são obrigatórias nesse ambiente;
- Stone usa JWT RS256/client assertion e idempotência própria do banco;
- Mercado Pago/PagBank usam os headers de idempotência documentados por seus contratos;
- QR/BR Code não é sintetizado localmente quando o provider não o retorna.

## Providers não promovidos

Banco do Brasil, Itaú, Sicoob, C6, BTG Pactual, Banco da Amazônia, BRB, Safra, Daycoval e Mercantil permanecem catalogados/bloqueados enquanto faltar parte essencial do contrato público de execução ou o produto depender de onboarding fechado sem referência suficiente para endpoint + autenticação + payload + resposta.

A justificativa por instituição está em `docs/BANK_PROVIDER_IMPLEMENTATION_MATRIX_RC28.md`.

## Homologação

`IMPLEMENTED` significa executor escrito e contrato oficial mapeado. Não significa automaticamente `SANDBOX_VERIFIED`, `HOMOLOGATED` ou `PRODUCTION_READY`.

A promoção exige credenciais reais do cliente/instituição e evidências de autenticação, chamadas positivas/negativas, certificados, rate limit e comportamento do ambiente correspondente.
