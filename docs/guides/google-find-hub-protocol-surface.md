# Google Find Hub — superfície de protocolo aprendida das referências

Esta implementação foi revisada contra os dois pacotes de referência fornecidos para a evolução do Connect|API:

- `GoogleFindMyTools`: referência principal do wire Nova/SPOT, protobufs, FCM/MCS, criptografia, catálogo, localização e ações;
- `find-my-device-rest-api`: wrapper REST sobre a mesma família de protocolo, útil para cache, force refresh, polling e seleção do relatório mais recente.

Nenhum campo é fabricado. Quando o material fornecido não demonstra uma capacidade, o Connect|API declara essa capacidade como indisponível em vez de devolver um valor sintético.

## Recursos comprovados e portados

| Recurso | Origem no material | Connect|API |
| --- | --- | --- |
| Catálogo por seletores SPOT / ANDROID / AUTO / FASTPAIR / SUPERVISED | Nova ListDevices | Suportado; seletores são tratados como caminhos de descoberta, não como tipo semântico do aparelho |
| Todos os IDs canônicos | DeviceMetadata / CanonicIds | Persistidos e expostos |
| Tipo do identificador | IdentifierInformationType + captura viva | ANDROID / SPOT / SUPERVISED_ANDROID / UNKNOWN |
| Tipos detalhados | SpotDeviceType | Suportados sem reduzir tudo a TRACKER |
| Fabricante e modelo | DeviceRegistration + catálogo vivo 2026 | Persistidos |
| Fast Pair Model ID | DeviceRegistration.fastPairModelId | Persistido quando a semântica é compatível; em PHONE o field 21 foi comprovado como product/variant name, não Fast Pair |
| Data de pareamento | DeviceRegistration.pairDate | Persistida |
| Ownership/acesso | DeviceInformation.accessInformation | Persistido e exibido |
| Owner key version | EncryptedUserSecrets.ownerKeyVersion | Persistido |
| Material criptográfico | EncryptedUserSecrets | Somente fingerprints SHA-256; chaves brutas não são expostas |
| Mínimo de agregação de rede | minLocationsNeededForAggregation | Persistido |
| Locate ativo | ExecuteAction.locateTracker | Suportado |
| Tocar som | ExecuteAction.startSound | Suportado quando o provider anuncia action field 31; fallback legado para SPOT sem capabilities |
| Parar som | ExecuteAction.stopSound | Suportado quando o provider anuncia action field 32; fallback legado para SPOT sem capabilities |
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

### Correlação real: Redmi Note 14 entre DevicesList e DeviceUpdate

Em 2026-09-26 foram comparados, para o mesmo Redmi Note 14, um `DevicesList` solicitado como `ANDROID`, outro solicitado como `SPOT` e um `DeviceUpdate` recebido após Locate. Os binários privados não são versionados; somente fixtures sintéticas sanitizadas entram nos testes.

A correlação mostrou:

- os catálogos solicitados como `SPOT`, `ANDROID`, `AUTO`, `FASTPAIR` e `SUPERVISED` devolveram o mesmo conjunto de dispositivos;
- removendo somente `providerResponseAt`, o `DeviceMetadata` do Redmi Note 14 é byte a byte idêntico nos cinco seletores; o mesmo vale para o segundo dispositivo supervisionado retornado pela conta;
- nas cinco respostas, o Redmi Note 14 continua declarando `identifierType=ANDROID`; o selector usado na requisição não reescreve o tipo do dispositivo;
- a única diferença observada entre essas cinco capturas foi o timestamp de resposta do provider;
- em cada resposta, o `responseTime` do envelope e o `DeviceMetadata.field12` dos dispositivos carregam o mesmo instante, validando o fallback `metadata.field12 -> payload.field4` usado pelo decoder;
- a diferença de três bytes observada no arquivo SUPERVISED é explicada apenas pelo tamanho da codificação varint desse timestamp, não por ausência de campos;
- no catálogo, o Redmi Note 14 aparece com `identifierType=ANDROID`, ID numérico Android, canonical ID, modelo `24117RN76L`, fabricante `Xiaomi`, codinome `tanzanite`, produto `tanzanite_global`, operadora e IMEI;
- no `DeviceUpdate` de Locate, o mesmo canonical ID aparece com `identifierType=SPOT`;
- portanto `identifierType` descreve a superfície/envelope retornado e **não deve ser usado isoladamente como capability gate**;
- o catálogo do aparelho anuncia action fields `31` e `32`, e o DeviceUpdate conserva essas duas capabilities, confirmando Start Sound e Stop Sound para esse telefone mesmo quando o catálogo o classifica como `ANDROID`;
- o `DeviceRegistration` embutido no DeviceUpdate é **byte a byte idêntico** ao registration embutido no catálogo moderno do mesmo aparelho;
- por isso os registration fields ainda anônimos `11`, `22`, `24`, `25`, `33` e `40` observados nessa amostra pertencem ao bloco estável de registro/metadata e não devem ser tratados como bateria ou sinal;
- registration field `21` contém `tanzanite_global`, enquanto o catálogo moderno expõe separadamente o codinome `tanzanite` em status field `5`. Para `PHONE`, field `21` é tratado como `productName`, não como `fastPairModelId` nem como `deviceCodename`;
- o relatório de localização contém `accuracy=100.0`; esse valor é precisão em metros e **não** percentual de bateria;
- o timestamp do relatório pode ser anterior ao horário em que a Connect|API recebeu o envelope, reforçando a distinção entre nova resposta do provider e nova observação de posição.

O decoder preserva a interpretação legada de field `21` como Fast Pair apenas para tipos não-`PHONE`, onde essa semântica ainda é compatível com o proto de referência.

### Candidato ainda não confirmado para bateria

No mesmo par de catálogos existe um segundo dispositivo supervisionado pelo Family Link. Seu status inclui o caminho protobuf `32.1 = 53`.

O valor `53` é numericamente compatível com um percentual de bateria, mas **uma única observação não comprova essa semântica**. A Connect|API preserva o valor como flag wire `providerFlags["32.1"] = 53` e continua expondo `battery.supported=false`.

A promoção desse campo para `batteryLevel` só deve ocorrer depois de comparar novas capturas com o nível de bateria conhecido do mesmo aparelho e observar correlação consistente.

As capturas atuais ainda **não demonstram de forma segura** MEID, número de série, SSID/RSSI Wi-Fi ou intensidade celular.

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

As capturas reais de 2026 mostraram que SPOT, Android, Auto, Fast Pair e Supervised podem devolver o mesmo catálogo completo. Por isso a Connect|API trata os cinco valores como caminhos de descoberta best-effort: consulta SPOT primeiro e, em seguida, Android, Auto, Fast Pair e Supervised em paralelo; aceita qualquer resposta legível e deduplica por `googleDeviceId`. SPOT permanece apenas como desempate final de compatibilidade quando o mesmo dispositivo aparece em múltiplas respostas; sua indisponibilidade isolada não derruba a descoberta.

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
