# Micro App Auto Launch — teste interno completo

O `Template Engine` pode iniciar um Micro App sem Action REST e sem chamada manual ao endpoint de sessão quando o template possui `policy.microApps.autoLaunch`.

## Política

```json
{
  "microApps": {
    "version": 1,
    "autoLaunch": {
      "enabled": true,
      "appKey": "internal_showcase",
      "ttlSeconds": 1800,
      "messageText": "🌐 Abrir Mini App de demonstração",
      "linkPreview": true
    },
    "apps": []
  }
}
```

Ao enviar o template, o Connect|API:

1. resolve o contato pelo número da mensagem;
2. adiciona `contact.name`, `contact.whatsapp`, `contact.remoteJid` quando disponível;
3. adiciona `system.date`, `system.time`, `system.dateTime` e `system.timezone`;
4. cria internamente a sessão do Micro App;
5. adiciona `microApp.url`, `microApp.appKey` e `microApp.expiresAt` às variáveis de renderização;
6. envia automaticamente uma mensagem com o link temporário do Micro App;
7. não exige Action, Recipe, credencial externa ou chamada manual a `/micro-app/session`.

## Showcase autocontido

Importe:

`docs/examples/microapp-internal-showcase.argws`

O pacote contém:

- template `microapp_internal_showcase`;
- template de conclusão `microapp_internal_showcase_done`;
- Micro App `internal_showcase`;
- nenhuma Action;
- nenhuma Recipe;
- nenhuma API externa.

Depois da importação, use a aba **Teste** do Template Studio, informe um número WhatsApp e envie `microapp_internal_showcase`.

O link é produzido automaticamente.

## Recursos demonstrados

O Mini App possui cinco páginas:

1. painel do contato;
2. rascunho offline;
3. formulário com select/data/hora;
4. GPS opcional;
5. resumo e conclusão.

Também demonstra:

- nome do contato WhatsApp quando registrado no Connect|API;
- número WhatsApp;
- relógio ao vivo no navegador;
- data/hora da criação da sessão;
- status online/offline;
- rascunho local usando armazenamento do navegador;
- fila de submit enquanto o navegador está offline;
- restauração de campos durante a sessão;
- localização opcional;
- retorno automático ao WhatsApp por template ao concluir.

## Limite do modo offline

O modo offline preserva o conteúdo já carregado, rascunhos e submits pendentes enquanto a página permanece disponível no navegador. O envio ao servidor é retomado quando a conectividade volta. Ele não transforma o Micro App em um aplicativo instalado independente do servidor, e a sessão continua respeitando o TTL e o token assinado.
