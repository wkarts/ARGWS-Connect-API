export type FindHubProtocolCaptureStatus = 'live' | 'internal-live' | 'request-template' | 'reference-only';

export type FindHubProtocolKind =
  | 'auth'
  | 'transport'
  | 'operation'
  | 'push'
  | 'network'
  | 'security'
  | 'provisioning'
  | 'anti-stalking'
  | 'crypto';

export interface FindHubProtocolInventoryItem {
  key: string;
  family: string;
  protocol: string;
  kind: FindHubProtocolKind;
  status: FindHubProtocolCaptureStatus;
  individual: boolean;
  archive: boolean;
  variants?: string[];
  transport?: string;
  endpoint?: string;
  messages?: string[];
  enums?: string[];
  sources: string[];
  description: string;
  sensitive?: boolean;
}

export interface FindHubProtocolSchemaCatalogItem {
  key: string;
  source: string;
  provenance: string;
  messages: string[];
  enums: string[];
}

export interface FindHubZipEntry {
  name: string;
  data: Buffer | string;
}

const sourceGoogleFindMyTools = 'leonboe1/GoogleFindMyTools';
const sourceGoFindMy = 'dylanmazurek/go-findmy';
const sourceTraccarRelay = 'traccar/traccar-relay';
const sourceConnectApi = 'wkarts/ARGWS-Connect-API';

export const FINDHUB_PROTOBUF_SCHEMA_CATALOG: readonly FindHubProtocolSchemaCatalogItem[] = [
  {
    key: 'android-checkin',
    source: 'Auth/firebase_messaging/proto/android_checkin.proto',
    provenance: sourceGoogleFindMyTools,
    messages: ['ChromeBuildProto', 'AndroidCheckinProto'],
    enums: ['Platform', 'Channel', 'DeviceType'],
  },
  {
    key: 'checkin',
    source: 'Auth/firebase_messaging/proto/checkin.proto',
    provenance: sourceGoogleFindMyTools,
    messages: ['GservicesSetting', 'AndroidCheckinRequest', 'AndroidCheckinResponse'],
    enums: [],
  },
  {
    key: 'mcs',
    source: 'Auth/firebase_messaging/proto/mcs.proto',
    provenance: sourceGoogleFindMyTools,
    messages: [
      'HeartbeatPing',
      'HeartbeatAck',
      'ErrorInfo',
      'Setting',
      'HeartbeatStat',
      'HeartbeatConfig',
      'ClientEvent',
      'LoginRequest',
      'LoginResponse',
      'StreamErrorStanza',
      'Close',
      'Extension',
      'IqStanza',
      'AppData',
      'DataMessageStanza',
      'StreamAck',
      'SelectiveAck',
    ],
    enums: ['Type', 'AuthService', 'IqType'],
  },
  {
    key: 'common',
    source: 'ProtoDecoders/Common.proto',
    provenance: sourceGoogleFindMyTools,
    messages: [
      'Time',
      'LocationReport',
      'SemanticLocation',
      'GeoLocation',
      'EncryptedReport',
      'GetEidInfoForE2eeDevicesRequest',
    ],
    enums: ['Status'],
  },
  {
    key: 'device-update',
    source: 'ProtoDecoders/DeviceUpdate.proto',
    provenance: sourceGoogleFindMyTools,
    messages: [
      'GetEidInfoForE2eeDevicesResponse',
      'EncryptedOwnerKeyAndMetadata',
      'DevicesList',
      'DevicesListRequest',
      'DevicesListRequestPayload',
      'ExecuteActionRequest',
      'ExecuteActionRequestMetadata',
      'GcmCloudMessagingIdProtobuf',
      'ExecuteActionType',
      'ExecuteActionLocateTrackerType',
      'ExecuteActionSoundType',
      'ExecuteActionScope',
      'ExecuteActionDeviceIdentifier',
      'DeviceUpdate',
      'DeviceMetadata',
      'ImageInformation',
      'IdentitfierInformation',
      'PhoneInformation',
      'CanonicIds',
      'CanonicId',
      'DeviceInformation',
      'DeviceTypeInformation',
      'DeviceRegistration',
      'EncryptedUserSecrets',
      'LocationInformation',
      'LocationsAndTimestampsWrapper',
      'RecentLocationAndNetworkLocations',
      'AccessInformation',
      'RequestMetadata',
      'EncryptionUnlockRequestExtras',
      'SecurityDomain',
      'Location',
      'RegisterBleDeviceRequest',
      'E2EEPublicKeyRegistration',
      'PublicKeyIdList',
      'PublicKeyIdInfo',
      'TruncatedEID',
      'UploadPrecomputedPublicKeyIdsRequest',
      'DevicePublicKeyIds',
      'DeviceCapabilities',
      'DeviceDescription',
      'DeviceComponentInformation',
    ],
    enums: ['DeviceType', 'SpotContributorType', 'DeviceComponent', 'IdentifierInformationType', 'SpotDeviceType'],
  },
  {
    key: 'location-reports-upload',
    source: 'ProtoDecoders/LocationReportsUpload.proto',
    provenance: sourceGoogleFindMyTools,
    messages: [
      'LocationReportsUpload',
      'Report',
      'Advertisement',
      'Identifier',
      'ClientMetadata',
      'ClientVersionInformation',
    ],
    enums: [],
  },
  {
    key: 'tos-acceptance',
    source: 'pkg/nova/models/protos/bindings/tosacceptance.pb.go',
    provenance: sourceGoFindMy,
    messages: ['ToSAcceptance'],
    enums: [],
  },
];

