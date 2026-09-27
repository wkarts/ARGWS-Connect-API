import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  createFindHubProtocolZip,
  findHubProtocolInventory,
  findHubProtocolInventorySummary,
  findHubProtocolLabEnabled,
  findHubProtocolSchemaCatalog,
} from '../src/api/integrations/channel/findhub/protocol/findhub-protocol-lab';
import { FindHubNovaClient } from '../src/api/integrations/channel/findhub/protocol/nova.client';
import {
  decodeDeviceMetadata,
  decodeEncryptedOwnerKey,
  decodeLocationReports,
  DeviceType,
  encodeDeviceListRequest,
  encodeExecuteLocateRequest,
  encodeExecuteSoundRequest,
  encodeGetEidInfoRequest,
  encodeSecurityUnlockExtras,
} from '../src/api/integrations/channel/findhub/protocol/findhub-proto';
import {
  bytes,
  concat,
  fieldBytes,
  fieldMessage,
  fieldString,
  fieldVarint,
  int,
  string,
} from '../src/api/integrations/channel/findhub/protocol/protobuf';

const REQUEST_UUID = '11111111-2222-3333-4444-555555555555';
const CLIENT_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('Find Hub Protocol Lab keeps public research distinct from runtime dependencies', () => {
  const inventory = findHubProtocolInventory();
  const schemas = findHubProtocolSchemaCatalog();
  const serialized = JSON.stringify({ inventory, schemas });

  assert.doesNotMatch(serialized, /github\.com\/|go-findmy|traccar-relay/i);
  assert.ok(inventory.every((item) => Array.isArray(item.evidence) && item.evidence.length > 0));
  assert.ok(schemas.every((item) => item.evidence && item.schemaPath));
  assert.ok(inventory.some((item) => item.evidence.includes('argws-native')));
  assert.ok(inventory.some((item) => item.evidence.includes('live-wire-observation')));
  assert.ok(inventory.some((item) => item.evidence.includes('public-research-reference')));
});

test('Find Hub live GetEidInfo preserves stable 2026 metadata without inventing semantics', () => {
  const encryptedOwnerKey = Buffer.alloc(60, 7);
  const metadata = concat(
    fieldBytes(1, encryptedOwnerKey),
    fieldVarint(2, 1),
    fieldString(3, 'finder_hw'),
    fieldVarint(4, 83),
    fieldVarint(5, 1),
  );
  const response = concat(
    fieldBytes(3, Buffer.from([1])),
    fieldMessage(4, metadata),
    fieldBytes(5, Buffer.from([3])),
  );
  const decoded = decodeEncryptedOwnerKey(response);
  assert.equal(decoded.ownerKeyVersion, 1);
  assert.equal(decoded.securityDomain, 'finder_hw');
  assert.equal(decoded.encryptedOwnerKeyBytes, 60);
  assert.equal(decoded.encryptedOwnerKeyFingerprint?.length, 64);
  assert.deepEqual(decoded.providerWire, {
    'response.3.hex': '01',
    'metadata.4': 83,
    'metadata.5': 1,
    'response.5.hex': '03',
  });
});

test('Find Hub device list protobuf matches reference wire format', () => {
  assert.equal(
    encodeDeviceListRequest(REQUEST_UUID).toString('hex'),
    '0a2808021a2431313131313131312d323232322d333333332d343434342d353535353535353535353535',
  );
});

test('Find Hub Protocol Lab can be restricted to develop or explicitly enabled/disabled', () => {
  assert.equal(findHubProtocolLabEnabled({ NODE_ENV: 'development', FINDHUB_PROTOCOL_LAB_ENABLED: 'auto' }), true);
  assert.equal(findHubProtocolLabEnabled({ NODE_ENV: 'PROD', FINDHUB_PROTOCOL_LAB_ENABLED: 'auto' }), false);
  assert.equal(findHubProtocolLabEnabled({ NODE_ENV: 'PROD', FINDHUB_PROTOCOL_LAB_ENABLED: 'true' }), true);
  assert.equal(findHubProtocolLabEnabled({ NODE_ENV: 'development', FINDHUB_PROTOCOL_LAB_ENABLED: 'false' }), false);
});

