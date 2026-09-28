import assert from 'node:assert/strict';
import { createCipheriv, randomBytes } from 'node:crypto';
import { test } from 'node:test';

import { FindHubCredentialVault } from '../src/api/integrations/channel/findhub/auth/findhub-credential-vault';

test('Find Hub vault keeps existing v1 envelopes and rejects missing/invalid configuration', () => {
  const original = process.env.FINDHUB_CREDENTIALS_KEY;
  try {
    delete process.env.FINDHUB_CREDENTIALS_KEY;
    assert.throws(() => new FindHubCredentialVault(), /prepare-findhub-env.py/);
    for (const invalid of ['invalid', 'aa', 'Z'.repeat(44), `${Buffer.alloc(32).toString('base64')}!!!`]) {
      process.env.FINDHUB_CREDENTIALS_KEY = invalid;
      assert.throws(() => new FindHubCredentialVault(), /32 bytes/);
    }
    const key = randomBytes(32);
    process.env.FINDHUB_CREDENTIALS_KEY = key.toString('hex');
    const first = new FindHubCredentialVault();
    const value = { aas: { aasToken: 'TEST_ONLY' } };
    const sealed = first.encrypt(value);
    assert.notEqual(sealed, first.encrypt(value));
    assert.deepEqual(first.decrypt(sealed), value);
    // Emulate a pre-fix envelope, independently of the new encrypt method.
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', key, iv);
    const encrypted = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
    const oldEnvelope = ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), encrypted.toString('base64url')].join('.');
    for (const encoded of [key.toString('base64'), key.toString('base64').replace(/=$/, ''), key.toString('base64url')]) {
      process.env.FINDHUB_CREDENTIALS_KEY = encoded;
      assert.deepEqual(new FindHubCredentialVault().decrypt(oldEnvelope), value);
    }
    process.env.FINDHUB_CREDENTIALS_KEY = randomBytes(32).toString('hex');
    assert.throws(() => new FindHubCredentialVault().decrypt(sealed));
  } finally {
    if (original === undefined) delete process.env.FINDHUB_CREDENTIALS_KEY;
    else process.env.FINDHUB_CREDENTIALS_KEY = original;
  }
});
