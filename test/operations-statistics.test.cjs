'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { createStatistics } = require('../operations-agent/statistics.cjs');
function fixture(records = [], options = {}) {
  let reads = 0, current = Date.parse('2026-09-09T13:00:00Z');
  const store = {
    timezone: 'America/Bahia',
    days: async () => records.length ? [{ day: '2026-09-09', archived: options.archived || false, bytes: 700 }] : [],
    rows: async function* () { reads++; yield* records; },
  };
  const stats = createStatistics(store, { now: () => current, ...options });
  return { stats, reads: () => reads, advance: ms => { current += ms; } };
}
const range = { from: '2026-09-09', to: '2026-09-09' };
const summary = (count, errors, durationMs) => ({ event: 'http.summary', timestamp: '2026-09-09T12:05:00Z', count, errors, durationMs });
test('no history is null, never a fabricated zero-traffic series', async () => {
  const data = await fixture().stats.query(range);
  assert.equal(data.totals.requests, null);
  assert.equal(data.series.length, 24);
  assert.ok(data.series.every(b => b.requests === null && b.averageMs === null));
});
test('whole-period weighted average and 5xx rate use all summaries', async () => {
  const f = fixture([summary(10, 1, 1000), summary(90, 4, 18000)]);
  const data = await f.stats.query(range);
  assert.equal(data.totals.requests, 100);
  assert.equal(data.totals.errors, 5);
  assert.equal(data.totals.averageMs, 190);
  assert.equal(data.totals.errorRate, 5);
  assert.equal(data.series[9].requests, 100);
  assert.equal(data.series[12].requests, null);
});
test('real zero, unknown latency, and telemetry gaps remain distinct', async () => {
  const f = fixture([summary(0, 0, 0), { event: 'telemetry.gap', timestamp: '2026-09-09T12:05:00Z', count: 3 }]);
  const data = await f.stats.query(range);
  assert.equal(data.totals.requests, 0);
  assert.equal(data.totals.averageMs, null);
  assert.equal(data.incomplete, true);
  assert.equal(data.totals.gapBatches, 3);
});
test('cache shares readers and avoids rescanning archives per browser', async () => {
  const f = fixture([summary(4, 0, 80)], { archived: true });
  await Promise.all([f.stats.query(range), f.stats.query(range)]);
  assert.equal(f.reads(), 1);
  await f.stats.query(range);
  assert.equal(f.reads(), 1);
  f.advance(300001);
  await f.stats.query(range);
  assert.equal(f.reads(), 2);
});
test('numeric projections never expose free-form payload', async () => {
  const privateValue = 'PRIVATE-NAME-TOKEN-JID';
  const f = fixture([{ ...summary(1, 0, 3), pushName: privateValue, message: privateValue }, { event: 'message.upsert', timestamp: '2026-09-09T12:05:00Z', count: 999, message: privateValue }]);
  const data = await f.stats.query(range);
  assert.equal(data.totals.requests, 1);
  assert.ok(!JSON.stringify(data).includes(privateValue));
});
test('invalid dates, corrupt summaries and oversized scans fail without partial totals', async () => {
  await assert.rejects(fixture().stats.query({ from: '2026-02-30', to: '2026-03-01' }));
  await assert.rejects(fixture().stats.query({ from: '2026-07-01', to: '2026-09-09' }));
  await assert.rejects(fixture([summary(2, 3, 10)]).stats.query(range));
  await assert.rejects(fixture([summary(1, 0, 1), summary(1, 0, 1)], { maxRows: 1 }).stats.query(range));
});
test('multi-day empty buckets stay null and archive sizes are measured bytes', async () => {
  const data = await fixture([summary(2, 0, 10)], { archived: true }).stats.query({ from: '2026-09-08', to: '2026-09-10' });
  assert.equal(data.granularity, 'day');
  assert.deepEqual(data.series.map(s => s.requests), [null, 2, null]);
  assert.deepEqual(data.archives, [{ day: '2026-09-09', bytes: 700, archived: true }]);
});
