# Conversational Application Studio — Phase 6

A Phase 6 expande o Template Studio do Connect|API para aplicações conversacionais orientadas a dados, mantendo o contrato de template lógico independente do provider.

## Princípios de arquitetura

- **Meta Compatible continua sendo uma fachada/protocolo**, não um provider.
- Os providers continuam sendo `WHATSAPP-BUSINESS`, `WHATSAPP-BAILEYS` e `CONNECT`.
- `components` permanece reservado ao contrato de Template Meta/Connect já existente.
- Recursos adicionais da Phase 6 ficam em `policy.interactionsV2` e `policy.microApps`.
- LIST/CHOICE nunca são injetados artificialmente em `components` Meta.
- O planner canônico decide o transporte real por provider antes do envio.
- O preview continua sem efeitos colaterais e usa o mesmo planner do runtime.

## Interaction Model v2

O modelo canônico fica em `policy.interactionsV2`:

```json
{
  "interactionsV2": {
    "version": 2,
    "items": [
      {
        "type": "LIST",
        "id": "appointment_list",
        "title": "Agendamentos",
        "body": "Escolha um atendimento",
        "buttonText": "Ver agenda",
        "source": {
          "path": "api.appointments",
          "id": "{{item.id}}",
          "title": "{{item.date}} · {{item.service}}",
          "description": "{{item.status}}",
          "sectionTitle": "Disponíveis",
          "capture": { "path": "selection" }
        }
      }
    ]
  }
}
```

### LIST

LIST aceita seções/linhas estáticas ou uma coleção dinâmica proveniente das variáveis do template. Cada linha possui um `id` canônico, título, descrição opcional e pode capturar a resposta em uma variável de sessão.

### CHOICE

CHOICE representa seleção única ou múltipla. O transporte pode virar botão, lista, poll ou texto conforme o provider. A lógica da aplicação continua ligada ao mesmo `id` lógico.

## Data Mapper

Uma `source` resolve um array presente nas variáveis fornecidas ao template. O mapper não faz requisições HTTP sozinho; a aquisição dos dados continua sendo responsabilidade de Actions/Recipes ou do chamador. Isso mantém credenciais e networking fora do template.

Campos principais:

- `path`: caminho seguro do array, por exemplo `api.appointments`;
- `id`: template para o identificador, por exemplo `{{item.id}}`;
- `title`: texto da opção;
- `description`: texto complementar opcional;
- `sectionTitle`: título de seção para LIST;
- `capture`: destino da seleção;
- `binding`: Action/Recipe opcional executada após a resposta.

O servidor recompõe bindings Phase 6 a partir de `policy.interactionsV2` durante create/edit. Dessa forma, editores legados que conhecem apenas QUICK_REPLY não conseguem apagar a lógica de LIST/CHOICE.

## Transporte por provider

### WHATSAPP-BUSINESS

- template: provider-native;
- LIST: `META_LIST` por mensagem interativa separada;
- CHOICE: botão ou lista Meta conforme quantidade de opções;
- Micro App: link HTTPS gerado pelo Connect|API.

O payload do template Meta não recebe extensões proprietárias.

### WHATSAPP-BAILEYS

- QUICK_REPLY lógico permanece em `BAILEYS_OFFICIAL_POLL` quando aplicável;
- CHOICE single usa poll oficial;
- LIST permanece em fallback textual seguro;
- não é reintroduzido `nativeFlowMessage` no caminho de templates.

### CONNECT

- CHOICE com até três opções usa `buttonMessage`;
- LIST permanece em fallback textual enquanto o provider não declarar suporte canônico;
- Micro Apps funcionam por URL HTTPS.

## Preview

`POST /template/preview/{instanceName}` aceita `policy` em drafts e devolve:

- `provider`;
- `capabilities`;
- `transport`/`plan`;
- template renderizado;
- `rendered.interactions`;
- plano individual de cada interação;
- `sideEffectFree: true`.

Para providers locais, o preview persistido lê diretamente o template solicitado e não cria templates padrão.

## Micro Apps

Micro Apps são aplicações HTTPS multipágina vinculadas ao `policy` de um template. O estado não é serializado na URL: a URL contém somente um token HMAC opaco e expirável; os dados ficam server-side no cache existente (Redis/local) com fallback de memória do processo.

Definição mínima:

