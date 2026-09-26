# Google Find Hub — superfície de protocolo aprendida das referências

Esta implementação foi revisada contra os dois pacotes de referência fornecidos para a evolução do Connect|API:

- `GoogleFindMyTools`: referência principal do wire Nova/SPOT, protobufs, FCM/MCS, criptografia, catálogo, localização e ações;
- `find-my-device-rest-api`: wrapper REST sobre a mesma família de protocolo, útil para cache, force refresh, polling e seleção do relatório mais recente.

Nenhum campo é fabricado. Quando o material fornecido não demonstra uma capacidade, o Connect|API declara essa capacidade como indisponível em vez de devolver um valor sintético.

## Recursos comprovados e portados

| Recurso | Origem no material | Connect|API |
| --- | --- | --- |
| Catálogo SPOT e Android | Nova ListDevices | Suportado |
| Todos os IDs canônicos | DeviceMetadata / CanonicIds | Persistidos e expostos |
| Tipo do identificador | IdentifierInformationType + captura viva | ANDROID / SPOT / SUPERVISED_ANDROID / UNKNOWN |
| Tipos detalhados | SpotDeviceType | Suportados sem reduzir tudo a TRACKER |
| Fabricante e modelo | DeviceRegistration + catálogo vivo 2026 | Persistidos |
| Fast Pair Model ID | DeviceRegistration.fastPairModelId | Persistido |
| Data de pareamento | DeviceRegistration.pairDate | Persistida |
| Ownership/acesso | DeviceInformation.accessInformation | Persistido e exibido |
| Owner key version | EncryptedUserSecrets.ownerKeyVersion | Persistido |
| Material criptográfico | EncryptedUserSecrets | Somente fingerprints SHA-256; chaves brutas não são expostas |
| Mínimo de agregação de rede | minLocationsNeededForAggregation | Persistido |
| Locate ativo | ExecuteAction.locateTracker | Suportado |
| Tocar som | ExecuteAction.startSound | Suportado para wire SPOT comprovado |
| Parar som | ExecuteAction.stopSound | Suportado para wire SPOT comprovado |
| Componentes de som | DeviceComponent | UNSPECIFIED / RIGHT / LEFT / CASE |
| Localização LAST_KNOWN | Common.Status | Preservada como origem |
| Localização CROWDSOURCED | Common.Status | Preservada como origem |
| Localização AGGREGATED | Common.Status | Preservada como origem |
| Relatórios recentes/rede | RecentLocationAndNetworkLocations | Decriptados e deduplicados |
| Push realtime | FCM/MCS | Conexão persistente |
| Histórico local | Connect|API | Persistente e opcional |
| Reconciliação | Connect|API sobre os reports devolvidos | Best effort, sem prometer timeline completa |

## Metadados descobertos no protocolo vivo de 2026

Capturas reais de `DevicesList` mostraram que o backend atual possui um layout mais novo que o `DeviceUpdate.proto` original usado pelo GoogleFindMyTools. O decoder da Connect|API mantém compatibilidade com o layout legado e passou a reconhecer, quando presentes:

- fabricante;
- modelo;
- codinome do dispositivo;
- produto/variant name;
- operadora;
- IMEI validado por formato/check digit;
- ID numérico Android;
- ID opaco estável do metadata;
- timestamps de registro/status/resposta do provider;
- versão numérica do Google Play Services;
- Android SDK;
- capacidades brutas numeradas pelo provider;
- flags numéricas ainda sem semântica oficial;
- indicação de dispositivo supervisionado Family Link, nome do membro e URL devolvida pelo Google;
- metadata offline/E2EE legado ainda embutido no layout novo.

O layout vivo também apresentou `IdentifierInformationType = 6` em um aparelho supervisionado do Family Link. A Connect|API o representa semanticamente como `SUPERVISED_ANDROID`, sem fingir que esse nome constava no proto legado.

Dispositivos supervisionados podem aparecer sem um ID canônico compatível com o wire de `ExecuteAction.locateTracker`. Nesses casos eles continuam visíveis no catálogo e com seus metadados preservados, mas `locateSupported=false` impede a aplicação de enviar uma ação com identificador inventado.

### Ainda não confirmado

Os catálogos capturados **não demonstraram de forma segura**:

- percentual de bateria;
- MEID;
- número de série;
- SSID atual;
- RSSI Wi-Fi;
- intensidade do sinal celular.

O wrapper `find-my-device-rest-api` mantém `battery_level` como `null` para `SPOT_DEVICE`. Embora o produto oficial Find Hub apresente bateria e conectividade para aparelhos online, é necessário mapear a superfície/status protobuf correspondente antes de expor esses campos.

O próximo artefato preferencial para essa análise é o `DeviceUpdate .pb` capturado após uma solicitação ativa de localização.

