# Connect|API DOCs — Topologia oficial de deployment

## DOCs integradas por ambiente

| Ambiente | Porta local DOCs | Imagem | URL pública padrão |
|---|---:|---|---|
| Production | `38180` | `ghcr.io/wkarts/argws-connect-docs:latest` | `https://docs.connect.argws.com.br` |
| Homologation | `38181` | `ghcr.io/wkarts/argws-connect-docs:develop` | `https://docs.connect.argws.com.br` |
| Develop | `38182` | `ghcr.io/wkarts/argws-connect-docs:develop` | `https://d.docs.connect.argws.com.br` |
| Canonical | `38183` | `ghcr.io/wkarts/argws-connect-docs:<SemVer>` | `https://docs.connect.argws.com.br` |

CloudPanel e Dockge seguem o canal estável e apontam por padrão para `https://docs.connect.argws.com.br` quando a publicação pública independente estiver habilitada.

## DOCs standalone / always-on

### Produção

- diretório: `deploy/docs/`;
- porta: `38280`;
- imagem: `ghcr.io/wkarts/argws-connect-docs:latest`;
- hostname: `https://docs.connect.argws.com.br`.

### Desenvolvimento

- diretório: `deploy/docs-develop/`;
- porta: `38282`;
- imagem: `ghcr.io/wkarts/argws-connect-docs:develop`;
- hostname: `https://d.docs.connect.argws.com.br`.

## Documentação interna do Manager

A stack completa não exige um hostname público separado para exibir a documentação dentro do Manager. O service DOCs permanece privado na network Docker e a API disponibiliza um endpoint **same-origin**:

```text
/manager/docs/
```

O fluxo é:

```text
Navegador
  └── /manager/docs/*
        └── API / Manager Router
              └── ARGWS_CONNECT_DOCS_INTERNAL_URL
                    └── service DOCs privado :8080
```

Configuração padrão da stack de produção:

```env
ARGWS_CONNECT_DOCS_INTERNAL_URL=http://docs-argws-connect-production:8080
ARGWS_CONNECT_DOCS_INTERNAL_BASE_PATH=/manager/docs
MANAGER_FEATURE_DOCS=true
```

`ARGWS_CONNECT_DOCS_INTERNAL_URL` é exclusivamente uma URL de rede interna entre containers. Ela não é enviada ao navegador e não deve apontar para um hostname público.

O prefixo `/manager/docs` pertence ao endpoint da API. Ao encaminhar a requisição ao container DOCs, esse prefixo é removido e o recurso é solicitado a partir da raiz do service. Isso vale para HTML, OpenAPI, AsyncAPI, manifesto, service worker, ícones e demais assets relativos.

Redirecionamentos originados pelo service privado são reescritos novamente para `/manager/docs/...`, preservando o mesmo domínio da instalação. Assim o Manager não precisa conhecer porta Docker, nome de container ou hostname de documentação.

## Acesso interno e público

Os services DOCs integrados pertencem à mesma network Docker do respectivo ambiente e podem ser alcançados por outros containers através do DNS interno do Compose.

Na stack completa de produção, o service integrado pode usar apenas `expose: 8080`; a documentação do Manager continua disponível pelo endpoint `/manager/docs/` da própria instalação. A publicação externa em hostname dedicado é opcional e independente desse acesso interno.

Os contratos Scalar usam URLs relativas `openapi/...`. Com isso, a mesma imagem funciona:

- diretamente em `http://127.0.0.1:<porta>/` nos perfis que publicam uma porta local;
- em hostname dedicado, como `https://docs.connect.argws.com.br/`;
- dentro do Manager em `/manager/docs/`, através do proxy same-origin que remove o prefixo antes de encaminhar ao container.

## URL pública da API usada pelo Scalar

O servidor exibido pelo Scalar e utilizado pelas operações interativas (`Try It`) é resolvido em runtime pela variável já existente `SERVER_URL`.

Exemplo de produção white-label:

```env
SERVER_URL=https://api.connect.fersofterp.com.br
ARGWS_CONNECT_DOCS_PUBLIC_URL=https://docs.connect.fersofterp.com.br
```

O container de DOCs recebe `SERVER_URL` do ambiente e aplica a URL sem recompilar a imagem:

- REST API: `SERVER_URL`;
- Meta Compatible: `SERVER_URL/graph`;
- Events/AsyncAPI: não é alterado por essa regra.

A mesma imagem `ghcr.io/wkarts/argws-connect-docs:latest` pode, portanto, ser reutilizada por ARGWS, Fersoft ou outro deployment sem carregar no seletor `Server` a URL de outro ambiente. Se `SERVER_URL` estiver ausente ou vazia, a documentação mantém os servidores presentes no contrato estático como fallback.

## Publicação externa opcional

A URL pública independente pode ser configurada com:

```env
ARGWS_CONNECT_DOCS_PUBLIC_URL=https://docs.connect.argws.com.br
```

No canal `develop`, quando desejado:

```env
ARGWS_CONNECT_DOCS_PUBLIC_URL=https://d.docs.connect.argws.com.br
```

Essa variável controla somente a publicação/descoberta da documentação pública independente. Quando estiver ausente ou vazia:

- a resposta `GET /` não precisa publicar a propriedade `documentation`;
- nenhum fallback para GitHub ou outro endereço externo é criado;
- a documentação **interna** do Manager continua disponível em `/manager/docs/` quando `MANAGER_FEATURE_DOCS=true` e o service DOCs interno estiver saudável.

Quando `ARGWS_CONNECT_DOCS_PUBLIC_URL` possuir uma URL não vazia, ela pode ser publicada em `GET /` para consumidores externos sem alterar o endpoint interno do Manager.

O frontend do Manager deve navegar exclusivamente para a rota relativa `/manager/docs/`. Ele não deve conhecer `ARGWS_CONNECT_DOCS_INTERNAL_URL`, portas Docker ou nomes internos de services.