```json
{
  "microApps": {
    "version": 1,
    "apps": [
      {
        "key": "checkin",
        "title": "Check-in",
        "startPage": "identify",
        "ttlSeconds": 900,
        "accessMode": "CONVERSATION_SESSION",
        "pages": [
          {
            "key": "identify",
            "captureRoot": "form",
            "components": [
              { "type": "INPUT", "id": "name", "label": "Nome" }
            ],
            "next": "location"
          }
        ]
      }
    ]
  }
}
```

### Componentes do runtime

O runtime suporta texto, imagem, input, data/hora, select/list, radio, checkbox, tabela e localização. A edição JSON avançada permanece disponível para contratos mais complexos e transições condicionais.

### Sessão

Criação autenticada:

`POST /micro-app/session/{instanceName}`

Corpo:

```json
{
  "templateName": "checkin_start",
  "language": "pt_BR",
  "appKey": "checkin",
  "number": "5575999999999",
  "variables": {},
  "ttlSeconds": 900
}
```

Resposta contém `token`, `url`, `expiresAt`, `appKey` e `pageKey`.

Rotas públicas protegidas pelo token assinado/expirável:

- `GET /micro-app/{token}` — shell HTML;
- `GET /micro-app/runtime.js` — runtime;
- `GET /micro-app/state/{token}` — estado público sanitizado;
- `POST /micro-app/submit/{token}` — avanço/retorno de página.

A criação de sessão continua protegida pelos guards da instância. As rotas públicas não exigem API key na URL.

### Segurança do Micro App

- HMAC SHA-256;
- TTL entre 60 segundos e 24 horas;
- `no-store`/`no-cache`;
- `Referrer-Policy: no-referrer`;
- CSP com `frame-ancestors 'none'`;
- `X-Frame-Options: DENY`;
- chaves com nomes de segredo/token/credential/cookie são removidas do estado público;
- `MICRO_APP_SECRET` pode ser configurado especificamente; na ausência, a chave API global é usada como segredo de assinatura e precisa ter tamanho mínimo seguro.

Nesta fase, o modo operacional implementado pelo Studio é `CONVERSATION_SESSION`. Valores de autenticação adicional devem ser tratados como reservados até existir um autenticador dedicado; não devem ser usados como indicação de segurança adicional.

## Geolocalização e geofence

Localização pode vir do WhatsApp (`location`/`live_location`) ou do GPS do Micro App (`navigator.geolocation`). O backend normaliza latitude/longitude e calcula distância por Haversine.

A política aceita:

- fontes permitidas;
- precisão máxima para GPS;
- múltiplas geofences circulares;
- raio em metros;
- comportamento fora da área.

Comportamentos:

- `BLOCK`: bloqueia;
- `ALLOW`: permite, registrando que ficou fora da área;
- `JUSTIFY`: **fail-closed** — sinaliza justificativa obrigatória e não executa a operação automaticamente;
- `APPROVAL`: **fail-closed** — sinaliza aprovação obrigatória e não executa a operação automaticamente.

Essa regra evita que uma operação crítica seja liberada apenas por configuração declarativa sem um fluxo humano correspondente.

## Actions e Recipes

Páginas de Micro App podem executar uma Action/Recipe em `load` e/ou `submit`. O input é resolvido pelo mesmo mecanismo de variáveis já usado pelo Integration Registry. Credenciais continuam referenciadas por `credentialRef`, fora do template.

Uma operação configurada com confirmação no Registry continua sujeita à validação do `ActionExecutionService`/`RecipeService`; o Micro App não ignora confirmação declarada.

## Conclusão do app

Ao chegar ao final do fluxo, `completion.template` pode enviar um template de retorno para o mesmo número, usando as variáveis capturadas/retornadas pelo app.

## Template Studio

A UI Phase 6 é aditiva e carregada sobre o Template Studio existente. Na aba **Interações** são disponibilizados:

- designer LIST/CHOICE;
- Data Mapper;
- captura e binding por opção;
- plano de transporte por provider;
- designer multipágina de Micro Apps;
- preset de check-in com GPS;
- editor de geofence;
- abertura de sessão real de teste;
- teste de GPS do navegador.

O modo claro permanece como padrão.

## Compatibilidade

A Phase 6 não altera o schema de banco e não cria novo provider. O runtime mantém os fallbacks da Phase 5 e evita depender de estruturas interativas Baileys já consideradas instáveis no caminho de templates.
