'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { OperationalStore } = require('../operations-agent/store.cjs');
const { createAgent } = require('../operations-agent/server.cjs');

test('statistics endpoint reads verified gzip after live deletion and enforces authentication', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'connect-stats-'));
  let clock = Date.parse('2026-09-09T13:00:00Z');
  const store = new OperationalStore(dir, { timezone: 'America/Bahia', hotDays: 1, retentionDays: 90, clock: () => clock });
  await store.init();
  await store.append([{ event: 'http.summary', service: 'api', count: 10, errors: 2, durationMs: 2500 }]);
  clock += 2 * 86400000;
  await store.maintain();
  await assert.rejects(fs.access(path.join(dir, 'live', '2026-09-09.jsonl')));
  const token = 'test-only-statistics-internal-token-1234567890';
  const agent = await createAgent({ store, token, checks: [] });
  await new Promise(resolve => agent.server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + agent.server.address().port;
  try {
    const endpoint = '/statistics?from=2026-09-09&to=2026-09-09';
    assert.equal((await fetch(base + endpoint)).status, 401);
    assert.equal((await fetch(base + endpoint, { headers: { authorization: 'Bearer incorrect' } })).status, 401);
    const response = await fetch(base + endpoint, { headers: { authorization: 'Bearer ' + token } });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const data = await response.json();
    assert.equal(data.totals.requests, 10);
    assert.equal(data.totals.errors, 2);
    assert.equal(data.totals.averageMs, 250);
    assert.equal(data.archives[0].archived, true);
    assert.ok(!JSON.stringify(data).includes(token));
    assert.equal((await fetch(base + '/statistics?from=invalid&to=2026-09-09', { headers: { authorization: 'Bearer ' + token } })).status, 400);
  } finally {
    agent.server.closeAllConnections();
    await agent.close();
    await fs.rm(dir, { recursive: true, force: true });
  }
});
