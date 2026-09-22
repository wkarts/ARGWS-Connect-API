# Google Find Hub channel

O canal `GOOGLE-FIND-HUB` adiciona contas Google Find Hub como instâncias da Connect|API.

## Arquitetura

Uma instância representa uma conta autorizada e pode administrar os dispositivos retornados por ela. O Manager usa os mesmos endpoints públicos disponíveis para clientes externos.

O canal é nativo em TypeScript e não executa GoogleFindMyTools, FastAPI, Chromium, Selenium, VNC ou Xvfb.

## Persistência

O módulo adiciona:

- `FindHubAccount`
- `FindHubDevice`
- `FindHubPosition`
- `FindHubTraccarBinding`

As credenciais persistidas são cifradas com AES-256-GCM.

Configure uma chave de 32 bytes:

```env
FINDHUB_CREDENTIALS_KEY=<32 bytes em base64 ou 64 caracteres hex>
```

Configurações opcionais:

```env
FINDHUB_DEFAULT_TRACKING_INTERVAL_SECONDS=60
FINDHUB_MIN_TRACKING_INTERVAL_SECONDS=30
FINDHUB_LOCATION_TIMEOUT_MS=30000
FINDHUB_STORE_POSITION_HISTORY=false
FINDHUB_TRACCAR_TIMEOUT_MS=10000
```

## Autenticação

A Connect|API não coleta senha nem cookies do navegador. A autenticação é uma fronteira de `CredentialProvider`.

1. `POST /findhub/auth/start/:instanceName` cria uma sessão temporária.
2. O operador autentica a conta usando um provider autorizado.
3. O provider conclui a sessão por `POST /findhub/auth/import/:instanceName`.
4. A Connect|API cifra e persiste apenas o bundle necessário ao canal.

## API

- `POST /findhub/auth/start/:instanceName`
- `POST /findhub/auth/import/:instanceName`
- `GET /findhub/auth/status/:instanceName`
- `GET /findhub/devices/:instanceName`
- `POST /findhub/devices/refresh/:instanceName`
- `GET /findhub/device/:deviceId/:instanceName`
- `POST /findhub/locate/:deviceId/:instanceName`
- `POST /findhub/tracking/start/:deviceId/:instanceName`
- `POST /findhub/tracking/stop/:deviceId/:instanceName`
- `GET /findhub/positions/:deviceId/:instanceName`
- `PUT /findhub/traccar/:deviceId/:instanceName`
- `DELETE /findhub/traccar/:deviceId/:instanceName`

## Eventos

- `findhub.auth.update`
- `findhub.devices.updated`
- `findhub.location.updated`
- `findhub.tracking.update`
- `findhub.error`

Os eventos usam o `EventManager` existente e podem chegar a WebSocket, Webhook, RabbitMQ, NATS, SQS, Kafka e Pusher.

## Traccar

Cada dispositivo pode possuir um vínculo independente com Traccar pelo adapter HTTP/OsmAnd.

## Estado atual do transporte

Nova, Spot, protobuf, E2EE, catálogo de dispositivos, persistência, eventos, Manager e Traccar estão modelados no canal.

A atualização ativa de localização depende do transporte push privado usado pelo Find Hub. A implementação que captura cookies/sessões do navegador não é incluída na Connect|API. Enquanto esse transporte não estiver habilitado por um provider seguro, a capability `location/tracking` é anunciada como indisponível.

## Privacidade

- sem telemetria específica do canal;
- sem senha Google;
- sem captura de cookie no backend;
- credenciais cifradas em repouso;
- sem log de tokens ou coordenadas;
- histórico de posição desativado por padrão.
