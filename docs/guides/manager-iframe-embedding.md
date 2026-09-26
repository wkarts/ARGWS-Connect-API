# Manager embutido em iframe

O Manager da Connect|API pode ser aberto dentro de um Hub, portal ou console externo sem alterar as rotas normais da API.

## Cadastro de origens

A técnica segue o mesmo princípio usado no PIGE360-self: o ambiente serve apenas como
bootstrap e a configuração persistida pela interface passa a ser a fonte efetiva.

Antes do primeiro salvamento:

```env
MANAGER_IFRAME_ENABLED=true
MANAGER_FRAME_ANCESTORS=*
```

Depois, em **Configurações → Incorporação em iframe**, cadastre as origens exatas:

```text
https://hub-dev.argws.com.br
https://hub.argws.com.br
```

Regras do cadastro:

- uma origem por linha;
- somente HTTPS em produção;
- sem caminho, query, fragmento, credenciais ou curingas;
- máximo de 12 origens;
- duplicidades são normalizadas;
- quando desativado, a política passa a `frame-ancestors 'none'`;
- depois que existe configuração persistida, o `.env` não a substitui.

O endpoint administrativo é protegido pela API key global e não aceita token de instância:

```text
GET /manager-api/v1/embedding
PUT /manager-api/v1/embedding
```

A alteração usa versão otimista para evitar sobrescrever silenciosamente uma edição concorrente.

## Política efetiva

Com o Hub de desenvolvimento cadastrado:

```text
Content-Security-Policy: frame-ancestors 'self' https://hub-dev.argws.com.br
X-Connect-Manager-Embedding: enabled
X-Connect-Manager-Frame-Ancestors: 'self' https://hub-dev.argws.com.br
```

A aplicação não emite `X-Frame-Options` no Manager quando a política é calculada.
`SAMEORIGIN` ou `DENY` impediria um Hub cross-origin.

O Manager consulta a configuração persistida com cache curto para não criar uma query
de banco para cada JS/CSS/imagem. Uma alteração salva invalida a decisão imediatamente.
Em uma falha transitória do banco, a última política conhecida é preservada; antes da
primeira leitura persistida, vale o bootstrap explícito do ambiente.

## Verificação pública

A própria tela possui **Verificar resposta pública**. O teste executa HEAD anônimo em
`/manager/login`, sem enviar a API key, e mostra:

- status HTTP;
- diretiva `frame-ancestors` realmente recebida;
- eventual `X-Frame-Options`;
- estado de embedding informado pela aplicação.

Isso diferencia configuração da aplicação de um header acrescentado depois por proxy.

## Reverse proxies

O deployment CloudPanel inclui:

```text
deploy/cloudpanel/nginx/api-location.conf.example
```

O bloco de `/manager/` não fixa `frame-ancestors *`. Ele apenas neutraliza
`X-Frame-Options` legado e deixa a CSP dinâmica da Connect|API atravessar.

Para outros Nginx/reverse proxies, preserve a mesma ideia:

```nginx
location ^~ /manager/ {
    proxy_pass http://127.0.0.1:38080;
    proxy_hide_header X-Frame-Options;

    # Qualquer add_header local evita herdar, em Nginx tradicional,
    # um add_header X-Frame-Options definido no nível server.
    add_header X-Connect-Manager-Proxy "iframe-policy-from-app" always;
}
```

Não use `proxy_hide_header Content-Security-Policy` nem fixe uma CSP no proxy, pois isso
anularia o cadastro feito pelo Manager.

## CORS não é a política de iframe

`CORS_ORIGIN` controla requisições JavaScript cross-origin. A permissão para exibir a
página em iframe é definida por `Content-Security-Policy: frame-ancestors`.

O Manager em `/manager/` continua falando com a Connect|API no mesmo origin. No modo
`access-code`, a chave validada permanece somente em memória do documento.

## Validação

```bash
curl -sSI https://d.api.connect.argws.com.br/manager/login
```

Confirme que a CSP contém somente `'self'` e as origens cadastradas e que não existe
`X-Frame-Options: SAMEORIGIN` ou `DENY`.

A política se aplica somente ao Manager. WhatsApp, ZAPO, Find Hub, VOIP, webhooks,
RabbitMQ, NATS, Kafka e demais providers não têm fluxo ou latência alterados por esse recurso.
