# Integração da interface principal

Este documento é técnico e não faz parte da interface apresentada ao usuário.

## Objetivo desta entrega

A nova interface foi integrada ao projeto atual sem alterar o código funcional do backend.

- `src/` do backend permanece idêntico ao ZIP `ARGWS-Connect-API-develop (9).zip`;
- schemas e migrations permanecem idênticos;
- `package.json` e `package-lock.json` da raiz permanecem idênticos;
- o único ajuste fora de `manager/` é no `Dockerfile`, para instalar as dependências do frontend antes de gerar o bundle;
- a interface continua sendo servida pela própria API em `/manager/`;
- o código anterior da interface foi preservado integralmente em `manager-legacy/`.

## Compatibilidade atual

A interface possui uma camada de adaptação em:

```text
src/services/current.ts
src/services/normalizers.ts
src/types/domain.ts
```

As telas não dependem diretamente das respostas brutas do backend. Quando a nova evolução do backend entrar, a troca deve ser feita principalmente nessa camada, preservando as telas e o design system.

## Acessos

No mesmo domínio da API:

```text
https://d.api.connect.argws.com.br/manager/
```

No domínio dedicado:

```text
https://d.manager.connect.argws.com.br/
```

Para o domínio dedicado existe o exemplo:

```text
deploy/develop/nginx-frontend-domain.conf.example
```

Quando a interface está no domínio dedicado, ela identifica automaticamente o domínio irmão da API (`d.manager...` -> `d.api...`). Também é possível sobrescrever internamente o endereço antes do carregamento definindo `window.__CONNECT_API_BASE_URL__`.

## Acesso atual

Como o backend atual ainda utiliza o código administrativo global, a tela chama esse valor apenas de **Código de acesso**. Ele fica somente em `sessionStorage` durante a sessão do navegador.

Quando a nova camada de autenticação estiver disponível, a interface já possui o modo de compatibilidade `service`, permitindo substituir a integração sem reconstruir as telas.
