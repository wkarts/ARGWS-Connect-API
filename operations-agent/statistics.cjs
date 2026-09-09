'use strict';
const { setImmediate: yieldLoop } = require('node:timers/promises');

function validDay(day) {
  if (typeof day !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(day)) return false;
  const ms = Date.parse(day);
  return Number.isFinite(ms) && new Date(ms).toISOString().slice(0, 10) === day;
}
function bucket(label) {
  return { label, samples: 0, requests: 0, errors: 0, durationMs: 0, gapBatches: 0 };
}
function sum(target, source) {
  for (const field of ['samples', 'requests', 'errors', 'durationMs', 'gapBatches']) {
    const value = target[field] + source[field];
    if (!Number.isSafeInteger(value)) throw new Error('Statistics exceed safe numeric limits');
    target[field] = value;
  }
}
function result(item) {
  return {
    label: item.label,
    samples: item.samples,
    requests: item.samples ? item.requests : null,
    errors: item.samples ? item.errors : null,
    averageMs: item.requests ? item.durationMs / item.requests : null,
    errorRate: item.requests ? (100 * item.errors) / item.requests : null,
    gapBatches: item.gapBatches,
  };
}

/** Numeric operational summaries only. No Message, Contact, Prisma or WhatsApp.
 * Per-day cache (max 32 entries); live data reused for 30s, archives for 5min.
 * Never derive charts from the paginated first page of the history endpoint.
 */
function createStatistics(store, options = {}) {
  const now = options.now || Date.now;
  const cache = new Map();
  const pending = new Map();
  const maxRows = options.maxRows || 120000;
  const timezone = store.timezone;
  const hour = new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hourCycle: 'h23' });
  async function daySummary(entry, budget) {
    const key = `${entry.day}:${entry.archived}:${entry.bytes}:${entry.verifiedAt || ''}`;
    const cached = cache.get(entry.day);
    if (cached?.key === key && cached.expires > now()) return cached.value;
    if (pending.has(entry.day)) return pending.get(entry.day);
    const task = (async () => {
      const daily = bucket(entry.day);
      const hours = Array.from({ length: 24 }, (_, h) => bucket(String(h).padStart(2, '0') + ':00'));
      for await (const event of store.rows(entry.day)) {
        if (++budget.rows > maxRows || now() - budget.started > 10000) {
          throw new Error('Statistics read limit reached; select a shorter period');
        }
        if (budget.rows % 256 === 0) await yieldLoop();
        if (event.event !== 'http.summary' && event.event !== 'telemetry.gap') continue;
        const timestamp = Date.parse(event.timestamp);
        if (!Number.isFinite(timestamp)) throw new Error('Invalid statistics timestamp');
        const b = bucket('');
        if (event.event === 'telemetry.gap') {
          if (!Number.isSafeInteger(event.count) || event.count < 0) throw new Error('Invalid gap count');
          b.gapBatches = event.count;
        } else {
          if (![event.count, event.errors, event.durationMs].every(n => Number.isSafeInteger(n) && n >= 0) || event.errors > event.count) {
            throw new Error('Invalid HTTP summary');
          }
          b.samples = 1; b.requests = event.count; b.errors = event.errors; b.durationMs = event.durationMs;
        }
        sum(daily, b);
        sum(hours[Number(hour.format(new Date(timestamp)))], b);
      }
      const value = { daily, hours };
      cache.delete(entry.day);
      cache.set(entry.day, { key, value, expires: now() + (entry.archived ? 300000 : 30000) });
      if (cache.size > 32) cache.delete(cache.keys().next().value);
      return value;
    })().finally(() => pending.delete(entry.day));
    pending.set(entry.day, task);
    return task;
  }
  return {
    async query({ from, to }) {
      if (!validDay(from) || !validDay(to) || from > to || Date.parse(to) - Date.parse(from) > 30 * 86400000) {
        throw new Error('Use a period of up to 31 days');
      }
      const budget = { rows: 0, started: now() };
      const entries = (await store.days()).filter(e => e.day >= from && e.day <= to);
      const selected = new Map(entries.map(e => [e.day, e]));
      const daily = [];
      let hours;
      for (let ms = Date.parse(from); ms <= Date.parse(to); ms += 86400000) {
        const day = new Date(ms).toISOString().slice(0, 10);
        const entry = selected.get(day);
        if (entry) {
          const value = await daySummary(entry, budget);
          daily.push(value.daily); hours = value.hours;
        } else {
          daily.push(bucket(day));
        }
      }
      const totals = bucket('period');
      for (const item of daily) sum(totals, item);
      const series = from === to
        ? hours || Array.from({ length: 24 }, (_, h) => bucket(String(h).padStart(2, '0') + ':00'))
        : daily;
      return {
        from, to, timezone, granularity: from === to ? 'hour' : 'day', generatedAt: new Date(now()).toISOString(),
        totals: result(totals), series: series.map(result),
        incomplete: totals.gapBatches > 0,
        // Actual file sizes now retained for each day, not historical disk usage.
        archives: entries.sort((a, b) => a.day.localeCompare(b.day)).map(e => ({ day: e.day, bytes: e.bytes, archived: e.archived })),
      };
    },
  };
}
module.exports = { createStatistics };
