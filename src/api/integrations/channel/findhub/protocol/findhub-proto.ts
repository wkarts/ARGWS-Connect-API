import { randomUUID } from 'crypto';

import { FindHubDevice, FindHubPosition } from '../findhub.types';
import {
  bool,
  bytes,
  concat,
  fieldMessage,
  fieldString,
  fieldVarint,
  float32,
  int,
  repeatedBytes,
  sfixed32,
  string,
} from './protobuf';

export const DeviceType = { ANDROID: 1, SPOT: 2 } as const;
export const IdentifierType = { ANDROID: 1, SPOT: 2 } as const;

export function encodeDeviceListRequest(requestId = randomUUID(), deviceType: number = DeviceType.SPOT): Buffer {
  const payload = concat(fieldVarint(1, deviceType), fieldString(3, requestId));
  return fieldMessage(1, payload);
}

export function encodeExecuteLocateRequest(args: {
  googleDeviceId: string;
  fcmRegistrationId: string;
  requestUuid: string;
  clientUuid: string;
}): Buffer {
  const canonicalId = fieldString(1, args.googleDeviceId);
  const deviceIdentifier = fieldMessage(1, canonicalId);
  const scope = concat(fieldVarint(2, DeviceType.SPOT), fieldMessage(3, deviceIdentifier));

  const time = fieldVarint(1, 1732120060);
  const locate = concat(fieldMessage(2, time), fieldVarint(3, 2));
  const action = fieldMessage(30, locate);

  const gcm = fieldString(1, args.fcmRegistrationId);
  const metadata = concat(
    fieldVarint(1, DeviceType.SPOT),
    fieldString(2, args.requestUuid),
    fieldString(3, args.clientUuid),
    fieldMessage(4, gcm),
    fieldVarint(6, true),
  );

  return concat(fieldMessage(1, scope), fieldMessage(2, action), fieldMessage(3, metadata));
}

export function encodeGetEidInfoRequest(): Buffer {
  return concat(fieldVarint(1, -1), fieldVarint(2, true));
}

export function encodeSecurityUnlockExtras(sessionId: string = randomUUID()): Buffer {
  // SecurityDomain.unknown has implicit proto3 presence; omit its zero default.
  const domain = fieldString(1, 'finder_hw');
  return concat(fieldVarint(1, 1), fieldMessage(2, domain), fieldString(6, sessionId));
}

function canonicIds(identifier: Buffer): string[] {
  const direct = bytes(identifier, 3);
  const phone = bytes(identifier, 1);
  const containers = [phone ? bytes(phone, 2) : undefined, direct].filter((value): value is Buffer => Boolean(value));
  return [
    ...new Set(
      containers
        .flatMap((container) => repeatedBytes(container, 1))
        .map((item) => string(item, 1))
        .filter(Boolean),
    ),
  ] as string[];
}

function normalizeDeviceType(type: number | undefined): FindHubDevice['deviceType'] {
  if (type === 20) return 'PHONE';
  if (type === 22) return 'TABLET';
  if (type === 4) return 'WATCH';
  if (type === 2) return 'HEADPHONES';
  if (type === 26) return 'EARBUDS';
  if (type && type !== 0) return 'TRACKER';
  return 'UNKNOWN';
}

export function decodeDeviceMetadata(metadata: Buffer): Omit<FindHubDevice, 'id'>[] {
  const identifier = bytes(metadata, 1) ?? Buffer.alloc(0);
  const information = bytes(metadata, 4) ?? Buffer.alloc(0);
  const registration = bytes(information, 1) ?? Buffer.alloc(0);
  const deviceTypeInfo = bytes(registration, 2) ?? Buffer.alloc(0);
  const secrets = bytes(registration, 19) ?? Buffer.alloc(0);
  const identifierType = Number(int(identifier, 2) ?? 0n);
  const image = bytes(metadata, 6);
  const ids = canonicIds(identifier);
  const name = string(metadata, 5) || string(registration, 34) || 'Google Find Hub device';
  const deviceType = Number(int(deviceTypeInfo, 2) ?? 0n);
  const encryptedIdentityKey = bytes(secrets, 1);
  const ownerKeyVersion = Number(int(secrets, 3) ?? 0n);

  return ids.map((googleDeviceId) => ({
    googleDeviceId,
    name,
    identifierType:
      identifierType === IdentifierType.ANDROID
        ? 'ANDROID'
        : identifierType === IdentifierType.SPOT
          ? 'SPOT'
          : 'UNKNOWN',
    deviceType: normalizeDeviceType(deviceType),
    manufacturer: string(registration, 20),
    model: string(registration, 34),
    imageUrl: image ? string(image, 1) : undefined,
    encryptedIdentityKey: encryptedIdentityKey?.toString('base64'),
    ownerKeyVersion,
  }));
}