## Frescor de localização: solicitação não é observação nova

O tracking da Connect|API pode enviar comandos em intervalos menores que vinte minutos e aceita `intervalSeconds=0` para consultas serializadas contínuas. Isso **não obriga o provider a gerar um novo fix GPS**.

Para tornar essa diferença auditável, cada dispositivo mantém:

- `providerRequestCount`: quantidade de comandos de localização enviados;
- `providerReportCount`: quantidade de relatórios de posição realmente recebidos;
- `providerRepeatedReportCount`: relatórios que não eram uma observação mais nova que a posição local;
- `lastProviderRequestAt`: quando o último comando foi enviado;
- `lastProviderReportAt`: timestamp do último relatório devolvido pelo provider;
- `lastReceivedAt`: quando a Connect|API efetivamente recebeu/persistiu a observação.

Assim é possível distinguir, por exemplo, “40 solicitações em 20 minutos” de “Google forneceu somente um timestamp novo nesse período”.

## Captura forense do protobuf real

A Connect|API oferece captura opt-in dos binários recebidos diretamente das superfícies Google antes da interpretação dos campos. O objetivo é permitir engenharia reversa controlada de campos ainda desconhecidos sem adulterar o payload.

No Manager da instância Find Hub, em **Dispositivos**, estão disponíveis:

- **Capturar SPOT .pb** — resposta bruta `DevicesList` do catálogo SPOT;
- **Capturar Android .pb** — resposta bruta `DevicesList` do catálogo Android;
- **Capturar DeviceUpdate .pb** — envia um Locate para o dispositivo selecionado, correlaciona pelo `requestUuid` e entrega o primeiro envelope FCM `DeviceUpdate` bruto recebido.

A API também permite consultar manualmente os catálogos complementares definidos pelo protobuf de referência:

```text
spot
android
auto
fastpair
supervised
```

Endpoint:

```http
POST /findhub/protocol/capture/catalog/:catalog/:instanceName
```

Para uma captura FCM:

```http
POST /findhub/protocol/capture/device-update/:deviceId/:instanceName
Content-Type: application/json

{
  "timeoutMs": 120000
}
```

As respostas usam `application/x-protobuf` e `Content-Disposition: attachment`.

A captura **não**:

- grava o protobuf bruto no banco;
- grava o payload bruto no diagnóstico normal;
- modifica credenciais;
- exige desvincular/revincular a conta;
- altera histórico, tracking ou Traccar.

Os arquivos podem conter identificadores do aparelho, e-mails presentes em `AccessInformation` e blobs criptográficos cifrados do Find Hub. Devem ser tratados como material sensível.

Esses arquivos são os artefatos preferidos para investigar campos não nomeados pelo `DeviceUpdate.proto`, inclusive candidatos a status do aparelho, bateria, IMEI, MEID, serial ou outros metadados que possam existir em campos protobuf ainda desconhecidos.

### Catálogos adicionais observados no proto de referência

O `DeviceType` fornecido pelo GoogleFindMyTools declara:

```text
UNKNOWN_DEVICE_TYPE = 0
ANDROID_DEVICE = 1
SPOT_DEVICE = 2
TEST_DEVICE_TYPE = 3
AUTO_DEVICE = 4
FASTPAIR_DEVICE = 5
SUPERVISED_ANDROID_DEVICE = 7
```

A sincronização da Connect|API mantém SPOT como catálogo principal e consulta Android, Auto, Fast Pair e Supervised Android como fontes complementares best-effort. Falha ou indisponibilidade de uma fonte complementar não remove o catálogo SPOT já obtido.

## Recursos presentes no material e que pertencem a outro ciclo

`GoogleFindMyTools` também contém um fluxo de fabricação/provisionamento de rastreadores BLE próprios:

- `CreateBleDevice`;
- geração de EIK/EID;
- upload de `PrecomputedPublicKeyIds`;
- rotação periódica de IDs;
- chaves de ringing/recovery/unwanted-tracking;
- firmware ESP32/Zephyr.

Esse fluxo cria material criptográfico que precisa ser guardado e renovado de forma diferente das credenciais de uma conta existente. Ele não deve ser misturado silenciosamente ao cadastro de celulares/acessórios já pertencentes à conta. Sua portabilidade exige armazenamento cifrado dedicado e recuperação/backup do segredo de fabricação.

## Segurança

O Manager e as APIs públicas não retornam:

- encrypted identity key;
- encrypted account key;
- owner key;
- shared key;
- AAS token;
- FCM private key;
- advertisement/identity key de um tracker customizado.

Quando é útil correlacionar uma identidade criptográfica sem revelar o segredo, a API retorna somente fingerprint SHA-256.
