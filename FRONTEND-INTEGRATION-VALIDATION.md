# Validação da integração do frontend principal

## Preservação do backend

Comparado com `ARGWS-Connect-API-develop (9).zip`:

- `src/`: idêntico;
- `prisma/`: idêntico;
- `package.json` da raiz: idêntico;
- `package-lock.json` da raiz: idêntico;
- interface anterior: preservada integralmente em `manager-legacy/`.

A única alteração fora da pasta do frontend é no `Dockerfile` da raiz para instalar as dependências da nova interface antes do build já existente de `/manager/`.

## Identidade visual

Nenhuma nova marca, logo, favicon ou símbolo de produto foi criado. A interface usa arquivos já existentes no projeto de origem:

- `manager/public/favicon.ico`;
- `manager/public/favicon.svg`;
- `manager/public/apple-touch-icon.png`;
- ícones PWA existentes;
- `public/argws-connect-logo-horizontal.svg`;
- `public/argws-connect-logo-dark.svg`;
- símbolo compacto já existente na interface anterior.

## Integração atual

A camada `src/services/current.ts` usa os contratos já existentes da API para: acesso, instâncias, QR Code, pareamento, conversas, mensagens, contatos, chamadas e saúde.

A interface não depende diretamente das respostas brutas; `normalizers.ts` converte os formatos atuais para modelos estáveis.

## Linguagem visível

`npm run check:language` impede termos internos conhecidos nos templates. O nome exibido do produto é somente `Connect|API`.

## Validações locais executadas

- sintaxe TypeScript dos módulos e blocos `<script setup>`;
- imports locais;
- linguagem visível;
- JSONs da nova interface;
- preservação byte a byte do backend e da interface anterior;
- identidade visual comparada por conteúdo;
- presença das rotas atuais consumidas pelo adaptador.

## Build completo

O ambiente usado para empacotar esta entrega não possui resolução DNS para o registro npm, portanto a instalação das dependências e o `vite build` não puderam ser executados localmente. Os Dockerfiles foram preparados para instalar as dependências durante o build normal da imagem/CI.
