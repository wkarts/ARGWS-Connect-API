# Connect|API Manager — Arquitetura reconstruída

## Objetivo

O `manager/src` é o fonte operacional do Manager. O diretório `manager/recovered` é apenas evidência/auditoria da recuperação do bundle legado e não participa da execução.

## Organização

```text
manager/
├── src/
│   ├── api/          # contratos HTTP da Connect|API
│   ├── components/   # shell, header, sidebar e elementos compartilhados
│   ├── core/         # DOM, router, sessão e runtime config
│   ├── pages/        # páginas funcionais
│   ├── styles/       # design e responsividade
│   └── main.js       # bootstrap e roteamento da aplicação
├── public/           # branding, PWA e runtime config padrão
├── scripts/          # build, validação, smoke e servidor local
├── dist/             # build gerado a partir do src
└── recovered/        # referência da recuperação; não-runtime
```

## Princípios

- `src` é a única fonte de comportamento do Manager.
- O build é determinístico e não depende do bundle minificado legado.
- Módulos ES nativos reduzem a superfície de dependências e deixam o Manager independente do backend Node.
- Cada domínio possui uma camada API separada de sua página.
- Configuração de implantação é resolvida em runtime, sem rebuild por cliente.
- `pt-BR` é o idioma operacional padrão.
- Idiomas legados podem permanecer disponíveis como capacidade opcional, mas ficam desabilitados por padrão.
- Links públicos de Postman, Discord, GitHub e Suporte Premium não fazem parte da navegação operacional.

## Runtime

O Manager pode rodar embutido em `/manager` ou em imagem Nginx independente.

Variáveis:

```env
MANAGER_API_URL=
ARGWS_CONNECT_DOCS_PUBLIC_URL=https://docs.exemplo.com.br
MANAGER_DOCUMENTATION_URL=
MANAGER_DEFAULT_LOCALE=pt-BR
MANAGER_ENABLE_EXTRA_LOCALES=false
MANAGER_EXTRA_LOCALES=en-US,es-ES,fr-FR
```

Quando `MANAGER_API_URL` está vazio, o login usa a origem atual. O link **Documentação** é exibido somente quando uma URL de documentação existe no runtime ou na resposta da raiz da API.

## Expansão

Para incluir uma nova integração:

1. criar/estender o contrato em `src/api/`;
2. criar a página em `src/pages/` ou registrar a integração em `src/api/integrations.js`;
3. registrar a rota em `src/main.js`;
4. adicionar o item de navegação em `src/components/shell.js`;
5. adicionar testes de contrato em `scripts/smoke.mjs`.

Nenhuma alteração deve ser feita diretamente em `dist`; execute `npm run build`.
