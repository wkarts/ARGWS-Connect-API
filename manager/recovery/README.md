# Connect|API Manager — recuperação de fonte

Este diretório contém o processo de recuperação controlada do Manager legado a partir dos artefatos compilados presentes em `manager/dist`.

## Regra de isolamento

Todo o trabalho desta recuperação permanece na branch `recovery/manager-source-v1`.

- **não alterar `develop`;**
- não substituir o `manager/dist` utilizado atualmente;
- não promover a reconstrução para `main` antes de existir build reproduzível e validação funcional;
- preservar os artefatos legados como referência de comportamento até o fim da reconstrução.

## Objetivo

A primeira fase **não altera o comportamento do Manager em produção**. Ela cria uma cópia legível dos bundles atuais para permitir auditoria, identificação de componentes, rotas, strings, integrações e posterior reconstrução em módulos fonte.

## Fonte canônica desta fase

- `manager/dist/index.html`
- bundle JavaScript principal referenciado por esse HTML
- bundle CSS principal referenciado por esse HTML

## Saída gerada

O workflow `Manager Source Recovery` cria progressivamente:

```text
manager/recovered/
├── legacy/
│   ├── index.js
│   └── index.css
├── analysis/
│   ├── pages/
│   ├── layout/
│   ├── router/
│   ├── i18n/
│   ├── inventory.json
│   └── route-component-map.json
└── recovery-report.json
```

O `recovery-report.json` registra checksum, rotas encontradas, URLs externas, links `mailto`, funções nomeadas, referências de source map e sinais hardcoded relevantes.

## Política de idioma

A reconstrução terá **pt-BR como idioma primário e único idioma habilitado por padrão**.

Os recursos legados em `en-US`, `es-ES` e `fr-FR` podem permanecer recuperados no código para preservar informação e permitir uso futuro, porém devem ficar indisponíveis enquanto a habilitação explícita não estiver ativa.

Contrato previsto por ambiente:

```env
MANAGER_DEFAULT_LOCALE=pt-BR
MANAGER_ENABLE_EXTRA_LOCALES=false
MANAGER_EXTRA_LOCALES=en-US,es-ES,fr-FR
```

Regras:

1. com `MANAGER_ENABLE_EXTRA_LOCALES=false`, apenas `pt-BR` pode ser utilizado;
2. o seletor de idioma deve ficar oculto/desabilitado nesse modo;
3. definir `MANAGER_DEFAULT_LOCALE=en-US`, por exemplo, **não habilita** inglês sozinho;
4. idiomas adicionais somente podem ser usados quando `MANAGER_ENABLE_EXTRA_LOCALES=true`;
5. mesmo com idiomas adicionais habilitados, `pt-BR` permanece sempre disponível;
6. valores desconhecidos em `MANAGER_EXTRA_LOCALES` devem ser ignorados;
7. qualquer configuração inválida deve cair com segurança para `pt-BR`.

O utilitário `generate-runtime-config.mjs` já materializa esse contrato em `window.__ARGWS_CONNECT_MANAGER_CONFIG__`, para que a futura aplicação React possa ler configuração de runtime sem depender exclusivamente de variáveis de build do Vite.

## Importante

Desminificação não é equivalente à recuperação perfeita do código-fonte original. Sem source maps não é possível recuperar automaticamente nomes originais de arquivos, variáveis locais, comentários removidos e fronteiras exatas dos módulos. A recuperação será feita em etapas, preservando comportamento antes de modularizar.

## Fases seguintes

Os componentes estão sendo extraídos gradualmente antes de serem promovidos para `manager/src`:

1. roteamento e bootstrap;
2. landing/home;
3. login e sessão;
4. layout/header/sidebar/footer;
5. dashboard de instância;
6. serviços HTTP e realtime;
7. integrações e configurações;
8. i18n e política pt-BR-first;
9. componentes compartilhados e dependências;
10. build Vite reproduzível;
11. comparação funcional entre bundle legado e build reconstruído;
12. somente então substituição controlada do `manager/dist`.

Nenhuma substituição do `manager/dist` deve ocorrer antes de o build recuperado ser validado contra o comportamento atual.
