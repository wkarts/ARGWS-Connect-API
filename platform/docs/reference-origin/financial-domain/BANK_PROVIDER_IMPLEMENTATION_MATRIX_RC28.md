# Matriz de implementação bancária — rc.28

Data de verificação documental: 2026-08-23.

Esta matriz é o contrato de evidência da rc.28. **Catálogo não é driver.** `DIRECT_API`, `CNAB` e `OPEN_FINANCE` continuam sendo modos de integração. Um provider somente é marcado como `IMPLEMENTED` quando existe executor real e o contrato usado pelo código está sustentado por documentação oficial.

## Executores instalados

| Provider | Estado técnico | Capabilities efetivas | Evidência principal |
|---|---|---|---|
| SANDBOX | IMPLEMENTED | ambiente determinístico interno | provider de testes ARGWS |
| ASAAS | IMPLEMENTED | cobrança/boleto/Pix/Pix Automático conforme adapter existente | https://docs.asaas.com/ |
| EFI | IMPLEMENTED | PIX_COB | https://dev.efipay.com.br/docs/api-pix/ |
| BANRISUL | IMPLEMENTED | PIX_COB | https://developers.banrisul.com.br/pages/docs/clientes-banrisul/api-pix-v2.8.1.html |
| SICREDI | IMPLEMENTED | PIX_COB | https://developer.sicredi.com.br/api-portal/sites/default/files/Guia_tecnico_integracoes_APIPix_Sicredi_v1.9.5.pdf |
| PICPAY | IMPLEMENTED | PIX_COB | https://developers-business.picpay.com/pix/docs/api/charge-pix |
| MERCADO_PAGO | IMPLEMENTED | PIX_COB | https://www.mercadopago.com.br/developers/pt/docs/checkout-api-orders/payment-integration/pix |
| PAGBANK | IMPLEMENTED | PIX_COB | https://developer.pagbank.com.br/docs/pix |
| STONE | IMPLEMENTED | BALANCE, STATEMENT, PIX_COB | https://docs.openbank.stone.com.br/docs/guias/token-de-acesso/ |
| INTER | IMPLEMENTED | BALANCE, STATEMENT, PIX_COB | https://developers.inter.co/references/banking e https://developers.inter.co/references/pix |
| SANTANDER | IMPLEMENTED | PIX_COB | https://developer.santander.com.br/sites/default/files/2024-01/User_Guide_API_PIX_Recebimentos_v11_15_01_24.pdf |
| BRADESCO | IMPLEMENTED | PIX_COB | https://wspf.bradesco.com.br/wsValidadorUniversal/Content/Pdf/Layout_API_PIX.pdf |
| BS2 | IMPLEMENTED | PIX_COB | https://devs.bs2.com/docs/primeirospassos e referência Pix/QR oficial |
| CAIXA | IMPLEMENTED | PIX_COB | https://www.caixa.gov.br/empresa/pagamentos-recebimentos/recebimentos/pix-automatico/Documents/api-pix-automatico-manual-tecnico.pdf |
| BANCO_DO_NORDESTE | IMPLEMENTED | PIX_COB | https://portal.dev.bnb.gov.br/product/12/api/8 |

Nenhum desses novos executores é automaticamente `SANDBOX_VERIFIED`, `HOMOLOGATED` ou `PRODUCTION_READY`. Credenciais reais de homologação/produção continuam necessárias para promoção de maturidade.

### Particularidade do Inter

Os recursos Banking/Pix, hosts de recurso, scopes, certificado e credenciais de integração são públicos. A URL/wire OAuth de token, porém, não ficou exposta de forma estável no portal público na revisão atual. Em vez de inventar endpoint, o executor exige `token_url`, `oauth_client_auth` (`BASIC`/`BODY`) e `oauth_body_mode` (`FORM`/`JSON`) conforme onboarding oficial. O host informado precisa pertencer a domínio oficial Inter.

### Particularidade do Santander

A rc.28 implementa somente Pix Cob do produto Pix Recebimentos. Boleto, DDA, transferências e Pix Automático não entram no manifest efetivo enquanto os contratos próprios não forem implementados e testados.

### Particularidade do Bradesco

