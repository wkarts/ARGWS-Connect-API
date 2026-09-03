import assert from 'assert';

import { consoleRedaction } from '../src/config/console-redaction.config';

const session = consoleRedaction.sanitizeConsoleArgs([
  'Closing session:',
  {
    currentRatchet: {
      ephemeralKeyPair: {
        pubKey: Buffer.from('public'),
        privKey: Buffer.from('private'),
      },
      rootKey: Buffer.from('root'),
    },
  },
]);

assert.deepStrictEqual(session, ['Closing session: [SESSION STATE REDACTED]']);

const [sanitized] = consoleRedaction.sanitizeConsoleArgs([
  {
    safe: 'visible',
    password: 'secret-password',
    nested: {
      token: 'secret-token',
      mediaKey: Buffer.from('media-key'),
      regularBinary: Buffer.from('binary-data'),
    },
  },
]);

const object = sanitized as Record<string, any>;
assert.strictEqual(object.safe, 'visible');
assert.strictEqual(object.password, '[REDACTED]');
assert.strictEqual(object.nested.token, '[REDACTED]');
assert.strictEqual(object.nested.mediaKey, '[REDACTED]');
assert.strictEqual(object.nested.regularBinary, '[BINARY REDACTED]');

console.log('security console redaction: OK');