export function decodeDevicesList(payload: Buffer): Array<Omit<FindHubDevice, 'id'>> {
  return repeatedBytes(payload, 2).flatMap(decodeDeviceMetadata);
}

export type DecodedDeviceUpdate = {
  requestUuid?: string;
  deviceMetadata?: Buffer;
};

export function decodeDeviceUpdate(payload: Buffer): DecodedDeviceUpdate {
  const fcm = bytes(payload, 1);
  return {
    requestUuid: fcm ? string(fcm, 2) : undefined,
    deviceMetadata: bytes(payload, 3),
  };
}

export function decodeEncryptedOwnerKey(payload: Buffer): { encryptedOwnerKey: Buffer; ownerKeyVersion: number } {
  const metadata = bytes(payload, 4);
  if (!metadata) throw new Error('Find Hub owner-key metadata missing');
  const encryptedOwnerKey = bytes(metadata, 1);
  if (!encryptedOwnerKey) throw new Error('Find Hub encrypted owner key missing');
  return {
    encryptedOwnerKey,
    ownerKeyVersion: Number(int(metadata, 2) ?? 0n),
  };
}

export type EncryptedLocationReport = {
  status: number;
  semanticLocation?: string;
  publicKeyRandom: Buffer;
  encryptedLocation: Buffer;
  ownReport: boolean;
  deviceTimeOffset: number;
  accuracy?: number;
  timestampSeconds: number;
};

function decodeReport(report: Buffer, timestampSeconds: number): EncryptedLocationReport | null {
  const status = Number(int(report, 11) ?? 0n);
  if (status === 0) {
    const semantic = bytes(report, 5);
    return {
      status,
      semanticLocation: semantic ? string(semantic, 1) : undefined,
      publicKeyRandom: Buffer.alloc(0),
      encryptedLocation: Buffer.alloc(0),
      ownReport: false,
      deviceTimeOffset: 0,
      timestampSeconds,
    };
  }
  const geo = bytes(report, 10);
  const encrypted = geo ? bytes(geo, 1) : undefined;
  if (!geo || !encrypted) return null;
  return {
    status,
    publicKeyRandom: bytes(encrypted, 1) ?? Buffer.alloc(0),
    encryptedLocation: bytes(encrypted, 2) ?? Buffer.alloc(0),
    ownReport: bool(encrypted, 3),
    deviceTimeOffset: Number(int(geo, 2) ?? 0n),
    accuracy: float32(geo, 3),
    timestampSeconds,
  };
}

function timeSeconds(time?: Buffer): number {
  return time ? Number(int(time, 1) ?? 0n) : 0;
}

export function decodeLocationReports(deviceMetadata: Buffer): EncryptedLocationReport[] {
  const information = bytes(deviceMetadata, 4);
  const locationInformation = information ? bytes(information, 2) : undefined;
  const reports = locationInformation ? bytes(locationInformation, 3) : undefined;
  const recentAndNetwork = reports ? bytes(reports, 4) : undefined;
  if (!recentAndNetwork) return [];

  const decoded: EncryptedLocationReport[] = [];
  const recent = bytes(recentAndNetwork, 1);
  const recentTimestamp = timeSeconds(bytes(recentAndNetwork, 2));
  if (recent) {
    const report = decodeReport(recent, recentTimestamp);
    if (report) decoded.push(report);
  }

  const networks = repeatedBytes(recentAndNetwork, 5);
  const timestamps = repeatedBytes(recentAndNetwork, 6).map(timeSeconds);
  for (let index = 0; index < networks.length; index++) {
    const report = decodeReport(networks[index], timestamps[index] ?? recentTimestamp);
    if (report) decoded.push(report);
  }
  return decoded;
}

export function decodePlainLocation(payload: Buffer): Pick<FindHubPosition, 'latitude' | 'longitude' | 'altitude'> {
  const latitude = sfixed32(payload, 1);
  const longitude = sfixed32(payload, 2);
  if (latitude === undefined || longitude === undefined) throw new Error('Invalid decrypted Find Hub location');
  return {
    latitude: latitude / 1e7,
    longitude: longitude / 1e7,
    altitude: Number(int(payload, 3) ?? 0n),
  };
}

export function decodeDeviceRegistration(deviceMetadata: Buffer): {
  encryptedIdentityKey: Buffer;
  ownerKeyVersion: number;
} {
  const information = bytes(deviceMetadata, 4);
  const registration = information ? bytes(information, 1) : undefined;
  const secrets = registration ? bytes(registration, 19) : undefined;
  const encryptedIdentityKey = secrets ? bytes(secrets, 1) : undefined;
  if (!encryptedIdentityKey) throw new Error('Find Hub encrypted identity key missing');
  return {
    encryptedIdentityKey,
    ownerKeyVersion: Number(int(secrets!, 3) ?? 0n),
  };
}