O manual oficial da API Pix publica OAuth2 Client Credentials com `Authorization: Basic`, `grant_type=client_credentials`, conexão mTLS, token/base de homologação, base Pix de produção e o contrato de cobrança imediata. O executor fixa homologação em `qrpix-h.bradesco.com.br` e produção em `qrpix.bradesco.com.br`. Como o manual público consultado não fixa de forma inequívoca o endpoint completo de token de produção, `production_token_url` deve vir do onboarding e só é aceito em HTTPS no host oficial de produção.

### Particularidade do BS2

O portal oficial BS2 publica OAuth2 Client Credentials com Basic, `grant_type=client_credentials`, scope por aplicação e as rotas Pix de QR Code Dinâmico e cobrança por TxId. Os hosts efetivos não são publicados de forma fixa porque são fornecidos por ambiente no onboarding; por isso `token_url` e `resource_base_url` são campos obrigatórios da conexão, aceitos somente em HTTPS sob `*.bs2.com` ou `*.bancobonsucesso.com.br`. Em produção o `user_agent` fornecido pelo banco é obrigatório. A criação usa o QR Code Dinâmico para obter o copia-e-cola retornado pelo BS2 e mantém o TxId como identificador externo para consulta/remoção.

### Particularidade da CAIXA

A documentação oficial do Convênio Pix Automático publica as bases de Sandbox/Produção, Grant Client Credentials e o contrato BCB para `PUT/GET/PATCH /cob/{txid}`. O Token Endpoint e a forma final de envio das credenciais dependem do onboarding. O executor exige `token_url`, `oauth_client_auth` e `oauth_body_mode` explicitamente, restringe o Token Endpoint a HTTPS sob domínio oficial CAIXA e usa os nomes documentais `cliente_id`/`cliente_secret` apenas quando a conexão declara autenticação `BODY`.

### Particularidade do Banco do Nordeste

A referência OAS3 BNB publica `PUT/GET/PATCH /cob/{txid}` e as bases `api-h.bnb.gov.br/pix/v1` e `api.bnb.gov.br/pix/v1`. O portal também confirma API Key + Secret por aplicação, mas não publica de forma inequívoca os nomes de headers usados no produto. Por isso `api_key_header` e `api_secret_header` são dados de onboarding obrigatórios; o executor não presume nomes IBM API Connect ou qualquer header de terceiros.

## Providers mantidos bloqueados — contrato público insuficiente para executor fiel

| Provider | Estado | Motivo objetivo / próximo requisito |
|---|---|---|
| BANCO_DO_BRASIL | HOMOLOGATION_REQUIRED | OAuth, Sandbox, Client ID/Secret e app-key são públicos, porém a referência atual das APIs negociais consultada no portal não ficou acessível de forma suficiente para fechar endpoint/payload/resposta do produto escolhido. Implementar quando o contrato do produto estiver publicamente acessível ou for fornecido pelo onboarding. |
| ITAU | HOMOLOGATION_REQUIRED | Portal público cataloga APIs; contrato operacional detalhado do produto depende de aplicação/onboarding. |
| SICOOB | HOMOLOGATION_REQUIRED | Portal informa criação de aplicação/credenciais, mas o wire completo público de autenticação Pix e endpoints não ficou verificável sem cadastro. Não inferir Keycloak/headers a partir de terceiros. |
| C6 | HOMOLOGATION_REQUIRED | Portal Developers existe, porém contrato completo do produto depende de credenciamento/login. |
| BTG_PACTUAL | HOMOLOGATION_REQUIRED | Portal Developers existe, mas detalhes operacionais necessários ao executor dependem de onboarding/acesso. |
| BANCO_DA_AMAZONIA | HOMOLOGATION_REQUIRED | Sem contrato DIRECT_API público completo validado; modo CNAB permanece dependente do convênio/layout homologado. |
| BRB | HOMOLOGATION_REQUIRED | Sem contrato DIRECT_API público completo validado; Open Finance não é convertido em driver proprietário. |
| SAFRA | HOMOLOGATION_REQUIRED | Sem contrato DIRECT_API público completo validado nesta revisão. |
| DAYCOVAL | HOMOLOGATION_REQUIRED | Sem contrato DIRECT_API público completo validado nesta revisão. |
| MERCANTIL | HOMOLOGATION_REQUIRED | Sem contrato DIRECT_API público completo validado nesta revisão. |

