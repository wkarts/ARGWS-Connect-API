# ARGWS Connect API — WhatsApp QR Code e Pairing Code

## Estado estável

Os dois métodos de autenticação são independentes e compartilham o mesmo estado persistente da instância, mantendo apenas um socket de autenticação ativo por vez.

O código de pareamento aceita números com ou sem `+`, normalizando internamente para dígitos antes de solicitar o pairing code ao Baileys.

Exemplos equivalentes:

- `+5575988449231`
- `5575988449231`

## Fingerprint do QR Code

O QR Code preserva a identidade personalizável do ARGWS Connect API. O fingerprint protocolar é configurável por:

```env
CONFIG_SESSION_PHONE_CLIENT=🅰🆁🅶🆆🆂 ​ 🅲🅾🅽🅽🅴🅲🆃 ​ 🅰🅿🅸
CONFIG_SESSION_PHONE_NAME=Chrome
WHATSAPP_PROTOCOL_BROWSER_CLIENT=🅲🅾🅽🅽🅴🅲🆃​|🅰🅿🅸
WHATSAPP_PROTOCOL_BROWSER_NAME=Chrome
WHATSAPP_PROTOCOL_BROWSER_VERSION=20.0.04
```

`WHATSAPP_PROTOCOL_BROWSER_*` é utilizado no modo QR Code. Se algum valor não estiver definido, o serviço usa `CONFIG_SESSION_PHONE_CLIENT` / `CONFIG_SESSION_PHONE_NAME` como fallback para nome e navegador.

## Fingerprint do Pairing Code

O código de pareamento usa deliberadamente o fingerprint canônico abaixo:

```text
Ubuntu / Chrome / 20.0.04
```

Esse fingerprint não utiliza a identidade visual personalizada do produto porque o fluxo de registro de companion device do WhatsApp é mais restritivo que o fluxo de QR Code.

## Regras de lifecycle

- QR Code e pairing code permanecem modos independentes de autenticação.
- Existe somente um socket Baileys de autenticação ativo por instância.
- Cada nova conexão recebe uma geração própria; eventos atrasados de sockets antigos são ignorados.
- A troca de modo invalida a geração anterior antes de fechar o transporte antigo.
- Não existe espera arbitrária de 250 ms para considerar um socket encerrado.
- Uma solicitação de pairing code é sempre uma operação explícita e fresca para o telefone informado.
- A rotação do QR Code não regenera nem substitui um pairing code já emitido no modo de pareamento.
- Uma tentativa de pairing que falhar ou expirar não deve obrigar a exclusão da instância para voltar ao QR Code.
- Uma tentativa de QR que falhar deve retornar erro explícito em vez de um objeto vazio que deixe o Manager aguardando indefinidamente.

## Socket.IO do Manager

O Socket.IO continua protegido pela allowlist de rede. Clientes que enviam `apikey` têm o token validado normalmente. O Manager legado, que não envia a chave no handshake Engine.IO, pode conectar quando a origem de rede já foi aprovada pela allowlist, preservando compatibilidade com o Manager atual.

`DATABASE_CONNECTION_CLIENT_NAME` continua sendo um identificador técnico da conexão de banco e não deve receber a identidade visual da sessão WhatsApp.
