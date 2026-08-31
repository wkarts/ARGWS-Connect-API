# ARGWS Connect API — Pairing Code Compatibility

## Objetivo

O fluxo de autenticação por código de pareamento é mantido separado do ciclo de QR Code.

## Contrato

- Telefone em formato internacional, somente dígitos (`DDI + DDD + número`).
- `requestPairingCode()` é chamado somente mediante solicitação explícita.
- A renovação periódica do QR Code não regenera nem substitui o pairing code.
- A identidade visual do produto (`CONFIG_SESSION_PHONE_CLIENT=ConnectAPI`) não é usada como fingerprint protocolar do companion device.
- O socket Baileys usa fingerprint canônico `Ubuntu / Chrome / 20.0.04` para compatibilidade com a validação de pairing do WhatsApp.
- QR Code continua disponível como método independente de autenticação.

## Diagnóstico

Versões do Baileys da linha 7 release candidate possuem relatos públicos de `requestPairingCode()` retornar códigos que o WhatsApp posteriormente rejeita. Por isso o ARGWS Connect API evita browser labels customizados no handshake protocolar e mantém o branding separado da identificação técnica do companion device.

## Teste operacional

Use sempre uma sessão não registrada para validar pairing code. Solicite um código para o telefone completo, por exemplo `5575988449231`, e informe o código imediatamente em WhatsApp → Aparelhos conectados → Conectar um aparelho → Conectar com número de telefone.
