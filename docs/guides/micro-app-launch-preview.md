# Micro App — lançamento por CTA e prévia no Studio

Templates com `policy.microApps.autoLaunch` preferem um botão CTA para abrir o Micro App quando o provider expõe transporte interativo compatível.

```json
{
  "microApps": {
    "autoLaunch": {
      "enabled": true,
      "appKey": "internal_showcase",
      "launchMode": "BUTTON",
      "messageText": "Mini App disponível",
      "buttonText": "Abrir Mini App",
      "ttlSeconds": 1800,
      "linkPreview": true
    }
  }
}
```

## Transporte

- `BUTTON` é o padrão.
- O runtime tenta `buttonMessage` com botão URL.
- Se o provider não suportar o CTA ou rejeitar o payload, o Connect|API registra `MICRO_APP_CTA_FALLBACK` e envia o link em texto para não perder o acesso ao Micro App.
- `LINK` força o comportamento textual.

O Micro App continua sendo uma aplicação web segura hospedada pelo Connect|API. WhatsApp não incorpora HTML arbitrário dentro da bolha da conversa; o CTA abre a sessão do Micro App no navegador/webview suportado pelo cliente.

## Preview no Template Studio

Quando o template possui Micro App com `autoLaunch`, o painel de Live Preview passa a apresentar:

1. o CTA `Abrir Mini App` na simulação da mensagem do WhatsApp;
2. uma prévia visual separada do Micro App;
3. navegação entre as páginas do app;
4. representação de `CONTACT`, `CLOCK`, `STATUS`, `INPUT`, `SELECT/LIST`, `DATE`, `TIME`, `CHECKBOX`, `LOCATION` e componentes básicos;
5. contexto de amostra para contato, WhatsApp, data, hora e timezone.

A prévia do Studio é side-effect-free: não cria sessão, não executa Actions/Recipes e não solicita GPS real.

DOCS IMPACT: DOCUMENTED
