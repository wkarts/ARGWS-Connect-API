'use strict';
const { TITLES } = require('./store.cjs');
const event = process.argv[2];
if (!Object.hasOwn(TITLES, event) || !event.startsWith('backup.')) process.exit(2);
fetch('http://127.0.0.1:8092/events', {
  method: 'POST', signal: AbortSignal.timeout(2000),
  headers: { authorization: `Bearer ${process.env.OPERATIONS_INTERNAL_TOKEN || ''}`, 'content-type': 'application/json' },
  body: JSON.stringify({ events: [{ event, service: 'backup' }] }),
}).then((response) => { process.exitCode = response.ok ? 0 : 1; }).catch(() => { process.exitCode = 1; });
