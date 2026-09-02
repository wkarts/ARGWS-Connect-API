import assert from 'node:assert/strict';

import { MetaCloudAuthService } from '../../src/api/compat/meta-cloud/meta-cloud-auth.service';
import { MetaCloudIdentityResolver } from '../../src/api/compat/meta-cloud/meta-cloud-identity.resolver';
import { MetaCloudStatusMapper } from '../../src/api/compat/meta-cloud/meta-cloud-status.mapper';

const resolver = new MetaCloudIdentityResolver({} as any);
const baileys = resolver.identityFromInstance({
  id: 'i1',
  name: 'cliente01',
  integration: 'WHATSAPP-BAILEYS',
  number: '55 (75) 99999-9999',
  token: 'secret',
});
assert.equal(baileys.phoneNumberId, '5575999999999');
assert.equal(baileys.businessAccountId, '5575999999999');

const fallback = resolver.identityFromInstance({
  id: 'i2',
  name: 'cliente02',
  integration: 'WHATSAPP-BAILEYS',
  ownerJid: '5575888888888@s.whatsapp.net',
  token: 'secret',
});
assert.equal(fallback.phoneNumberId, '5575888888888');

const business = resolver.identityFromInstance({
  id: 'i3',
  name: 'business',
  integration: 'WHATSAPP-BUSINESS',
  number: '123456789',
  businessId: 'waba-1',
  token: 'secret',
});
assert.equal(business.phoneNumberId, '123456789');
assert.equal(business.businessAccountId, 'waba-1');

const auth = new MetaCloudAuthService();
auth.assertAuthorized(baileys, 'Bearer secret');
assert.throws(() => auth.assertAuthorized(baileys, 'Bearer wrong'));

const mapper = new MetaCloudStatusMapper();
assert.equal(mapper.map('SERVER_ACK'), 'sent');
assert.equal(mapper.map('DELIVERY_ACK'), 'delivered');
assert.equal(mapper.map('READ'), 'read');
assert.equal(mapper.map('PLAYED'), 'read');
assert.equal(mapper.map('ERROR'), 'failed');
assert.equal(mapper.map('DELETED'), 'deleted');
assert.equal(mapper.map('PENDING'), null);

console.log('meta-cloud foundation compatibility: ok');
