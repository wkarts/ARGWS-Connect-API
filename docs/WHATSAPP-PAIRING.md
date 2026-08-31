# ARGWS Connect API — WhatsApp Pairing Code

## Estado estável

O fluxo de código de pareamento foi estabilizado na linha 1.0.12 e aceita números com ou sem `+`, normalizando internamente para dígitos antes de solicitar o pairing code ao Baileys.

Exemplos equivalentes:

- `+5575988449231`
- `5575988449231`

## Identidade da sessão

O client oficial utilizado pelo ARGWS Connect API passa a ser:

```env
CONFIG_SESSION_PHONE_CLIENT=🅲🅾🅽🅽🅴🅲🆃​|🅰🅿🅸
CONFIG_SESSION_PHONE_NAME=Chrome
```

O browser tuple protocolar correspondente é:

```text
🅲🅾🅽🅽🅴🅲🆃​|🅰🅿🅸 / Chrome / 20.0.04
```

## Regras

- QR Code e pairing code permanecem modos independentes de autenticação.
- O pairing code só é solicitado explicitamente para o telefone informado.
- A rotação do QR Code não deve regenerar nem substituir um pairing code já emitido.
- `DATABASE_CONNECTION_CLIENT_NAME` continua sendo um identificador técnico da conexão de banco e não deve receber a identidade visual da sessão WhatsApp.
