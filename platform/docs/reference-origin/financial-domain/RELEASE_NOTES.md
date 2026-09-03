# Release Notes — v1.0.0-rc.31

A `rc.31` conclui a evolução do provider **Banco Inter** a partir do contrato oficial `inter-co/pj-sdk-python` e libera o ciclo de vida seguro de contas bancárias, convênios e conexões no tenant.

## Banco Inter — contrato oficial completo

O provider `INTER` não depende da SDK em runtime. O repositório oficial `inter-co/pj-sdk-python`, branch `master`, commit `594744c905ca402d9771f943753420ce334eb594`, foi usado para fixar endpoints, scopes, ambientes, autenticação e estruturas de payload.

### Autenticação oficial

- OAuth2 Client Credentials;
- `POST /oauth/v2/token`;
- body `application/x-www-form-urlencoded`;
- `client_id`, `client_secret`, `grant_type=client_credentials`, `scope`;
- certificado cliente mTLS;
- `x-conta-corrente` somente quando aplicável.

Os antigos campos livres `token_url`, `oauth_client_auth` e `oauth_body_mode` deixam de fazer parte do schema de credenciais do Inter. O protocolo pertence ao driver do banco, não ao tenant.

### Ambientes

- Produção: `https://cdpj.partners.bancointer.com.br`;
- Homologação/UAT: `https://cdpj.partners.uatbi.com.br`;
- Sandbox: `https://cdpj-sandbox.partners.uatinter.co`.

### Capabilities executáveis

- `BALANCE`;
- `STATEMENT` — básico/enriquecido e PDF;
- `BOLETO_CREATE`;
- `BOLETO_GET`;
- `BOLETO_CANCEL`;
- `BOLETO_HYBRID`;
- `PIX_COB`;
- `PIX_COBV`;
- `PIX_RECEIVED`;
- `PIX_PAYMENT`;
- `PIX_REFUND`;
- `PIX_WEBHOOK`;
- `PAYMENT_BOLETO`;
- `PAYMENT_TAX` — DARF;
- `PAYMENT_BATCH`.

A superfície Inter também contém Cob/CobV e suas listagens/revisões, lotes CobV, locations, Billing v3, PDF/sumário/cancelamento, Pix recebidos e devoluções, pagamentos de boleto/DARF/Pix, lotes de pagamento e administração/callbacks de webhooks Banking/Billing/Pix.

### Transporte e segurança

- hosts restritos aos três domínios oficiais Inter;
- credenciais continuam criptografadas no `BankConnection` do tenant/empresa;
- token OAuth é reutilizado em memória por ambiente/client/scopes até próximo do vencimento;
- headers internos ARGWS não são enviados ao Inter quando não fazem parte do contrato oficial;
- escrita sem idempotência oficialmente publicada não recebe retry automático;
- provider Inter nunca compartilha parâmetros, conta, credenciais, endpoints ou webhooks com outro provider.

### Status

O driver permanece `IMPLEMENTED` e `requires_homologation=true`. A release não promove `SANDBOX_VERIFIED`, `HOMOLOGATED` nem `PRODUCTION_READY` sem execução com credenciais oficiais e evidência de homologação.

## Tenant — ciclo de vida bancário seguro

Contas bancárias, convênios e conexões passam a ter administração completa pelo tenant.

### Conta bancária

- criar;
- editar;
- ativar/desativar;
- excluir definitivamente apenas se nunca utilizada e sem vínculos.

A exclusão é bloqueada quando houver convênio, conexão, transação ou importação de extrato associada. Registros com histórico permanecem inativos em vez de serem apagados.

### Convênio

- criar;
- editar;
- ativar/desativar;
- excluir apenas quando nunca utilizado.

Cobranças, remessas CNAB, Pix Automático ou consumo de numeração bancária tornam o convênio histórico e impedem hard-delete.

### BankConnection

- criar;
- editar credenciais/settings/ambiente;
- ativar/desativar;
- excluir apenas antes da primeira operação/sincronização bem-sucedida.

A instituição continua consequência do provider e da conta. Provider e conta de bancos diferentes continuam bloqueados pelo hardening existente.

## Interface

As telas **Conexões bancárias** e **Contas, convênios e CNAB** passam a exibir a ação de exclusão somente quando o backend confirma `can_delete=true`. Quando há histórico, a interface explica que o cadastro deve ser desativado para preservar auditoria.

## Compatibilidade

- nenhuma migration destrutiva;
- nenhum segredo movido para o Control Plane;
- dados e conexões Asaas preservados;
- providers anteriores preservados;
- ciclo de vida é aditivo;
- registros históricos existentes não são apagados automaticamente.

## Documentação oficial Banco Inter

- https://github.com/inter-co/pj-sdk-python
- https://github.com/inter-co
- `inter_sdk_python/commons/structures/Constants.py`
- `inter_sdk_python/commons/utils/TokenUtils.py`
- `inter_sdk_python/commons/enums/EnvironmentEnum.py`
- módulos `banking`, `billing` e `pix` da SDK oficial.

## Release e imagens

Versão canônica: `1.0.0-rc.31`.

Após o merge, o contrato de release da rc.30 continua obrigatório e deve produzir/verificar:

```text
ghcr.io/YOUR_ORG/YOUR_APP-api:1.0.0-rc.31
ghcr.io/YOUR_ORG/YOUR_APP-web:1.0.0-rc.31
ghcr.io/YOUR_ORG/YOUR_APP-gateway:1.0.0-rc.31
ghcr.io/YOUR_ORG/YOUR_APP-acme:1.0.0-rc.31
ghcr.io/YOUR_ORG/YOUR_APP-cloudpanel-agent:1.0.0-rc.31
```

A PR só deve ser mesclada após Release Contract, backend, frontend, validações estruturais, cinco builds Docker e smoke end-to-end verdes. Após merge, `Publish Release`, `Verify Published Release` e `Verify Published Images` devem comprovar a publicação.
