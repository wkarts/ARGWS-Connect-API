# Banco Mercantil — provider CNAB240 rc.29

Verificação documental: 2026-08-25.

## Estado técnico

- Provider: `MERCANTIL`
- Instituição: Banco Mercantil do Brasil S.A.
- Código bancário: `389`
- Estado do driver: `IMPLEMENTED`
- Modo implementado: `CNAB`
- Capability efetiva: `CNAB_240`
- `DIRECT_API`: não implementado
- `OPEN_FINANCE`: catalogado como modo institucional, sem executor nesta release
- Homologação: pendente
- Produção: não liberada automaticamente

## Escopo implementado

O adapter implementa Cobrança Escritural CNAB240 do Banco Mercantil no escopo inicial conservador:

- versão de layout de arquivo `040`;
- versão de layout de lote `040`;
- carteira `1` — Cobrança Simples com Registro;
- movimento de remessa `01` — entrada de título;
- Header de Arquivo;
- Header de Lote;
- Segmento P;
- Segmento Q;
- Trailer de Lote;
- Trailer de Arquivo;
- retorno com Segmentos T e U;
- Nosso Número enviado zerado na entrada para atribuição pelo banco;
- preservação do controle interno da empresa em campo próprio.

Não são anunciados nesta capability inicial: juros, desconto, IOF, abatimento, protesto, mensagens/segmentos opcionais, outras carteiras ou API HTTP.

## Fontes oficiais

1. Banco Mercantil — Cobrança Escritural — Layout CNAB 240 com mensagens:  
   https://bancomercantil.com.br/Empresas/Cobranca/Documentos%20Compartilhados/CobrancaCNAB240Mensagens.pdf
2. Banco Mercantil — Cobrança / Office Banking:  
   https://bancomercantil.com.br/empresas/office-banking/cobranca

O manual oficial define os mapas posicionais de Header/Lote/P/Q/Trailers e retorno T/U. A operação real continua condicionada ao contrato e à homologação de arquivo do cliente junto ao Banco Mercantil.

## Isolamento

O provider é independente. Não reutiliza endpoint, credencial, webhook, carteira ou parametrização de outro banco. Por ser `CNAB`-only, não pode gerar `BankConnection` e não aparece como executor `DIRECT_API`.
