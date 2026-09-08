# Identidade de chamadas ZAPO

O Connect|API trata PN e LID como identificadores distintos da mesma conta WhatsApp. Um LID é opaco e nunca é convertido em telefone pela leitura de seus dígitos.

Para chamadas recebidas, a identidade é resolvida de forma pontual usando somente evidências entregues pelo ZAPO/WhatsApp, com prioridade para `callerPnJid`/`callerPn`, `callCreatorJid`, `senderLidJid`, `callerPushName` e os vínculos PN↔LID já aprendidos ou persistidos no mailbox do provider.

O nome remoto (`callerPushName`) é válido mesmo quando o WhatsApp ainda não forneceu PN para a chamada. Nesse caso o Manager pode exibir nome e foto sem inventar um número. Quando um PN explícito é disponibilizado, ele passa a ser a identidade telefônica canônica da mesma chamada/contato.

A resolução é orientada a evento e sob demanda. Ela não executa varreduras globais de mensagens, contatos ou histórico no caminho de chamadas.
