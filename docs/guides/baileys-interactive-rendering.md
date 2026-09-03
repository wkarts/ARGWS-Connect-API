# Baileys — transporte interativo Web/Desktop

## Problema corrigido

O provider `WHATSAPP-BAILEYS` usava um wrapper `viewOnceMessage` em mensagens com botões interativos. O payload podia ser aceito pelo servidor do WhatsApp, mas WhatsApp Web/Desktop exibia uma mensagem não suportada em vez dos botões.

Listas também eram enviadas sem o nó de protocolo business necessário para renderização consistente no Web/Desktop.

## Transporte adotado

O contrato lógico do Connect|API continua independente do provider. Somente o adapter Baileys muda o transporte físico.

### Botões

- `interactiveMessage` é enviado diretamente, sem `viewOnceMessage`;
- `nativeFlowMessage` continua representando reply/URL/call/copy/PIX;
- `relayMessage` recebe `additionalNodes` com:

```text
<biz>
  <interactive type="native_flow" v="1">
    <native_flow v="9" name="mixed" />
  </interactive>
</biz>
```

### Listas

Para compatibilidade Web/Desktop a lista usa `listMessage` legado com `SINGLE_SELECT` e o nó:

```text
<biz>
  <list type="product_list" v="2" />
</biz>
```

## Capabilities

Após a correção, o planner pode usar transporte interativo nativo do adapter Baileys para:

- quick reply;
- URL;
- telefone;
- copiar código;
- LIST;
- CHOICE de escolha única.

Combinações inválidas ou falhas reais do runtime continuam degradando para texto/poll pelos fallbacks do Template Engine.

## Micro Apps

`policy.microApps.autoLaunch` usa o mesmo `buttonMessage()` do provider. Portanto o CTA `Abrir Mini App` passa pelo mesmo transporte corrigido; se o envio do CTA falhar, o Connect|API continua enviando o link textual como fallback seguro.

## Escopo

Esta alteração não copia runtime de Flow Builder/Fersoft, não altera o contrato Meta e não transforma `Meta Compatible` em provider. É uma correção específica do adapter `WHATSAPP-BAILEYS`.

DOCS IMPACT: DOCUMENTED
