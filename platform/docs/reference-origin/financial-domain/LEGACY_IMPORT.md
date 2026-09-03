# Importação do FINANCEIRO Vitor

A plataforma inclui importador específico para o padrão histórico analisado no arquivo `FINANCEIRO Vitor.zip`.

## Fontes reconhecidas

- planilha de honorários;
- relação de boletos;
- relação de recibos;
- planilha de notas;
- planilha de contatos.

## Resultado de validação do arquivo de referência

```text
Competência identificada: 2026-07
Registros consolidados: 319
Honorários: 317
Boletos: 188
Recibos: 145
Notas: 37
Contatos: 43
```

Os dados originais não são distribuídos dentro do projeto.

## Fluxo

```text
Tenant Plane -> Importações -> Financeiro Vitor
```

1. selecione a empresa emissora;
2. envie o ZIP;
3. execute a prévia;
4. revise totais e divergências;
5. confirme a importação;
6. consulte auditoria e entidades criadas.

## Segurança

- limite de tamanho;
- rejeição de path traversal;
- rejeição de caminhos absolutos;
- limite de expansão do ZIP;
- leitura somente de extensões esperadas;
- SHA-256 do arquivo incluído na prévia e na auditoria;
- deduplicação determinística por contrato e competência;
- nenhuma execução de macro;
- importação vinculada ao tenant e à empresa autorizada.

## Mapeamento

O importador consolida nome/documento/valor/contato e indicadores de boleto, recibo e nota. Registros não identificados são preservados na prévia para correção antes da gravação.
