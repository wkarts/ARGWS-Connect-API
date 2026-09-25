# Manager embutido em iframe

O Manager da Connect|API pode ser aberto dentro de um Hub, portal ou console externo sem alterar as rotas normais da API.

## Configuração

Por padrão a aplicação permite incorporação:

```env
MANAGER_IFRAME_ENABLED=true
MANAGER_FRAME_ANCESTORS=*
```

`*` permite qualquer origem HTTP/HTTPS. Para restringir:

```env
MANAGER_IFRAME_ENABLED=true
MANAGER_FRAME_ANCESTORS='self' https://hub-dev.argws.com.br https://hub.argws.com.br
```

Para bloquear novamente:

```env
MANAGER_IFRAME_ENABLED=false
```

A política é aplicada somente ao router do Manager. APIs, webhooks, WhatsApp, ZAPO, Find Hub, VOIP e demais providers não recebem alteração de latência, autenticação ou fluxo por causa desse recurso.

## Headers esperados

Uma página como:

```text
https://d.api.connect.argws.com.br/manager/login
```

deve responder com:

```text
Content-Security-Policy: frame-ancestors *
X-Connect-Manager-Embedding: enabled
X-Connect-Manager-Frame-Ancestors: *
```

A aplicação remove `X-Frame-Options` de sua própria resposta, pois `SAMEORIGIN` e `DENY` impedem Hub cross-origin.

## Reverse proxies

Um proxy externo pode inserir `X-Frame-Options: SAMEORIGIN` depois que a Connect|API já respondeu corretamente. Nesse caso a correção precisa ocorrer nessa camada.

O deployment CloudPanel inclui um exemplo específico em:

```text
deploy/cloudpanel/nginx/api-location.conf.example
```

Ele trata `/manager/` separadamente, elimina o bloqueio legado e publica `frame-ancestors *`.

Para outros Nginx/reverse proxies, a regra equivalente é:

```nginx
location ^~ /manager/ {
    proxy_pass http://127.0.0.1:38080;
    proxy_hide_header X-Frame-Options;
    proxy_hide_header Content-Security-Policy;

    add_header Content-Security-Policy "frame-ancestors *" always;
    add_header X-Connect-Manager-Embedding "enabled" always;
}
```

Se o vhost pai possuir `add_header X-Frame-Options SAMEORIGIN`, remova essa diretiva para `/manager/` ou defina a política no nível da location de modo que o header pai não seja herdado.

## CORS não é a política de iframe

`CORS_ORIGIN` controla requisições JavaScript cross-origin. Quem decide se a página pode aparecer dentro de um iframe é principalmente `Content-Security-Policy: frame-ancestors` e, em stacks legadas, `X-Frame-Options`.

O Manager servido em `/manager/` continua falando com a Connect|API no próprio origin. No modo `access-code`, a chave validada permanece somente em memória do documento; o iframe não depende de cookie de terceiro para esse fluxo.

## Validação

```bash
curl -sSI https://d.api.connect.argws.com.br/manager/login
```

Confirme:

1. `Content-Security-Policy` contém `frame-ancestors *` ou a origem autorizada;
2. não existe `X-Frame-Options: SAMEORIGIN` nem `DENY`;
3. `X-Connect-Manager-Embedding: enabled` está presente.

Se o header `X-Frame-Options` continuar aparecendo, a origem é um reverse proxy, CDN ou WAF posterior à aplicação.
