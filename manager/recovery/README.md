# Connect|API Manager — recuperação de fonte

Este diretório contém o processo de recuperação controlada do Manager legado a partir dos artefatos compilados presentes em `manager/dist`.

## Objetivo

A primeira fase **não altera o comportamento do Manager em produção**. Ela cria uma cópia legível dos bundles atuais para permitir auditoria, identificação de componentes, rotas, strings, integrações e posterior reconstrução em módulos fonte.

## Fonte canônica desta fase

- `manager/dist/index.html`
- bundle JavaScript principal referenciado por esse HTML
- bundle CSS principal referenciado por esse HTML

## Saída gerada

O workflow `Manager Source Recovery` cria:

```text
manager/recovered/
├── legacy/
│   ├── index.js     # bundle JavaScript formatado, sem minificação visual
│   └── index.css    # CSS formatado
└── recovery-report.json
```

O `recovery-report.json` registra checksum, rotas encontradas, URLs externas, links `mailto`, funções nomeadas, referências de source map e sinais hardcoded relevantes.

## Importante

Desminificação não é equivalente à recuperação perfeita do código-fonte original. Sem source maps não é possível recuperar automaticamente nomes originais de arquivos, variáveis locais, comentários removidos e fronteiras exatas dos módulos. A recuperação será feita em etapas, preservando comportamento antes de modularizar.

## Próxima fase

Depois que `manager/recovered/legacy/index.js` estiver disponível e auditado, os componentes serão extraídos gradualmente para `manager/src`, começando por:

1. roteamento e bootstrap;
2. landing/home;
3. login e sessão;
4. layout/header/sidebar/footer;
5. dashboard de instância;
6. serviços HTTP e realtime;
7. integrações e configurações;
8. traduções;
9. build Vite reproduzível.

Nenhuma substituição do `manager/dist` deve ocorrer antes de o build recuperado ser validado contra o comportamento atual.