test('Find Hub Protocol Lab inventories every known protocol family and protobuf schema', () => {
  const inventory = findHubProtocolInventory();
  const schemas = findHubProtocolSchemaCatalog();
  const summary = findHubProtocolInventorySummary();

  for (const key of [
    'auth.android-aas-token',
    'auth.android-adm-token',
    'auth.android-spot-token',
    'fcm.android-checkin',
    'fcm.gcm-register3',
    'fcm.firebase-installations',
    'fcm.webpush-registration',
    'fcm.subscribe',
    'fcm.api-v1',
    'fcm.doorbells',
    'mcs.tls-transport',
    'mcs.login',
    'mcs.heartbeat',
    'mcs.data-message',
    'mcs.iq-stanza',
    'mcs.stream-ack',
    'mcs.selective-ack',
    'nova.devices-list',
    'nova.execute-action.locate',
    'nova.execute-action.sound-start',
    'nova.execute-action.sound-stop',
    'fcm.device-update',
    'spot.get-eid-info',
    'spot.create-ble-device',
    'spot.upload-precomputed-public-key-ids',
    'findhub.location-reports-upload',
    'security-domain.finder-hw',
    'key-backup.shared-key',
    'nova.tos-acceptance',
    'dult.owner-lookup',
    'ble.findhub-advertisement',
    'crypto.eid-generation',
    'crypto.key-derivation',
    'crypto.foreign-tracker',
  ]) {
    assert.ok(inventory.some((item) => item.key === key), key);
  }

  assert.ok(inventory.some((item) => item.status === 'internal-live'));
  assert.ok(inventory.some((item) => item.status === 'request-template'));
  assert.ok(inventory.some((item) => item.status === 'reference-only'));
  assert.ok(summary.protocols >= 37);
  assert.equal(summary.enrichedProtocols, summary.protocols);
  for (const item of inventory) {
    assert.ok(item.applicationAreas?.length, `${item.key}: applicationAreas`);
    assert.ok(item.enrichmentTargets?.length, `${item.key}: enrichmentTargets`);
  }
  assert.equal(summary.protobufSchemas, 7);
  assert.equal(summary.protobufMessages, 77);
  assert.equal(summary.protobufEnums, 12);
  assert.equal(schemas.reduce((count, item) => count + item.messages.length, 0), 77);
  assert.ok(schemas.some((item) => item.messages.includes('ToSAcceptance')));
  assert.ok(schemas.some((item) => item.messages.includes('SelectiveAck')));
  assert.ok(schemas.some((item) => item.messages.includes('RegisterBleDeviceRequest')));

  const zip = createFindHubProtocolZip([
    { name: 'manifest.json', data: '{"ok":true}' },
    { name: 'protocol-inventory.json', data: JSON.stringify({ artifacts: inventory, schemas }) },
    { name: 'requests/test.pb', data: Buffer.from([1, 2, 3]) },
  ]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.equal(zip.readUInt32LE(zip.length - 22), 0x06054b50);
  assert.ok(zip.includes(Buffer.from('manifest.json')));
  assert.ok(zip.includes(Buffer.from('protocol-inventory.json')));
  assert.ok(zip.includes(Buffer.from('requests/test.pb')));
});

test('Find Hub exposes every catalogue DeviceType defined by the supplied reference proto', () => {
  assert.deepEqual(DeviceType, {
    UNKNOWN: 0,
    ANDROID: 1,
    SPOT: 2,
    TEST: 3,
    AUTO: 4,
    FASTPAIR: 5,
    SUPERVISED_ANDROID: 7,
  });
  assert.equal(encodeDeviceListRequest('req', DeviceType.ANDROID).toString('hex'), '0a0708011a03726571');
  assert.equal(encodeDeviceListRequest('req', DeviceType.AUTO).toString('hex'), '0a0708041a03726571');
  assert.equal(encodeDeviceListRequest('req', DeviceType.FASTPAIR).toString('hex'), '0a0708051a03726571');
  assert.equal(encodeDeviceListRequest('req', DeviceType.SUPERVISED_ANDROID).toString('hex'), '0a0708071a03726571');
});

test('Find Hub catalogue discovery falls back across live-equivalent selectors and preserves total failure', async () => {
  const identifier = concat(
    fieldMessage(3, fieldMessage(1, fieldString(1, 'catalog-fallback-id'))),
    fieldVarint(2, 2),
  );
  const description = concat(fieldString(1, 'Fallback Phone'), fieldVarint(2, 20));
  const registration = fieldMessage(2, description);
  const metadata = concat(
    fieldMessage(1, identifier),
    fieldMessage(4, fieldMessage(1, registration)),
    fieldString(5, 'Fallback Phone'),
  );
  const responseAt = (seconds: number) =>
    concat(fieldMessage(2, metadata), fieldMessage(4, fieldVarint(1, seconds)));
  const response = responseAt(200);

  const fallback = new FindHubNovaClient(null as never, null as never);
  fallback.captureDevicesListRaw = async (catalog) => {
    if (catalog === 'android') return response;
    throw new Error(`${catalog} unavailable`);
  };
  const devices = await fallback.listDevices();
  assert.equal(devices.length, 1);
  assert.equal(devices[0].googleDeviceId, 'catalog-fallback-id');
  assert.equal(devices[0].name, 'Fallback Phone');
  assert.equal(devices[0].providerResponseAt, '1970-01-01T00:03:20.000Z');

  const merged = new FindHubNovaClient(null as never, null as never);
  merged.captureDevicesListRaw = async (catalog) => {
    if (catalog === 'spot') return responseAt(100);
    if (catalog === 'android') return responseAt(200);
    throw new Error(`${catalog} unavailable`);
  };
  const [mergedDevice] = await merged.listDevices();
  assert.equal(
    mergedDevice.providerResponseAt,
    '1970-01-01T00:03:20.000Z',
    'The latest provider response time must survive the SPOT compatibility tie-breaker',
  );

  const empty = new FindHubNovaClient(null as never, null as never);
  empty.captureDevicesListRaw = async (catalog) => {
    if (catalog === 'spot') return Buffer.alloc(0);
    throw new Error(`${catalog} unavailable`);
  };
  assert.deepEqual(await empty.listDevices(), []);

  const failure = new Error('credential/provider failure');
  const unavailable = new FindHubNovaClient(null as never, null as never);
  unavailable.captureDevicesListRaw = async () => {
    throw failure;
  };
  await assert.rejects(unavailable.listDevices(), (error) => error === failure);
});

test('Find Hub locate protobuf matches reference wire format', () => {
  assert.equal(
    encodeExecuteLocateRequest({
      googleDeviceId: 'abc123',
      fcmRegistrationId: 'fcm-token',
      requestUuid: REQUEST_UUID,
      clientUuid: CLIENT_UUID,
    }).toString('hex'),
    '0a0e10021a0a0a080a06616263313233120df2010a120608fc9bf8b90618021a5d0802122431313131313131312d323232322d333333332d343434342d3535353535353535353535351a2461616161616161612d626262622d636363632d646464642d656565656565656565656565220b0a0966636d2d746f6b656e3001',
  );
});

test('Find Hub start/stop sound protobufs match the supplied public wire reference', () => {
  const args = {
    googleDeviceId: 'abc123',
    fcmRegistrationId: 'fcm-token',
    requestUuid: REQUEST_UUID,
    clientUuid: CLIENT_UUID,
  };
  assert.equal(
    encodeExecuteSoundRequest(args, 'start', 'UNSPECIFIED').toString('hex'),
    '0a0e10021a0a0a080a066162633132331203fa01001a5d0802122431313131313131312d323232322d333333332d343434342d3535353535353535353535351a2461616161616161612d626262622d636363632d646464642d656565656565656565656565220b0a0966636d2d746f6b656e3001',
  );
  assert.equal(
    encodeExecuteSoundRequest(args, 'start', 'RIGHT').toString('hex'),
    '0a0e10021a0a0a080a066162633132331205fa010208011a5d0802122431313131313131312d323232322d333333332d343434342d3535353535353535353535351a2461616161616161612d626262622d636363632d646464642d656565656565656565656565220b0a0966636d2d746f6b656e3001',
  );
  assert.equal(
    encodeExecuteSoundRequest(args, 'stop', 'CASE').toString('hex'),
    '0a0e10021a0a0a080a06616263313233120582020208031a5d0802122431313131313131312d323232322d333333332d343434342d3535353535353535353535351a2461616161616161612d626262622d636363632d646464642d656565656565656565656565220b0a0966636d2d746f6b656e3001',
  );
});

test('Find Hub metadata decoder preserves every proven identifier, ownership and Fast Pair field', () => {
  const metadata = Buffer.from(
    '0a2810021a240a0f0a0d63616e6f6e2d7072696d6172790a110a0f63616e6f6e2d7365636f6e6461727922c2010a8401120210099a01500a176964656e746974792d7365637265742d66697874757265180722136163636f756e742d6b65792d66697874757265420608e4e1dcd5065a167075626c69632d616464726573732d66697874757265a2010e4578616d706c65204d6f746f7273aa0106413142324333b80180e1dcd506920209547261636b6572205812061a04220248031a190a116f776e6572406578616d706c652e636f6d1001180120011a160a12736861726564406578616d706c652e636f6d10012a0f57616c6c61636520547261636b657232200a1e68747470733a2f2f696d672e6578616d706c652f6465766963652e706e67',
    'hex',
  );
  const devices = decodeDeviceMetadata(metadata);
  assert.equal(devices.length, 2);
  const device = devices[0];
  assert.deepEqual(device.canonicalIds, ['canon-primary', 'canon-secondary']);
  assert.equal(device.googleDeviceId, 'canon-primary');
  assert.equal(device.identifierType, 'SPOT');
  assert.equal(device.deviceType, 'CAR');
  assert.equal(device.name, 'Wallace Tracker');
  assert.equal(device.manufacturer, 'Example Motors');
  assert.equal(device.model, 'Tracker X');
  assert.equal(device.fastPairModelId, 'A1B2C3');
  assert.equal(device.pairedAt, '2026-09-26T02:40:00.000Z');
  assert.equal(device.ownerKeyVersion, 7);
  assert.equal(device.networkAggregationMinReports, 3);
  assert.equal(device.identityKeyFingerprint, 'c45b801ba4aec1e55f00b768e888f15a1178a8f982d615454822034dec1c568a');
  assert.equal(device.accountKeyFingerprint, 'df5769597d190595cc97400a70ce0a15176afd3ccfd8ba808552037a320ea1eb');
  assert.equal(device.publicAddressFingerprint, '1217d815a04e9952f1b8091e09107625e2ede718f90a3590cada3dd9e0e927ec');
  assert.equal(device.secretsCreatedAt, '2026-09-26T02:41:40.000Z');
  assert.deepEqual(device.accessInformation, [
    { email: 'owner@example.com', hasAccess: true, isOwner: true, thisAccount: true },
    { email: 'shared@example.com', hasAccess: true, isOwner: false, thisAccount: false },
  ]);
});

test('Find Hub live 2026 catalogue decodes Android hardware metadata without using private captures', () => {
  const time = (seconds: number) => fieldMessage(2, fieldVarint(1, seconds));
  const canonicId = fieldMessage(1, fieldString(1, 'device-test-uuid'));
  const canonicIds = fieldMessage(2, fieldMessage(1, fieldString(1, 'device-test-uuid')));
  const identifier = concat(
    fieldMessage(1, concat(fieldVarint(1, 123456789n), canonicIds)),
    fieldVarint(2, 1),
  );
  const description = concat(fieldString(1, 'Test Phone'), fieldVarint(2, 20));
  const secrets = concat(fieldString(1, 'encrypted-fixture'), fieldVarint(3, 1), fieldMessage(8, fieldVarint(1, 1790000000)));
  const registration = concat(
    canonicId,
    fieldMessage(2, description),
    fieldMessage(19, secrets),
    fieldString(20, 'Example'),
    fieldString(21, 'example_global'),
    fieldString(34, 'MODEL-TEST'),
  );
  const access = concat(fieldString(1, 'owner@example.invalid'), fieldVarint(2, 1), fieldVarint(3, 1), fieldVarint(4, 1));
  const modernInformation = concat(fieldMessage(1, registration), fieldMessage(3, access));
  const status = concat(
    time(1780000000),
    fieldString(3, 'MODEL-TEST'),
    fieldString(4, 'Example'),
    fieldString(5, 'codename'),
    fieldString(6, 'Carrier'),
    fieldString(7, '490154203237518'),
    fieldMessage(10, fieldVarint(1, 1790457000)),
    fieldVarint(20, 262434029),
    fieldVarint(21, 36),
    fieldString(23, '0123456789abcdef0123456789abcdef'),
    fieldMessage(26, modernInformation),
    fieldVarint(40, 2),
  );
  const metadata = concat(
    fieldMessage(1, identifier),
    fieldMessage(3, status),
    fieldString(5, 'Test Phone'),
    fieldMessage(6, fieldString(1, 'https://example.invalid/device.png')),
    fieldMessage(12, fieldVarint(1, 1790458403)),
    fieldString(13, 'opaque-test'),
  );

  const [device] = decodeDeviceMetadata(metadata);
  assert.equal(device.googleDeviceId, 'device-test-uuid');
  assert.equal(device.identifierType, 'ANDROID');
  assert.equal(device.deviceType, 'PHONE');
  assert.equal(device.manufacturer, 'Example');
  assert.equal(device.model, 'MODEL-TEST');
  assert.equal(device.deviceCodename, 'codename');
  assert.equal(device.productName, 'example_global');
  assert.equal(device.carrier, 'Carrier');
  assert.equal(device.imei, '490154203237518');
  assert.equal(device.androidDeviceNumericId, '123456789');
  assert.equal(device.providerOpaqueId, 'opaque-test');
  assert.equal(device.gmsCoreVersionCode, 262434029);
  assert.equal(device.androidSdkVersion, 36);
  assert.equal(device.locateSupported, true);
  assert.equal(device.accessInformation?.[0]?.isOwner, true);
});

test('Find Hub DeviceUpdate float field is location accuracy, not a battery percentage', () => {
  const encrypted = concat(
    fieldMessage(2, Buffer.alloc(41, 0x5a)),
    fieldVarint(3, 1),
  );
  const geo = concat(
    fieldMessage(1, encrypted),
    Buffer.from('1d0000c842', 'hex'),
  );
  const report = concat(fieldMessage(10, geo), fieldVarint(11, 1));
  const recentAndNetwork = concat(
    fieldMessage(1, report),
    fieldMessage(2, fieldVarint(1, 1790459270)),
  );
  const metadata = fieldMessage(
    4,
    fieldMessage(2, fieldMessage(3, fieldMessage(4, recentAndNetwork))),
  );

  const [decoded] = decodeLocationReports(metadata);
  assert.equal(decoded.status, 1);
  assert.equal(decoded.accuracy, 100);
  assert.equal(decoded.ownReport, true);
  assert.equal(decoded.timestampSeconds, 1790459270);
});

test('Find Hub legacy PHONE DeviceUpdate treats field 21 as product name and preserves sound capabilities', () => {
  const identifier = concat(
    fieldVarint(2, 2),
    fieldMessage(3, fieldMessage(1, fieldString(1, 'phone-device-test-uuid'))),
  );
  const capability = (actionField: number) =>
    fieldMessage(2, concat(fieldMessage(1, fieldMessage(actionField, Buffer.alloc(0))), fieldVarint(2, 1)));
  const description = concat(
    fieldString(1, 'Fixture Phone'),
    fieldVarint(2, 20),
    fieldVarint(11, 3),
    fieldVarint(14, 1),
  );
  const registration = concat(
    fieldMessage(2, description),
    fieldString(20, 'Example Manufacturer'),
    fieldString(21, 'fixture_product_global'),
    fieldString(34, 'Fixture Model'),
  );
  const metadata = concat(
    fieldMessage(1, identifier),
    capability(31),
    capability(32),
    fieldMessage(4, fieldMessage(1, registration)),
    fieldString(5, 'Fixture Phone'),
  );

  const [device] = decodeDeviceMetadata(metadata);
  assert.equal(device.identifierType, 'SPOT');
  assert.equal(device.deviceType, 'PHONE');
  assert.equal(device.manufacturer, 'Example Manufacturer');
  assert.equal(device.model, 'Fixture Model');
  assert.equal(device.deviceCodename, undefined);
  assert.equal(device.productName, 'fixture_product_global');
  assert.equal(device.fastPairModelId, undefined);
  assert.equal(device.providerFlags?.['registration.2.11'], 3);
  assert.equal(device.providerFlags?.['registration.2.14'], 1);
  assert.equal(device.batteryTier, 'HIGH');
  assert.equal(device.batteryTierSource, 'registration.2.11');
  assert.deepEqual(device.providerCapabilities, [
    { actionField: 31, state: 1 },
    { actionField: 32, state: 1 },
  ]);
});

test('Find Hub live catalogue preserves supervised Family Link devices without inventing a canonical ID', () => {
  const identifier = concat(
    fieldMessage(1, concat(fieldVarint(1, 555n), fieldVarint(3, 999n))),
    fieldVarint(2, 6),
  );
  const family = concat(
    fieldString(1, 'https://familylink.google.com/member/123/device/test-device/settings?generate_history=false'),
    fieldString(2, 'Family member'),
  );
  const status = concat(
    fieldString(3, 'MODEL-FAMILY'),
    fieldMessage(10, fieldVarint(1, 1790457000)),
    fieldVarint(20, 263436067),
    fieldVarint(21, 35),
    fieldString(23, 'family-status-id'),
    fieldMessage(32, fieldVarint(1, 53)),
    fieldMessage(38, family),
    fieldVarint(40, 2),
  );
  const metadata = concat(
    fieldMessage(1, identifier),
    fieldMessage(3, status),
    fieldString(5, 'MODEL-FAMILY'),
    fieldString(13, 'family-opaque-id'),
  );

  const [device] = decodeDeviceMetadata(metadata);
  assert.equal(device.identifierType, 'SUPERVISED_ANDROID');
  assert.equal(device.googleDeviceId, 'metadata:family-opaque-id');
  assert.deepEqual(device.canonicalIds, []);
  assert.equal(device.familyLinkManaged, true);
  assert.equal(device.familyLinkMemberName, 'Family member');
  assert.match(device.familyLinkUrl || '', /familylink\.google\.com/);
  assert.equal(device.androidSdkVersion, 35);
  assert.equal(device.providerFlags?.['32.1'], 53);
  assert.equal(device.locateSupported, false);
});

test('Find Hub EID and security unlock requests match reference protobufs', () => {
  assert.equal(encodeGetEidInfoRequest().toString('hex'), '08ffffffffffffffffff011001');
  assert.equal(
    encodeSecurityUnlockExtras(REQUEST_UUID).toString('hex'),
    '0801120b0a0966696e6465725f6877322431313131313131312d323232322d333333332d343434342d353535353535353535353535',
  );
});

test('Find Hub security domain omits its proto3 zero default without changing the raw writer', () => {
  const payload = encodeSecurityUnlockExtras(REQUEST_UUID);
  const domain = bytes(payload, 2);
  assert.ok(domain, 'Security domain must remain present');
  assert.equal(int(payload, 1), 1n);
  assert.equal(string(domain, 1), 'finder_hw');
  assert.equal(int(domain, 2), undefined, 'Implicit-presence zero must not be serialized');
  assert.equal(string(payload, 6), REQUEST_UUID);
  assert.equal(int(fieldVarint(2, 0), 2), 0n, 'Raw protobuf writer must still support explicit zero values');
});
