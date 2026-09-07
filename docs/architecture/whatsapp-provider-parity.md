# Connect|API — Paridade dos providers WhatsApp

Este documento define o comportamento público que Baileys e Zapo devem expor de forma consistente dentro da Connect|API. A implementação interna de cada provider pode ser diferente quando o protocolo exigir.

## Autenticação do dispositivo

- Solicitar QR Code deve sempre iniciar ou reutilizar somente a operação da própria instância e devolver um QR utilizável.
- Solicitar código de pareamento deve sempre iniciar uma operação explícita da própria instância e devolver um código utilizável ou um erro descritivo.
- Operações de instâncias diferentes não podem compartilhar estado, promise, telefone, QR ou código de pareamento.
- A cor do QR vem de `QRCODE_COLOR` para todos os providers compatíveis.
- O tempo máximo da operação vem de `WHATSAPP_AUTH_REQUEST_TIMEOUT_MS`.
- A identidade pública do dispositivo usa as configurações `WHATSAPP_PROTOCOL_BROWSER_*` sempre que o protocolo permitir.
- Baileys mantém o fingerprint canônico `Ubuntu / Chrome / 20.0.04` exclusivamente no handshake por código de pareamento enquanto essa exigência for necessária para estabilidade. QR continua usando a identidade configurável.
- Zapo mantém um browser/platform válido e usa o nome configurado da Connect|API como identificação humana do dispositivo.

## JID, LID e conversas

- O JID telefônico é o identificador canônico de uma conversa 1:1 quando estiver disponível.
- LID é alias técnico e não deve criar uma segunda conversa para a mesma pessoa.
- `remoteJidAlt`/aliases conhecidos devem ser usados para reconciliar histórico, contatos e chats.
- O Manager não deve expor `@lid` quando houver número telefônico conhecido.

## Status do WhatsApp

- `status@broadcast` não é uma conversa regular.
- Status é armazenado para a tela dedicada de Status.
- `readStatus` controla somente o envio de leitura do Status; não controla se o Status é recebido/armazenado.
- O usuário pode optar por também visualizar Status na lista do Chat.

## Mensagens internas

- `protocolMessage`, `senderKeyDistributionMessage` e equivalentes podem ser persistidas quando necessárias ao protocolo/auditoria, mas não são bolhas de conversa para o usuário.

## Identidade visual

- Foto, nome e número da própria instância devem ser atualizados quando a conexão abrir.
- Fotos de contatos devem ser consultadas pelo provider e exibidas quando disponíveis.

## Chamadas

- O número mostrado ao usuário deve ser o número humano/canônico conhecido, não o LID interno resolvido pelo provider.
- Estados internos podem ser preservados na API; a interface usa rótulos de negócio.
- Áudio em tempo real pertence ao Voice Media Gateway/Softphone PWA e nunca ao EventManager.
