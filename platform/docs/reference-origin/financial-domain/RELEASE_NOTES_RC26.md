# Release Notes — v1.0.0-rc.26

A rc.26 inicia a migração segura da camada bancária existente para um **Banking Provider Framework orientado a capabilities**, sem remover Asaas, Sandbox, CNAB, Pix Automático, OFX/CSV, webhooks ou conciliação existentes.

## Princípios desta release

- instituição financeira é diferente de provider/canal de integração;
- catálogo não significa API implementada;
- somente executores com contrato técnico conhecido podem ser conectados;
- nenhum endpoint bancário é inventado para preencher a matriz;
- credenciais continuam criptografadas e nunca retornam pelo frontend;
- operações externas não são automaticamente tratadas como fatos financeiros;
- valores financeiros permanecem `Decimal` no domínio;
- convênios e credenciais legados continuam compatíveis durante a migração.

## Núcleo capability-based

Foram introduzidos:

- `BankingCapability`;
- `BankingIntegrationMode`;
- `BankingEnvironment`;
- `ProviderStatus`;
- `ProviderManifest`;
- schema dinâmico de credenciais;
- contratos normalizados de conta, saldo, extrato, boleto, Pix, Pix Automático, pagamentos, transferências, devoluções e webhooks;
- `BankingProviderContext`;
- normalização de erros;
- cliente HTTP com proteção SSRF, timeouts, pooling, Retry-After, backoff/jitter e circuit breaker;
- métricas Prometheus de baixa cardinalidade;
- cofre compatível com `secret_cipher`;
- metadata de certificados.

## Persistência

### Platform DB

Migration `0007_bank_institution_catalog`:

- `bank_institutions`.

O catálogo pode ser sincronizado a partir do dataset oficial do Banco Central do Brasil. As sementes derivadas de manifests são marcadas como provisórias e não substituem a fonte oficial.

### Tenant DB

Migration `0005_banking_provider_framework`:

- adiciona `ispb` e `institution_id` em `bank_accounts`;
- cria `bank_connections`;
- adiciona vínculo opcional de `bank_agreements` com conexão;
- cria `bank_sync_states`;
- cria `bank_operations` para idempotência local;
- amplia `bank_transactions` com provider/txid/referência/origem;
- amplia `webhook_events` com conexão e headers sanitizados.

A migration é aditiva e reversível.

## Providers

Executores preservados/instalados:

- `SANDBOX` — somente desenvolvimento/testes;
- `ASAAS` — adapter progressivo sobre a implementação existente.

O catálogo também representa as instituições/providers obrigatórios do escopo, porém sem executor quando a implementação/homologação ainda não está comprovada. Estados como `CATALOG_ONLY` e `HOMOLOGATION_REQUIRED` são intencionais e impedem que a interface venda uma integração fictícia.

## BankingGateway

Nova fachada central responsável por:

- resolver conexão e provider;
- abrir credenciais em memória;
- validar environment/capability;
- executar health-check seguro;
- consultar saldo/extrato apenas quando o executor implementa o contrato;
- normalizar respostas;
- atualizar estado da conexão;
- gerar auditoria e Outbox.

O `BillingService` passa a preferir `BankConnection` quando o convênio estiver vinculado, preservando `BankAgreement.encrypted_credentials` como fallback legado.

## Frontend

A área bancária passa a utilizar um hub com:

- conexões API;
- contas/convênios/CNAB legados preservados;
- matriz de suporte gerada pelos manifests;
- catálogo de instituições;
- credential schema dinâmico;
- teste de conexão;
- situação/último sucesso/erro sanitizado;
- certificado e validade;
- ações de saldo/sincronização somente quando a capability é anunciada.

## Conciliação

Novo `ReconciliationEngine` usa `BankTransaction` real e separa evidência de efeito econômico.

Prioriza identificadores fortes:

- `endToEndId`;
- `txid`;
- provider payment/charge id;
- nosso número;
- referência bancária/documento.

Critérios auxiliares incluem valor, pagador e proximidade de data. Ambiguidades ficam como `AMBIGUOUS`; apenas vínculo inequívoco com pagamento já existente pode ser `AUTO_MATCHED`. O motor não cria uma segunda baixa financeira.

## Webhooks

O endpoint externo permanece compatível:

`POST /api/v1/webhooks/banking/{provider}`

O novo router exige handler específico por provider. O Asaas possui verifier/parser/processor próprio. Providers apenas catalogados não podem usar o parser genérico legado para causar efeito financeiro.

## Versão

`1.0.0-rc.26`