export const FINDHUB_PROTOCOL_INVENTORY: readonly FindHubProtocolInventoryItem[] = [
  {
    key: 'auth.embedded-setup',
    family: 'Google Account',
    protocol: 'EmbeddedSetup / Credential Provider bootstrap',
    kind: 'auth',
    status: 'reference-only',
    individual: false,
    archive: true,
    transport: 'HTTPS',
    endpoint: 'https://accounts.google.com/EmbeddedSetup',
    sources: [sourceConnectApi],
    description: 'Superfície de bootstrap/vinculação de conta conhecida pelo produto; não exporta credenciais.',
    sensitive: true,
  },
  {
    key: 'auth.android-aas-token',
    family: 'Google Android Auth',
    protocol: 'AAS token retrieval',
    kind: 'auth',
    status: 'internal-live',
    individual: false,
    archive: true,
    transport: 'HTTPS',
    endpoint: 'https://android.clients.google.com/auth',
    sources: [sourceConnectApi, sourceGoogleFindMyTools],
    description: 'Token AAS usado para derivar service tokens autorizados da conta.',
    sensitive: true,
  },
  {
    key: 'auth.android-adm-token',
    family: 'Google Android Auth',
    protocol: 'ADM service token',
    kind: 'auth',
    status: 'internal-live',
    individual: false,
    archive: true,
    variants: ['android_device_manager'],
    transport: 'HTTPS',
    endpoint: 'https://android.clients.google.com/auth',
    sources: [sourceConnectApi, sourceGoogleFindMyTools, sourceGoFindMy],
    description: 'Service token usado pelo transporte Nova/Android Device Manager.',
    sensitive: true,
  },
  {
    key: 'auth.android-spot-token',
    family: 'Google Android Auth',
    protocol: 'Spot service token',
    kind: 'auth',
    status: 'internal-live',
    individual: false,
    archive: true,
    variants: ['spot'],
    transport: 'HTTPS',
    endpoint: 'https://android.clients.google.com/auth',
    sources: [sourceConnectApi, sourceGoogleFindMyTools],
    description: 'Service token usado pela Spot gRPC API.',
    sensitive: true,
  },
  {
    key: 'fcm.android-checkin',
    family: 'FCM Registration',
    protocol: 'AndroidCheckinRequest / AndroidCheckinResponse',
    kind: 'transport',
    status: 'internal-live',
    individual: false,
    archive: true,
    transport: 'HTTPS protobuf',
    endpoint: 'https://android.clients.google.com/checkin',
    messages: ['AndroidCheckinProto', 'ChromeBuildProto', 'AndroidCheckinRequest', 'AndroidCheckinResponse'],
    sources: [sourceConnectApi, sourceGoogleFindMyTools, sourceTraccarRelay],
    description: 'Check-in Android/GCM que fornece androidId e securityToken para o canal push.',
    sensitive: true,
  },
  {
    key: 'fcm.gcm-register3',
    family: 'FCM Registration',
    protocol: 'Legacy GCM register3',
    kind: 'transport',
    status: 'internal-live',
    individual: false,
    archive: true,
    transport: 'HTTPS form',
    endpoint: 'https://android.clients.google.com/c2dm/register3',
    sources: [sourceConnectApi, sourceTraccarRelay],
    description: 'Registro GCM legado usado como etapa do bootstrap FCM.',
    sensitive: true,
  },
  {
    key: 'fcm.firebase-installations',
    family: 'FCM Registration',
    protocol: 'Firebase Installations',
    kind: 'transport',
    status: 'internal-live',
    individual: false,
    archive: true,
    transport: 'HTTPS JSON',
    endpoint: 'https://firebaseinstallations.googleapis.com/v1/',
    sources: [sourceConnectApi, sourceTraccarRelay],
    description: 'Criação da Firebase Installation e obtenção do auth token da instalação.',
    sensitive: true,
  },
  {
    key: 'fcm.webpush-registration',
    family: 'FCM Registration',
    protocol: 'FCM WebPush registration',
    kind: 'transport',
    status: 'internal-live',
    individual: false,
    archive: true,
    transport: 'HTTPS JSON',
    endpoint: 'https://fcmregistrations.googleapis.com/v1/',
    sources: [sourceConnectApi, sourceTraccarRelay],
    description: 'Registra endpoint WebPush/P-256 e devolve o registration token usado pelo Find Hub.',
    sensitive: true,
  },
  {
    key: 'fcm.webpush-endpoint',
    family: 'FCM Registration',
    protocol: 'FCM send endpoint identity',
    kind: 'transport',
    status: 'internal-live',
    individual: false,
    archive: true,
    transport: 'HTTPS',
    endpoint: 'https://fcm.googleapis.com/fcm/send/',
    sources: [sourceConnectApi, sourceTraccarRelay],
    description: 'Endpoint FCM embutido no registro WebPush que referencia o token GCM.',
    sensitive: true,
  },
  {
    key: 'mcs.tls-transport',
    family: 'MCS',
    protocol: 'Mobile Connection Server TLS stream',
    kind: 'transport',
    status: 'internal-live',
    individual: false,
    archive: true,
    transport: 'TLS framed protobuf',
    endpoint: 'mtalk.google.com:5228',
    messages: [
      'LoginRequest',
      'LoginResponse',
      'HeartbeatPing',
      'HeartbeatAck',
      'DataMessageStanza',
      'IqStanza',
      'Close',
      'StreamAck',
      'SelectiveAck',
      'StreamErrorStanza',
    ],
    sources: [sourceConnectApi, sourceGoogleFindMyTools, sourceTraccarRelay],
    description: 'Canal persistente MCS usado para receber pushes FCM do Find Hub.',
    sensitive: true,
  },
  {
    key: 'mcs.login',
    family: 'MCS',
    protocol: 'LoginRequest / LoginResponse',
    kind: 'transport',
    status: 'internal-live',
    individual: false,
    archive: true,
    transport: 'MCS protobuf tag 2/3',
    endpoint: 'mtalk.google.com:5228',
    messages: ['LoginRequest', 'LoginResponse', 'Setting', 'HeartbeatStat'],
    sources: [sourceConnectApi, sourceGoogleFindMyTools, sourceTraccarRelay],
    description: 'Autenticação da sessão MCS usando Android ID e security token.',
    sensitive: true,
  },
  {
    key: 'mcs.heartbeat',
    family: 'MCS',
    protocol: 'HeartbeatPing / HeartbeatAck',
    kind: 'transport',
    status: 'internal-live',
    individual: false,
    archive: true,
    transport: 'MCS protobuf tag 0/1',
    endpoint: 'mtalk.google.com:5228',
    messages: ['HeartbeatPing', 'HeartbeatAck', 'HeartbeatConfig', 'HeartbeatStat'],
    sources: [sourceConnectApi, sourceGoogleFindMyTools, sourceTraccarRelay],
    description: 'Keepalive e detecção de saúde da conexão MCS.',
  },
  {
    key: 'mcs.data-message',
    family: 'MCS',
    protocol: 'DataMessageStanza',
    kind: 'push',
    status: 'live',
    individual: false,
    archive: true,
    transport: 'MCS protobuf tag 8',
    endpoint: 'mtalk.google.com:5228',
    messages: ['DataMessageStanza', 'AppData'],
    sources: [sourceConnectApi, sourceGoogleFindMyTools, sourceTraccarRelay],
    description: 'Envelope push que transporta DeviceUpdate e outros dados FCM.',
    sensitive: true,
  },
  {
    key: 'mcs.iq-stanza',
    family: 'MCS',
    protocol: 'IqStanza',
    kind: 'transport',
    status: 'internal-live',
    individual: false,
    archive: true,
    transport: 'MCS protobuf tag 7',
    endpoint: 'mtalk.google.com:5228',
    messages: ['IqStanza', 'Extension'],
    sources: [sourceGoogleFindMyTools, sourceTraccarRelay],
    description: 'Stanza IQ do protocolo MCS.',
  },
  {
    key: 'mcs.stream-ack',
    family: 'MCS',
    protocol: 'StreamAck',
    kind: 'transport',
    status: 'reference-only',
    individual: false,
    archive: true,
    messages: ['StreamAck'],
    sources: [sourceGoogleFindMyTools],
    description: 'ACK de stream definido no proto MCS.',
  },
  {
    key: 'mcs.selective-ack',
    family: 'MCS',
    protocol: 'SelectiveAck',
    kind: 'transport',
    status: 'internal-live',
    individual: false,
    archive: true,
    messages: ['SelectiveAck', 'Extension'],
    sources: [sourceConnectApi, sourceGoogleFindMyTools],
    description: 'ACK seletivo por persistentId usado pela Connect|API após mensagens MCS.',
    sensitive: true,
  },
  {
    key: 'mcs.close-error',
    family: 'MCS',
    protocol: 'Close / StreamErrorStanza / ErrorInfo',
    kind: 'transport',
    status: 'internal-live',
    individual: false,
    archive: true,
    messages: ['Close', 'StreamErrorStanza', 'ErrorInfo'],
    sources: [sourceGoogleFindMyTools, sourceTraccarRelay],
    description: 'Encerramento e erro de stream MCS.',
  },
  {
    key: 'nova.devices-list',
    family: 'Nova',
    protocol: 'DevicesList',
    kind: 'operation',
    status: 'live',
    individual: true,
    archive: true,
    variants: ['spot', 'android', 'auto', 'fastpair', 'supervised'],
    transport: 'HTTPS protobuf',
    endpoint: 'https://android.googleapis.com/nova/nbe_list_devices',
    messages: ['DevicesListRequest', 'DevicesListRequestPayload', 'DevicesList', 'DeviceMetadata'],
    sources: [sourceConnectApi, sourceGoogleFindMyTools, sourceGoFindMy, sourceTraccarRelay],
    description: 'Request e response protobuf para os cinco seletores de catálogo observados.',
    sensitive: true,
  },
  {
    key: 'nova.execute-action.locate',
    family: 'Nova',
    protocol: 'ExecuteAction LocateTracker',
    kind: 'operation',
    status: 'live',
    individual: true,
    archive: true,
    transport: 'HTTPS protobuf + FCM/MCS response',
    endpoint: 'https://android.googleapis.com/nova/nbe_execute_action',
    messages: ['ExecuteActionRequest', 'ExecuteActionLocateTrackerType', 'DeviceUpdate'],
    sources: [sourceConnectApi, sourceGoogleFindMyTools, sourceGoFindMy, sourceTraccarRelay],
    description: 'Request protobuf Locate e DeviceUpdate FCM correlacionado por dispositivo.',
    sensitive: true,
  },
  {
    key: 'nova.execute-action.sound-start',
    family: 'Nova',
    protocol: 'ExecuteAction StartSound',
    kind: 'operation',
    status: 'request-template',
    individual: true,
    archive: true,
    transport: 'HTTPS protobuf',
    endpoint: 'https://android.googleapis.com/nova/nbe_execute_action',
    messages: ['ExecuteActionRequest', 'ExecuteActionSoundType'],
    sources: [sourceConnectApi, sourceGoogleFindMyTools, sourceTraccarRelay],
    description: 'Request protobuf real de início de som; o Protocol Lab não envia o comando.',
    sensitive: true,
  },
  {
    key: 'nova.execute-action.sound-stop',
    family: 'Nova',
    protocol: 'ExecuteAction StopSound',
    kind: 'operation',
    status: 'request-template',
    individual: true,
    archive: true,
    transport: 'HTTPS protobuf',
    endpoint: 'https://android.googleapis.com/nova/nbe_execute_action',
    messages: ['ExecuteActionRequest', 'ExecuteActionSoundType'],
    sources: [sourceConnectApi, sourceGoogleFindMyTools, sourceTraccarRelay],
    description: 'Request protobuf real de parada de som; o Protocol Lab não envia o comando.',
    sensitive: true,
  },
  {
    key: 'fcm.device-update',
    family: 'FCM / Find Hub',
    protocol: 'DeviceUpdate push',
    kind: 'push',
    status: 'live',
    individual: true,
    archive: true,
    transport: 'MCS DataMessageStanza',
    messages: ['DeviceUpdate', 'DeviceMetadata', 'LocationInformation', 'RecentLocationAndNetworkLocations'],
    sources: [sourceConnectApi, sourceGoogleFindMyTools, sourceGoFindMy, sourceTraccarRelay],
    description: 'Envelope Find Hub recebido via FCM/MCS após ações e atualizações do provider.',
    sensitive: true,
  },
  {
    key: 'spot.get-eid-info',
    family: 'Spot gRPC',
    protocol: 'GetEidInfoForE2eeDevices',
    kind: 'operation',
    status: 'live',
    individual: true,
    archive: true,
    transport: 'HTTP/2 gRPC',
    endpoint: 'https://spot-pa.googleapis.com/google.internal.spot.v1.SpotService/GetEidInfoForE2eeDevices',
    messages: ['GetEidInfoForE2eeDevicesRequest', 'GetEidInfoForE2eeDevicesResponse', 'EncryptedOwnerKeyAndMetadata'],
    sources: [sourceConnectApi, sourceGoogleFindMyTools, sourceTraccarRelay],
    description: 'Request e response protobuf E2EE/owner-key envelope da conta.',
    sensitive: true,
  },
  {
    key: 'spot.create-ble-device',
    family: 'Spot gRPC',
    protocol: 'CreateBleDevice',
    kind: 'provisioning',
    status: 'reference-only',
    individual: false,
    archive: true,
    transport: 'HTTP/2 gRPC',
    endpoint: 'https://spot-pa.googleapis.com/google.internal.spot.v1.SpotService/CreateBleDevice',
    messages: [
      'RegisterBleDeviceRequest',
      'E2EEPublicKeyRegistration',
      'DeviceCapabilities',
      'DeviceDescription',
      'DeviceComponentInformation',
    ],
    sources: [sourceGoogleFindMyTools],
    description: 'Provisionamento/fabricação de tracker BLE próprio; não é executado automaticamente.',
    sensitive: true,
  },
  {
    key: 'spot.upload-precomputed-public-key-ids',
    family: 'Spot gRPC',
    protocol: 'UploadPrecomputedPublicKeyIds',
    kind: 'provisioning',
    status: 'reference-only',
    individual: false,
    archive: true,
    transport: 'HTTP/2 gRPC',
    endpoint: 'https://spot-pa.googleapis.com/google.internal.spot.v1.SpotService/UploadPrecomputedPublicKeyIds',
    messages: [
      'UploadPrecomputedPublicKeyIdsRequest',
      'DevicePublicKeyIds',
      'PublicKeyIdList',
      'PublicKeyIdInfo',
      'TruncatedEID',
    ],
    sources: [sourceGoogleFindMyTools],
    description: 'Upload de EIDs/precomputed public key IDs de trackers customizados.',
    sensitive: true,
  },
  {
    key: 'findhub.location-reports-upload',
    family: 'Find Hub Network',
    protocol: 'LocationReportsUpload',
    kind: 'network',
    status: 'reference-only',
    individual: false,
    archive: true,
    transport: 'protobuf',
    messages: [
      'LocationReportsUpload',
      'Report',
      'Advertisement',
      'Identifier',
      'ClientMetadata',
      'ClientVersionInformation',
      'LocationReport',
    ],
    sources: [sourceGoogleFindMyTools, sourceGoFindMy],
    description: 'Upload de observações/crowdsourcing contendo advertisement, tempo e localização.',
    sensitive: true,
  },
  {
    key: 'security-domain.finder-hw',
    family: 'Google Security Domain',
    protocol: 'EncryptionUnlockRequestExtras / finder_hw',
    kind: 'security',
    status: 'request-template',
    individual: true,
    archive: true,
    transport: 'HTTPS + protobuf/base64',
    endpoint: 'https://accounts.google.com/encryption/unlock/android',
    messages: ['EncryptionUnlockRequestExtras', 'SecurityDomain'],
    sources: [sourceConnectApi, sourceGoogleFindMyTools],
    description: 'Request do domínio finder_hw; o Protocol Lab não executa o desbloqueio.',
    sensitive: true,
  },
  {
    key: 'key-backup.shared-key',
    family: 'Key Backup',
    protocol: 'finder_hw shared-key flow',
    kind: 'security',
    status: 'reference-only',
    individual: false,
    archive: true,
    transport: 'Browser/security-domain flow',
    endpoint: 'https://accounts.google.com/encryption/unlock/android',
    sources: [sourceGoogleFindMyTools],
    description: 'Fluxo de recuperação da shared key E2EE usado para descriptografar relatórios.',
    sensitive: true,
  },
  {
    key: 'nova.tos-acceptance',
    family: 'Nova',
    protocol: 'ToSAcceptance',
    kind: 'operation',
    status: 'reference-only',
    individual: false,
    archive: true,
    messages: ['ToSAcceptance'],
    sources: [sourceGoFindMy],
    description: 'Mensagem ToSAcceptance observada em bindings públicos do ecossistema Nova.',
  },
  {
    key: 'dult.owner-lookup',
    family: 'DULT',
    protocol: 'Owner Lookup',
    kind: 'anti-stalking',
    status: 'reference-only',
    individual: false,
    archive: true,
    transport: 'HTTPS owner-lookup link',
    sources: [sourceGoogleFindMyTools],
    description: 'Superfície DULT/anti-stalking associada a EIDs e identificação de owner.',
    sensitive: true,
  },
  {
    key: 'ble.findhub-advertisement',
    family: 'BLE / FMDN',
    protocol: 'Find Hub Advertisement / Truncated EID',
    kind: 'network',
    status: 'reference-only',
    individual: false,
    archive: true,
    messages: ['Advertisement', 'Identifier', 'TruncatedEID'],
    sources: [sourceGoogleFindMyTools],
    description: 'Estrutura BLE/EID representada nos reports de rede e provisionamento de trackers.',
    sensitive: true,
  },
  {
    key: 'crypto.eid-generation',
    family: 'FMDN Crypto',
    protocol: 'EID generation / rotation',
    kind: 'crypto',
    status: 'reference-only',
    individual: false,
    archive: true,
    sources: [sourceGoogleFindMyTools],
    description: 'Geração/rotação de EIDs usados por trackers e advertisements.',
    sensitive: true,
  },
  {
    key: 'crypto.key-derivation',
    family: 'FMDN Crypto',
    protocol: 'Key derivation',
    kind: 'crypto',
    status: 'reference-only',
    individual: false,
    archive: true,
    sources: [sourceGoogleFindMyTools],
    description: 'Derivação de chaves usada pelos fluxos E2EE/FMDN.',
    sensitive: true,
  },
  {
    key: 'crypto.foreign-tracker',
    family: 'FMDN Crypto',
    protocol: 'Foreign tracker cryptor',
    kind: 'crypto',
    status: 'reference-only',
    individual: false,
    archive: true,
    sources: [sourceGoogleFindMyTools],
    description: 'Primitivas de criptografia para trackers estrangeiros/observados.',
    sensitive: true,
  },
];

