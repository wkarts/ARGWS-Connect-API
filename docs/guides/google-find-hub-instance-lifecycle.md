# Google Find Hub — criação e ciclo de vida da instância

## Correção de `setSettings is not a function`

O canal Google Find Hub não implementa configurações de mensagens e chamadas do WhatsApp. O fluxo genérico de criação chamava `SettingsService.create()`, que invocava `setSettings()` incondicionalmente. A correção está no despacho por canal; nenhum método vazio foi acrescentado ao Find Hub para simular suporte a WhatsApp.

## Contrato de criação

`POST /instance/create`, com `integration=GOOGLE-FIND-HUB`, cria uma instância desconectada (`status=close`) e retorna `settings=null`, sem QR Code. O token da instância e as configurações de Webhook, WebSocket e demais transportes continuam no fluxo existente. O Manager utiliza exatamente esse endpoint.

Campos genéricos inativos (`false`, strings vazias) são tolerados; o sinalizador `qrcode` não inicia pareamento nesse canal. Configurações ativas de mensagens/chamadas, Proxy e Chatwoot são rejeitadas com HTTP 400 **antes de criar ou excluir qualquer registro**. Essas integrações não devem ser anunciadas como disponíveis para Find Hub enquanto não forem implementadas.

A criação não autentica uma conta Google. Sem credenciais importadas, a conexão retorna `WAITING_AUTH` e `ready=false`. O fluxo de `CredentialProvider` e suas limitações estão no [guia principal](google-find-hub.md). Não é necessário trocar a chave de criptografia para resolver este erro.

## Configurações, presença e exclusão

A escrita pelo serviço de configurações WhatsApp e a operação de presença retornam erro HTTP 400 explícito para Find Hub. A consulta de configurações WhatsApp retorna `null`, mantendo a semântica anterior de ausência de configurações.

A exclusão de Find Hub não chama `clearCacheChatwoot()`, mesmo quando Chatwoot está habilitado globalmente. O ciclo de desconexão também não cria estado de QR Code nesse canal. Os hooks dos providers WhatsApp continuam ativos.

## Falhas durante a criação

Falhas ao inicializar o runtime, ao inserir o registro ou ao tentar usar um nome já existente não excluem a instância preexistente. Depois de uma inserção confirmada, o rollback aguarda a limpeza e restringe a remoção à instância criada por aquela tentativa. Uma rejeição assíncrona do evento de criação também é tratada.

Não execute exclusão em massa nem remova volumes para contornar uma criação que falhou. Verifique a instância pelo Manager/API e preserve contas previamente autenticadas.

## Regressão automatizada

```bash
node --test test/findhub-instance-lifecycle.test.cjs
npm run test:findhub
npm run docs:check
```

A suíte executa os controllers, o serviço de configurações, o monitor e o runtime Find Hub reais com infraestrutura e protocolo externo isolados. Cobre criação, opções incompatíveis, rollback, duplicidade, estado antes da autenticação, consulta de dispositivos por instância, exclusão com Chatwoot global e preservação dos caminhos WhatsApp. Não realiza autenticação Google nem localização de aparelho real.
