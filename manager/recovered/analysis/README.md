# Manager recovered — análise de componentes

Arquivos extraídos automaticamente do bundle legado formatado. Eles ainda usam identificadores minificados e não são o fonte final.

## Mapeamentos confirmados

- `Fse` → landing page raiz do Manager.
- `Dse` → página de login do Manager.
- `CZ` → lista principal de instâncias.
- `PX` → dashboard da instância.
- `Lse` → tabela principal de rotas React Router.
- `Dae` → labels pt-BR da sidebar, incluindo os links públicos legados.

Os arquivos `route-component-map.json` e `architecture-hints.json` documentam as rotas e as dependências recuperadas que serão renomeadas durante a reconstrução.

## Regra desta fase

Esses arquivos servem como prova e referência para reconstrução. O `manager/dist` de produção não é substituído nesta etapa.
