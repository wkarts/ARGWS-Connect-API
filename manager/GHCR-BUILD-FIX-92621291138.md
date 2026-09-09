# Correção do build GHCR — execução 92621291138

## Causa confirmada pelos logs

O build falhava durante a validação do frontend, antes da geração das imagens finais.

Foram identificados dois erros objetivos:

1. Quinze componentes `.vue` tinham o fechamento `</script>` na mesma linha do código TypeScript.
   O `vue-tsc` passou a interpretar o fechamento como parte do TypeScript e gerou erros `TS1005`.
2. `tsconfig.node.json` habilitava `allowImportingTsExtensions` sem `noEmit`, causando `TS5096`.

Além disso, foi corrigido preventivamente um ponto em `src/services/connect.ts` que poderia produzir
`TS2556` assim que os erros de parsing anteriores fossem eliminados.

## Correções aplicadas

- normalização dos blocos `<script setup lang="ts">` para estrutura SFC válida;
- `noEmit: true` em `tsconfig.node.json`;
- separação do type-check:
  - `vue-tsc --noEmit -p tsconfig.app.json`
  - `tsc --noEmit -p tsconfig.node.json`
- adaptador `connect.ts` tipado e sem spread incompatível;
- novo `check:sfc` para impedir regressão do mesmo problema;
- nenhuma alteração funcional no backend;
- nenhum asset de marca, logo, favicon ou ícone do projeto foi recriado.

## Validações locais possíveis neste ambiente

- `npm run check:language`: OK
- `npm run check:sfc`: OK
- parsing TypeScript dos scripts extraídos dos SFCs: OK
- comparação de arquivos fora de `manager/` com o pacote anterior: idênticos

O build completo de Vite depende da instalação das dependências npm, realizada normalmente no GHCR.
