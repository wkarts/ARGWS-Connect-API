# Banking Providers, Boleto, PIX e CNAB

## Estado da entrega

A plataforma inclui um `BankingProvider` estável e um provider `SANDBOX` funcional. Ele gera identificadores determinísticos, nosso número, txid, linha digitável simulada, código de barras, PIX copia e cola e PDF para permitir testes ponta a ponta.

Providers bancários reais devem ser implementados/homologados conforme a instituição, produto, carteira e credenciais contratadas.

## Interface

```python
class BankingProvider(Protocol):
    name: str

    async def create_charge(self, request: BankChargeRequest) -> BankChargeResult: ...
    async def cancel_charge(self, external_id: str) -> None: ...
    async def get_charge(self, external_id: str) -> BankChargeResult: ...
```

Registrar um provider em `BankingProviderRegistry` mantém o restante do sistema inalterado.

## Webhook bancário

```text
POST /api/v1/webhooks/banking/{provider}
```

O webhook valida segredo, registra payload idempotente e aplica pagamento somente uma vez.

## CNAB 240

Implementado:

- header de arquivo;
- header de lote;
- segmentos P e Q;
- trailer de lote;
- trailer de arquivo;
- validação de 240 posições;
- codificação ASCII;
- parser básico de segmentos T/U;
- armazenamento e hash;
- proteção contra reimportação.

Cada banco deve especializar campos, carteira, códigos de movimento e ocorrências. O arquivo genérico **não é homologação bancária**.

## CNAB 400

A arquitetura aceita um novo generator/parser no provider do banco. Não há layout universal seguro: cada banco e carteira precisa de implementação e testes com arquivos de homologação.

## Processo de homologação de banco real

1. obter documentação oficial do banco e versão de layout;
2. obter agência, conta, convênio, carteira e código beneficiário;
3. criar credenciais/certificados da API quando aplicável;
4. implementar provider específico;
5. adicionar fixtures oficiais anonimizadas;
6. testar remessa e retorno;
7. validar rejeições;
8. homologar no ambiente do banco;
9. ativar feature flag somente após aceite;
10. manter versão do layout por convênio.

## Segurança

- certificados e tokens criptografados;
- idempotency key por cobrança/evento;
- validação de assinatura de webhook;
- logs sem payload sensível completo;
- reconciliação por nosso número/txid/endToEndId;
- estorno e baixa auditados.


## Hostname dos webhooks bancários

Callbacks bancários devem ser configurados com o domínio ativo do tenant:

```text
https://<slug>.financeiro.exemplo.com.br/api/v1/webhooks/banking/{provider}
```

O `TenantResolver` usa esse hostname para abrir o banco PostgreSQL exclusivo. O segredo do webhook e a idempotência continuam obrigatórios.