export function findHubProtocolInventory(): FindHubProtocolInventoryItem[] {
  return FINDHUB_PROTOCOL_INVENTORY.map((item) => ({
    ...item,
    variants: item.variants ? [...item.variants] : undefined,
    messages: item.messages ? [...item.messages] : undefined,
    enums: item.enums ? [...item.enums] : undefined,
    sources: [...item.sources],
  }));
}

export function findHubProtocolSchemaCatalog(): FindHubProtocolSchemaCatalogItem[] {
  return FINDHUB_PROTOBUF_SCHEMA_CATALOG.map((item) => ({
    ...item,
    messages: [...item.messages],
    enums: [...item.enums],
  }));
}

export function findHubProtocolInventorySummary() {
  const artifacts = findHubProtocolInventory();
  const schemas = findHubProtocolSchemaCatalog();
  return {
    protocols: artifacts.length,
    families: new Set(artifacts.map((item) => item.family)).size,
    live: artifacts.filter((item) => item.status === 'live').length,
    internalLive: artifacts.filter((item) => item.status === 'internal-live').length,
    requestTemplates: artifacts.filter((item) => item.status === 'request-template').length,
    referenceOnly: artifacts.filter((item) => item.status === 'reference-only').length,
    protobufSchemas: schemas.length,
    protobufMessages: schemas.reduce((count, item) => count + item.messages.length, 0),
    protobufEnums: schemas.reduce((count, item) => count + item.enums.length, 0),
  };
}

