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

## Transporte de localização

O canal implementa nativamente Nova, Spot, protobuf, E2EE e o transporte FCM/MCS usado para a resposta assíncrona de localização.

O fluxo ativo é:

1. registra/mantém o receptor FCM;
2. mantém a conexão TLS MCS com `mtalk.google.com:5228`;
3. envia `nbe_execute_action` pela Nova com um `requestUuid`;
4. correlaciona o `DeviceUpdate` recebido pelo FCM/MCS;
5. descriptografa o relatório E2EE;
6. normaliza latitude, longitude, precisão, altitude e timestamp;
7. publica `findhub.location.updated` e, quando configurado, encaminha ao Traccar.

O tracking periódico é restaurado automaticamente após reinicialização da instância.

A autenticação do usuário continua separada do transporte: a Connect|API não captura senha ou cookies do navegador e recebe somente um bundle previamente autorizado por um `CredentialProvider`.

## Privacidade

- sem telemetria específica do canal;
- sem senha Google;
- sem captura de cookie no backend;
- credenciais cifradas em repouso;
- sem log de tokens ou coordenadas;
- histórico de posição desativado por padrão.
