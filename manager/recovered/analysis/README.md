# Manager recovered — análise de componentes

Arquivos extraídos automaticamente do bundle legado formatado. Eles ainda usam identificadores minificados e não são o fonte final.

## Mapeamentos confirmados

- `Fse` → landing page raiz do Manager.
- `Dse` → página de login do Manager.
- `CZ` → lista principal de instâncias.
- `PX` → dashboard da instância.
- `Lse` → tabela principal de rotas React Router.
- `Dae` → labels pt-BR da sidebar, incluindo os links públicos legados.
- `sn` → cliente HTTP utilizado pelo login e pelos serviços recuperados.
- `UM` / `VM` → contexto e provider da instância.
- `zM`, `j5`, `Vb` → header, sidebar da instância e footer.
- `iM` / `lM` → seletores de idioma e tema, recuperados para aplicação futura da política pt-BR-first.

Os arquivos `route-component-map.json`, `architecture-hints.json`, `dependency-graph.json` e `dependency-candidates.json` documentam as rotas e as dependências recuperadas que serão renomeadas durante a reconstrução.

## Regra desta fase

Esses arquivos servem como prova e referência para reconstrução. O `manager/dist` de produção não é substituído nesta etapa.
