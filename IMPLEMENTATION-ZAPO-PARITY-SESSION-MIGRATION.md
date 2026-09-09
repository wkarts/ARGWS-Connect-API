# Connect|API — Zapo parity + provider session migration

Base usada: `ARGWS-Connect-API-develop (9)(2).zip`, definida como base oficial de `develop` para esta entrega.

## Escopo desta entrega

Esta versão faz duas coisas de forma incremental:

1. amplia o provider Zapo para o mesmo contrato operacional usado pelo Baileys nas capacidades comuns;
2. adiciona conversão controlada da mesma sessão entre `WHATSAPP-BAILEYS` e `WHATSAPP-ZAPO` por snapshot.

**Não foi implementado nesta etapa** um Zapo auxiliar por trás de uma instância Baileys para chamadas. Os providers não ficam conectados simultaneamente durante a migração.

## Paridade Zapo

O runtime Zapo passa pela cadeia:

```text
ZapoInteractiveStartupService
  -> ZapoGroupStartupService
     -> ZapoAccountStartupService
        -> ZapoExtendedStartupService
           -> ZapoStartupService
```

Foram incorporadas compatibilidades para:

- presença e chatstate;
- labels e associações via app-state;
- PN/LID e consulta de número;
- foto de perfil com validação de JID;
- read receipts;
- archive/unarchive e marcar chat como não lido;
- revoke e edit de mensagens;
- download/base64 de mídia;
- status/About;
- perfil e perfil Business;
- privacidade;
- atualização de nome/foto/status;
- block/unblock;
- grupos, participantes, convites, configurações e mensagens temporárias;
- botões/listas e publicação de Status;
- chamadas/voz continuam nativas do provider Zapo.

Também foi criado um contrato explícito de capabilities para providers WhatsApp. As capabilities obrigatórias comuns estão marcadas como suportadas tanto por Baileys quanto por Zapo. `businessCatalog`, `calls` e `voice` ficam como extensões opcionais do contrato. Zapo 1.6.3 não expõe ainda um coordinator público tipado equivalente ao `getCatalog` do Baileys; por segurança, esta entrega não usa MEX interno/privado para simular essa API.

## Conversão Baileys <-> Zapo

Endpoint:

```http
POST /instance/migrateProvider/{instanceName}
```

Payload Baileys -> Zapo:

```json
{
  "targetProvider": "WHATSAPP-ZAPO"
}
```

Payload Zapo -> Baileys:

```json
{
  "targetProvider": "WHATSAPP-BAILEYS"
}
```

Dry-run:

```json
{
  "targetProvider": "WHATSAPP-ZAPO",
  "dryRun": true
}
```

### Sequência segura

```text
provider atual conectado
      |
      v
preflight do snapshot + validação da conversão
      |
      v
backup do storage de destino
      |
      v
fecha provider atual SEM logout
      |
      v
captura NOVO snapshot após o socket estar fechado
      |
      v
wa-store-migrate (validate=true)
      |
      v
bloqueia drops de domínios criptográficos críticos
      |
      v
grava snapshot no provider de destino
      |
      v
sobe destino e exige state=open SEM QR/pairing
      |
      +--> sucesso: atualiza integration mantendo mesma instância
      |
      `--> falha: restaura destino e religa provider original
```

O snapshot de autenticação nunca é retornado pela API.

## Domínios protegidos

Uma conversão é abortada se o migrador reportar `drop` em qualquer domínio crítico:

```text
identity
signedPreKey
preKeys
signalIdentities
sessions
senderKeys
appStateSyncKeys
appStateVersions
```

Avisos e perdas não críticas continuam sendo devolvidos no campo `losses` para auditoria.

## Armazenamento

Baileys:

- Redis com `SAVE_INSTANCES`;
- Prisma/PostgreSQL + Redis para keys;
- Prisma/PostgreSQL + arquivos locais quando Redis não está ativo.

Zapo:

- store PostgreSQL oficial do provider, reutilizando `ZAPO_STORE_TABLE_PREFIX`.

`PROVIDER_SESSION` externo é bloqueado para migração nesta versão porque o serviço atual não possui endpoint de enumeração das chaves da sessão. Migrar sem enumerar todas as keys poderia gerar um snapshot incompleto.

## Identidade preservada

A conversão não cria outra instância pública. Permanecem os mesmos:

- `instanceId`;
- `instanceName`;
- token;
- webhooks;
- integrações e configurações da instância.

Somente `integration` é alterado após o provider de destino alcançar `open`.

## Dependências

Adicionado e fixado:

```text
wa-store-migrate = 0.1.1
```

O runtime principal do Connect|API continua fixado em:

```text
@innovatorssoft/zapo-js = 1.6.3
zapo-js = npm:@innovatorssoft/zapo-js@1.6.3
@innovatorssoft/store-postgres = 1.0.2
@innovatorssoft/voip = 1.0.0
```

O `zapo-js@0.3.0` presente como dependência interna do `wa-store-migrate` fica isolado dentro do pacote de conversão e não substitui o runtime Zapo 1.6.3 da Connect|API.

## Validações executadas nesta entrega

- `node test/zapo-provider.integration.test.mjs` -> OK;
- geração OpenAPI/AsyncAPI -> OK;
- `node docs/scripts/generate-openapi.mjs --check` -> sincronizado;
- `npm install --package-lock-only --ignore-scripts --offline --dry-run` -> lockfile aceito;
- transpile/syntax check de 212 arquivos TypeScript -> 0 erros de sintaxe;
- `node --check` dos scripts JavaScript alterados -> OK.

O `tsc --noEmit` completo não pôde ser concluído neste ambiente porque o ZIP não contém `node_modules` e o ambiente não possui acesso de rede ao registry para restaurar todas as dependências. O package lock foi validado offline.

### Validação que ainda exige ambiente real

A única validação que não pode ser simulada localmente é o handoff de uma sessão WhatsApp real. Antes de tratar a migração como homologada em produção, execute ao menos:

1. Baileys pareado -> `dryRun` -> Baileys -> Zapo -> confirmar `open` sem QR;
2. enviar/receber mensagem no Zapo;
3. reiniciar a API e confirmar persistência da sessão;
4. Zapo -> `dryRun` -> Zapo -> Baileys -> confirmar `open` sem QR;
5. enviar/receber mensagem no Baileys;
6. forçar uma falha de destino em homologação e confirmar o rollback para a origem.
