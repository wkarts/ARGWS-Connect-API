import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  encodeDeviceListRequest,
  encodeExecuteLocateRequest,
  encodeGetEidInfoRequest,
  encodeSecurityUnlockExtras,
} from '../src/api/integrations/channel/findhub/protocol/findhub-proto';
import { bytes, fieldVarint, int, string } from '../src/api/integrations/channel/findhub/protocol/protobuf';

const REQUEST_UUID = '11111111-2222-3333-4444-555555555555';
const CLIENT_UUID = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

test('Find Hub device list protobuf matches reference wire format', () => {
  assert.equal(
    encodeDeviceListRequest(REQUEST_UUID).toString('hex'),
    '0a2808021a2431313131313131312d323232322d333333332d343434342d353535353535353535353535',
  );
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
