# Commit sugerido

## Título

feat(branding): consolida identidade visual Connect|API em todo o projeto

## Descrição

Consolida a identidade visual oficial Connect|API em todos os assets de runtime e públicos do projeto, preservando paths técnicos legados apenas como aliases de compatibilidade.

- substitui logos e símbolos antigos em `public/`, `public/images/` e `manager/dist/`;
- atualiza PNG, SVG, ICO e derivados PWA para o conceito Connect|API;
- adiciona biblioteca canônica de assets `core`, `docs`, `pbx` e `voip`;
- adiciona variantes PNG, SVG e JPEG light/dark para uso futuro;
- mantém arquivos não relacionados ao branding, como PicPay e capa de vídeo;
- não altera services Docker, GHCR, banco, tabelas, migrations, providers, enums ou rotas.

Mudança visual e de organização de assets, sem alteração funcional da API.
