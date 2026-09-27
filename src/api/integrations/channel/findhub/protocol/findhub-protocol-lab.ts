export type FindHubProtocolCaptureStatus = 'live' | 'request-template' | 'reference-only';

export interface FindHubProtocolInventoryItem {
  key: string;
  family: string;
  protocol: string;
  status: FindHubProtocolCaptureStatus;
  individual: boolean;
  archive: boolean;
  variants?: string[];
  description: string;
  sensitive?: boolean;
}

export interface FindHubZipEntry {
  name: string;
  data: Buffer | string;
}

export const FINDHUB_PROTOCOL_INVENTORY: readonly FindHubProtocolInventoryItem[] = [
  { key: 'nova.devices-list', family: 'Nova', protocol: 'DevicesList', status: 'live', individual: true, archive: true, variants: ['spot', 'android', 'auto', 'fastpair', 'supervised'], description: 'Request e response protobuf para os cinco seletores de catálogo observados.', sensitive: true },
  { key: 'nova.execute-action.locate', family: 'Nova', protocol: 'ExecuteAction LocateTracker', status: 'live', individual: true, archive: true, description: 'Request protobuf e DeviceUpdate FCM correlacionado por dispositivo localizável.', sensitive: true },
  { key: 'nova.execute-action.sound-start', family: 'Nova', protocol: 'ExecuteAction StartSound', status: 'request-template', individual: true, archive: true, description: 'Request protobuf real do início de som; o Protocol Lab não envia o comando.', sensitive: true },
  { key: 'nova.execute-action.sound-stop', family: 'Nova', protocol: 'ExecuteAction StopSound', status: 'request-template', individual: true, archive: true, description: 'Request protobuf real da parada de som; o Protocol Lab não envia o comando.', sensitive: true },
  { key: 'spot.get-eid-info', family: 'Spot gRPC', protocol: 'GetEidInfoForE2eeDevices', status: 'live', individual: true, archive: true, description: 'Request e response protobuf E2EE/owner-key envelope da conta.', sensitive: true },
  { key: 'security-domain.finder-hw', family: 'Google Security Domain', protocol: 'EncryptionUnlockRequestExtras', status: 'request-template', individual: true, archive: true, description: 'Request protobuf finder_hw; o Protocol Lab não executa o desbloqueio.', sensitive: true },
  { key: 'location-reports-upload', family: 'Find Hub Network', protocol: 'LocationReportsUpload', status: 'reference-only', individual: false, archive: true, description: 'Upload de reports de rede/crowdsourcing; ainda sem captura ativa na Connect|API.' },
  { key: 'spot.create-ble-device', family: 'Spot gRPC', protocol: 'CreateBleDevice', status: 'reference-only', individual: false, archive: true, description: 'Provisionamento de tracker BLE próprio; nunca executado automaticamente pelo Lab.', sensitive: true },
  { key: 'spot.upload-precomputed-public-key-ids', family: 'Spot gRPC', protocol: 'UploadPrecomputedPublicKeyIds', status: 'reference-only', individual: false, archive: true, description: 'Upload de EIDs/precomputed public key IDs para trackers customizados.', sensitive: true },
  { key: 'fcm-mcs.transport', family: 'FCM/MCS', protocol: 'Push transport envelopes', status: 'reference-only', individual: false, archive: true, description: 'Camada de transporte abaixo do DeviceUpdate; envelope bruto ainda não exportado.', sensitive: true },
  { key: 'key-backup.finder-hw', family: 'Key Backup', protocol: 'finder_hw shared-key flow', status: 'reference-only', individual: false, archive: true, description: 'Fluxo de shared key/security domain; segredos descriptografados não são exportados.', sensitive: true },
  { key: 'dult.owner-lookup', family: 'DULT', protocol: 'Owner Lookup', status: 'reference-only', individual: false, archive: true, description: 'Superfície anti-stalking associada a EIDs; ainda sem captura ativa.' },
];

export function findHubProtocolInventory(): FindHubProtocolInventoryItem[] {
  return FINDHUB_PROTOCOL_INVENTORY.map((item) => ({
    ...item,
    variants: item.variants ? [...item.variants] : undefined,
  }));
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
    'Pacote gerado sob demanda. A captura não persiste os binários no banco.',
    'Arquivos .pb podem conter identificadores, e-mails, IDs canônicos, registration IDs FCM e material criptografado.',
    'Trate este ZIP como material sensível; não publique em repositórios ou logs.',
    '',
    'Conteúdo:',
    '- requests/nova/: requests DevicesList e ExecuteAction;',
    '- responses/nova/: responses DevicesList reais;',
    '- requests/spot/ e responses/spot/: GetEidInfoForE2eeDevices;',
    '- requests/security-domain/: template finder_hw;',
    '- devices/<device>/: requests Locate/Sound e DeviceUpdate real quando disponível;',
    '- references/: famílias conhecidas ainda reference-only;',
    '- protocol-inventory.json e manifest.json.',
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
