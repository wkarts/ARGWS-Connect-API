# Instâncias

A instância é a unidade principal de isolamento do Connect|API. Operações públicas usam `instanceName` na rota e o backend mantém o vínculo com `instanceId`, provider, token, status e dados relacionados.

## Providers atuais

```text
WHATSAPP-BUSINESS
WHATSAPP-BAILEYS
CONNECT
```

## Ciclo de vida

Principais operações:

```text
POST   /instance/create
GET    /instance/connect/{instanceName}
GET    /instance/connectionState/{instanceName}
GET    /instance/fetchInstances
POST   /instance/restart/{instanceName}
DELETE /instance/logout/{instanceName}
DELETE /instance/delete/{instanceName}
```

## QR Code e pareamento

Em `WHATSAPP-BAILEYS`:

- chamada sem `number` solicita QR Code;
- chamada com `number` internacional normalizado solicita código de pareamento;
- os dois modos são independentes;
- sessão já registrada não deve gerar novo pairing code.

## Exclusão

A exclusão definitiva deve localizar a instância mesmo quando ela já saiu da memória/Redis, usando o banco como fallback final. A rotina de limpeza remove os dados persistidos associados conforme a implementação atual.

## Estado

Estados comuns incluem:

```text
open
connecting
close
unknown
```

Não trate `close` como inexistência: uma instância pode estar desconectada e continuar persistida.