export function safeProtocolPathSegment(value: unknown): string {
  const normalized = String(value || 'artifact')
    .normalize('NFKD')
    .replace(/[^A-Za-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 96);
  return normalized || 'artifact';
}

export function findHubProtocolLabReadme(): string {
  return [
    'ARGWS Connect|API - Google Find Hub Protocol Lab',
    '',
    'Este inventário NÃO é uma lista curada de poucos protocolos.',
    'Ele inclui todas as superfícies e todos os schemas protobuf conhecidos nas referências catalogadas pela Connect|API.',
    '',
    'Pacote gerado sob demanda. A captura não persiste os binários no banco.',
    'Arquivos .pb podem conter identificadores, e-mails, IDs canônicos, registration IDs FCM e material criptografado.',
    'Trate este ZIP como material sensível; não publique em repositórios ou logs.',
    '',
    'Conteúdo:',
    '- protocol-inventory.json: todas as superfícies conhecidas;',
    '- protocol-schema-catalog.json: todos os schemas/mensagens/enums protobuf conhecidos;',
    '- protocols/*.json: um descritor por superfície conhecida, inclusive internal-live e reference-only;',
    '- schemas/*.json: um descritor por arquivo/schema protobuf conhecido;',
    '- requests/nova/: requests DevicesList e ExecuteAction;',
    '- responses/nova/: responses DevicesList reais;',
    '- requests/spot/ e responses/spot/: GetEidInfoForE2eeDevices;',
    '- requests/security-domain/: template finder_hw;',
    '- devices/<device>/: requests Locate/Sound e DeviceUpdate real quando disponível;',
    '- references/: compatibilidade com descritores reference-only;',
    '- manifest.json: checksums, tamanhos, falhas e itens ignorados.',
    '',
    'Status:',
    '- live: captura/exportação direta disponível;',
    '- internal-live: protocolo realmente usado pelo runtime, porém ainda sem exportação raw individual;',
    '- request-template: request real pode ser gerado sem executar a operação mutável;',
    '- reference-only: superfície conhecida e documentada, mas sem captura ativa na Connect|API.',
    '',
    'O Lab nunca envia comandos de som ao montar o ZIP. DeviceUpdate exige um Locate real.',
    'Protocolos reference-only não são fabricados.',
    '',
  ].join('\n');
}

const CRC32_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let n = 0; n < 256; n += 1) {
    let value = n;
    for (let k = 0; k < 8; k += 1) value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
    table[n] = value >>> 0;
  }
  return table;
})();

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function dosTimestamp(date: Date): { time: number; date: number } {
  const year = Math.max(1980, date.getFullYear());
  return {
    time: (date.getHours() << 11) | (date.getMinutes() << 5) | Math.floor(date.getSeconds() / 2),
    date: ((year - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate(),
  };
}

export function createFindHubProtocolZip(entries: FindHubZipEntry[], createdAt = new Date()): Buffer {
  const localParts: Buffer[] = [];
  const centralParts: Buffer[] = [];
  const stamp = dosTimestamp(createdAt);
  let offset = 0;

  for (const entry of entries) {
    const name = Buffer.from(entry.name.replace(/\\/g, '/'), 'utf8');
    const data = Buffer.isBuffer(entry.data) ? entry.data : Buffer.from(entry.data, 'utf8');
    const checksum = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(stamp.time, 10);
    local.writeUInt16LE(stamp.date, 12);
    local.writeUInt32LE(checksum, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(stamp.time, 12);
    central.writeUInt16LE(stamp.date, 14);
    central.writeUInt32LE(checksum, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);
    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(entries.length, 8);
  end.writeUInt16LE(entries.length, 10);
  end.writeUInt32LE(centralDirectory.length, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);
  return Buffer.concat([...localParts, centralDirectory, end]);
}