## Regras de segurança e operação

1. `BankConnection` continua sendo dono das credenciais do tenant/empresa.
2. Control Plane armazena somente metadados, governança e entitlements.
3. Novos executores nascem globalmente desabilitados; ASAAS/SANDBOX preservam o comportamento legado.
4. Não existe fallback genérico capaz de transformar um manifest em executor HTTP.
5. Endpoint, host, autenticação, scope e payload não são copiados entre instituições.
6. CNAB só é anunciado como homologado após validação do manual e do convênio específico.
7. Open Finance é um modo regulado e não substitui a API proprietária da instituição.
8. Status de maturidade só sobe com evidência de sandbox/homologação/produção.
9. Parâmetros recebidos do onboarding só são aceitos quando pertencem a allowlist/domínio oficial e quando a documentação pública sustenta o restante do contrato.
10. Um provider pode ser `IMPLEMENTED` e continuar globalmente bloqueado até que o Control Plane o libere para um plano/tenant e exista homologação real da conexão.

## Evidências oficiais adicionais verificadas

- Banco do Brasil — segurança/OAuth: https://apoio.developers.bb.com.br/guias-e-tutoriais/seguranca/visao-geral
- Banco do Brasil — Sandbox/app-key: https://apoio.developers.bb.com.br/guias-e-tutoriais/primeiros-passos/testes-sandbox
- Inter — Banking: https://developers.inter.co/references/banking
- Inter — Pix: https://developers.inter.co/references/pix
- Inter — credenciais/token: https://developers.inter.co/duvidas-frequentes
- Inter — changelog: https://developers.inter.co/changelog
- Santander — API Pix Recebimentos: https://developer.santander.com.br/sites/default/files/2024-01/User_Guide_API_PIX_Recebimentos_v11_15_01_24.pdf
- Bradesco — API Pix: https://wspf.bradesco.com.br/wsValidadorUniversal/Content/Pdf/Layout_API_PIX.pdf
- Bradesco — Developers: https://developers.bradesco.com.br/
- BS2 — Primeiros Passos: https://devs.bs2.com/docs/primeirospassos
- BS2 — OAuth token: https://devs.bs2.com/reference/post_auth-oauth-v2-token-1
- BS2 — QR Dinâmico: https://devs.bs2.com/reference/post_pix-direto-forintegration-v1-qrcodes-dinamico
- BS2 — Cob consulta: https://devs.bs2.com/reference/get_pix-direto-forintegration-v1-cob-txid
- BS2 — Cob revisão: https://devs.bs2.com/reference/patch_pix-direto-forintegration-v1-cob-txid
- CAIXA — Pix Automático: https://www.caixa.gov.br/empresa/pagamentos-recebimentos/recebimentos/pix-automatico/Paginas/default.aspx
- CAIXA — Documento Técnico da API: https://www.caixa.gov.br/empresa/pagamentos-recebimentos/recebimentos/pix-automatico/Documents/api-pix-automatico-manual-tecnico.pdf
- CAIXA — Documento Técnico do Convênio: https://www.caixa.gov.br/empresa/pagamentos-recebimentos/recebimentos/pix-automatico/Documents/documento-tecnico-convenio-pix-automatico.pdf
- Sicoob — Portal Developers: https://developers.sicoob.com.br/portal/
- Banco do Nordeste — API Pix: https://portal.dev.bnb.gov.br/product/12/api/8
- Banco do Nordeste — uso das APIs: https://portal.dev.bnb.gov.br/node/3
- Banco do Nordeste — Apps/API Key e Secret: https://portal.dev.bnb.gov.br/index.php/node/4
- Stone — autenticação: https://docs.openbank.stone.com.br/docs/guias/token-de-acesso/
- Stone — Pix Cob: https://docs.openbank.stone.com.br/docs/referencia-da-api/pix/apis-padrao/cob/criar-cobranca/
- Stone — saldo/extrato: https://docs.openbank.stone.com.br/sandbox/docs/referencia-da-api/dados-da-conta/contas-vinculadas/

Esta lista de bloqueios é intencional: ela impede que a interface comercialize uma integração que só existe em catálogo ou em documentação incompleta.
