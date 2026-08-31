# ARGWS Connect API — Compatibilidade de Payloads de Mensagem

## Objetivo

O ARGWS Connect API mantém compatibilidade de entrada com integrações construídas sobre contratos de mensagem legados 1.x, sem obrigar clientes existentes a migrarem todos os payloads de uma só vez.

A compatibilidade é implementada na borda HTTP, antes da validação e antes do motor de canal. Internamente, a aplicação continua trabalhando com um único contrato normalizado.

A partir da linha `1.0.9`, esta compatibilidade faz parte do contrato oficial de regressão do produto.

## Regra de precedência

Quando o mesmo campo existir no formato atual e no envelope legado, o campo atual no nível raiz tem precedência.

Exemplo:

```json
{
  "number": "5575999998888",
  "text": "ATUAL",
  "textMessage": {
    "text": "LEGADO"
  }
}
```

O texto enviado será `ATUAL`.

## Texto

Os dois contratos são aceitos.

### Legado

```json
{
  "number": "5575999998888",
  "options": {
    "delay": 1200,
    "presence": "composing",
    "linkPreview": true,
    "mentions": {
      "everyOne": false,
      "mentioned": ["5575000000000"]
    }
  },
  "textMessage": {
    "text": "Mensagem"
  }
}
```

### Atual

```json
{
  "number": "5575999998888",
  "text": "Mensagem",
  "delay": 1200,
  "linkPreview": true,
  "mentionsEveryOne": false,
  "mentioned": ["5575000000000"]
}
```

## Mídia

### Legado

```json
{
  "number": "5575999998888",
  "options": {
    "delay": 1200
  },
  "mediaMessage": {
    "mediatype": "image",
    "mimetype": "image/jpeg",
    "caption": "Imagem",
    "media": "https://example.com/image.jpg",
    "fileName": "image.jpg"
  }
}
```

### Atual

```json
{
  "number": "5575999998888",
  "mediatype": "image",
  "mimetype": "image/jpeg",
  "caption": "Imagem",
  "media": "https://example.com/image.jpg",
  "fileName": "image.jpg",
  "delay": 1200
}
```

Também são normalizados os aliases legados `mediaType → mediatype` e `filename → fileName`.

## Lista

### Legado

```json
{
  "number": "5575999998888",
  "options": {
    "delay": 1000
  },
  "listMessage": {
    "title": "Menu",
    "description": "Escolha uma opção",
    "buttonText": "Abrir",
    "footerText": "Rodapé",
    "sections": [
      {
        "title": "Opções",
        "rows": [
          {
            "title": "Opção 1",
            "description": "Descrição",
            "rowId": "op1"
          }
        ]
      }
    ]
  }
}
```

O envelope é removido e os campos são encaminhados ao contrato interno atual.

## Envelopes reconhecidos

A camada de compatibilidade reconhece atualmente:

```text
textMessage
mediaMessage
audioMessage
stickerMessage
locationMessage
contactMessage
pollMessage
listMessage
buttonMessage
buttonsMessage
statusMessage
templateMessage
ptvMessage
reactionMessage
```

Também é reconhecido o bloco legado:

```text
options
```

para campos como:

```text
delay
presence
quoted
linkPreview
encoding
webhookUrl
notConvertSticker
mentions / mentioned
```

## Multipart / form-data legado

Integrações antigas podem enviar `options`, `textMessage`, `mediaMessage`, `listMessage` e os demais envelopes conhecidos como strings JSON dentro de `multipart/form-data`.

Esses campos conhecidos são desserializados antes da normalização e depois passam pela mesma validação dos payloads JSON atuais. O parsing não é aplicado genericamente a campos desconhecidos.

## Contatos

São aceitos, além do contrato atual, os formatos:

```json
{
  "contactMessage": {
    "contact": []
  }
}
```

```json
{
  "contactMessage": {
    "contacts": []
  }
}
```

```json
{
  "contactMessage": []
}
```

## Formato híbrido

Clientes podem migrar gradualmente. Payloads híbridos são aceitos, desde que o resultado normalizado satisfaça o schema da rota.

O ARGWS Connect API não ignora a validação: a compatibilidade transforma somente estruturas reconhecidas e, em seguida, executa o mesmo JSON Schema utilizado pelos clientes atuais.

## Teste de regressão

O comando abaixo valida a matriz de compatibilidade:

```bash
npm run test:compat
```

O gate `Check Code Quality` executa este teste em `main` e `develop`. Uma mudança futura que quebre um dos contratos cobertos deverá falhar no CI antes da publicação da imagem.

## Evolução

Novos formatos legados comprovadamente encontrados em integrações existentes devem ser adicionados ao normalizador e acompanhados por teste de regressão. Não adicionar aliases especulativos que possam alterar silenciosamente o significado de um payload atual.
