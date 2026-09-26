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
| Tipo do identificador | IdentifierInformationType | ANDROID / SPOT / UNKNOWN |
| Tipos detalhados | SpotDeviceType | Suportados sem reduzir tudo a TRACKER |
| Fabricante e modelo | DeviceRegistration | Persistidos |
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

## Campos não demonstrados pelas referências fornecidas

Os arquivos analisados **não expõem**, na superfície usada por essas referências:

- percentual de bateria;
- IMEI;
- MEID;
- número de série;
- SSID atual;
- RSSI Wi-Fi;
- intensidade do sinal celular.

O wrapper `find-my-device-rest-api` mantém `battery_level` como `null` para `SPOT_DEVICE`; portanto o Connect|API não converte esse placeholder em telemetria real.

Se uma futura referência comprovada revelar outra RPC/superfície Google para esses dados, ela deve ser incorporada como capacidade adicional, preservando a origem do dado.

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
