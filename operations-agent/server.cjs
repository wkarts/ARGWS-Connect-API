'use strict';
const http = require('node:http');
const net = require('node:net');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const { Readable } = require('node:stream');
const { pipeline } = require('node:stream/promises');
const { OperationalStore, publicEvent, SERVICES, validDay } = require('./store.cjs');
const { createStatistics } = require('./statistics.cjs');

function equalSecret(left, right) {
  if (typeof left !== 'string' || typeof right !== 'string' || !left || !right) return false;
  const supplied = Buffer.from(left, 'utf8');
  const expected = Buffer.from(right, 'utf8');
  return supplied.length === expected.length && crypto.timingSafeEqual(supplied, expected);
}
function probe(check) {
  const start = Date.now();
  return new Promise((resolve) => {
    let finished = false;
    const done = (ok) => {
      if (finished) return;
      finished = true;
      resolve({ key: check.service, status: ok ? 'reachable' : 'unavailable', type: check.type, durationMs: Date.now() - start, checkedAt: new Date().toISOString() });
    };
    const url = new URL(check.url);
    if (check.type === 'tcp') {
      const socket = net.connect({ host: url.hostname, port: Number(url.port) });
      socket.setTimeout(2000);
      socket.once('connect', () => { done(true); socket.destroy(); });
      socket.once('timeout', () => { done(false); socket.destroy(); });
      socket.once('error', () => done(false));
      return;
    }
    const request = http.get(url, { timeout: 2000 }, (response) => {
      response.resume();
      done(response.statusCode >= 200 && response.statusCode < 300);
    });
    request.once('timeout', () => { request.destroy(); done(false); });
    request.once('error', () => done(false));
  });
}
async function body(req) {
  const chunks = []; let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    if (bytes > 32768) throw new Error('Request too large');
    chunks.push(chunk);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
async function createAgent(options = {}) {
  const token = options.token || process.env.OPERATIONS_INTERNAL_TOKEN || '';
  if (token.length < 32 || token.startsWith('CHANGE_ME')) throw new Error('Configure a strong OPERATIONS_INTERNAL_TOKEN');
  const store = options.store || new OperationalStore(process.env.OPERATIONS_DATA_PATH || '/data', {
    timezone: process.env.TZ || 'UTC', hotDays: process.env.OPERATIONS_HOT_DAYS,
    retentionDays: process.env.OPERATIONS_RETENTION_DAYS,
  });
  await store.init();
  const statistics = createStatistics(store);
  const checks = options.checks || JSON.parse(process.env.OPERATIONS_CHECKS || '[]');
  if (!Array.isArray(checks) || checks.length > 8) throw new Error('Invalid operations checks');
  for (const check of checks) {
    if (!SERVICES.includes(check.service) || !['tcp', 'http'].includes(check.type)) throw new Error('Invalid service check');
    const url = new URL(check.url);
    if (url.username || url.password || (check.type === 'http' ? url.protocol !== 'http:' : url.protocol !== 'tcp:')) throw new Error('Invalid check URL');
  }
  let statuses = [], checking = false, maintenanceError = false, reading = 0;
  const tick = async () => {
    if (checking) return;
    checking = true;
    try {
      const next = await Promise.all(checks.map(probe));
      const changes = next.filter((item) => statuses.find((old) => old.key === item.key)?.status !== item.status);
      statuses = next;
      if (changes.length) await store.append(changes.map((item) => ({
        event: item.status === 'reachable' ? 'service.available' : 'service.unavailable', service: item.key, durationMs: item.durationMs,
      })));
    } catch { maintenanceError = true; } finally { checking = false; }
  };
  const send = (res, status, data) => { res.writeHead(status, { 'Content-Type': 'application/json' }); res.end(JSON.stringify(data)); };
  const server = http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    const url = new URL(req.url, 'http://operations');
    if (req.method === 'GET' && url.pathname === '/health') return send(res, 200, { status: 'ok' });
    const supplied = String(req.headers.authorization || '').replace(/^Bearer /, '');
    if (!equalSecret(supplied, token)) return send(res, 401, { error: 'Unauthorized' });
    try {
      if (req.method === 'POST' && url.pathname === '/events') {
        const data = await body(req);
        const accepted = await store.append(data.events);
        return send(res, 202, { accepted });
      }
      if (req.method !== 'GET') return send(res, 405, { error: 'Method not allowed' });
      if (url.pathname === '/snapshot') {
        return send(res, 200, { enabled: true, checkedAt: statuses[0]?.checkedAt || '', generatedAt: new Date().toISOString(),
          uptimeSeconds: Math.floor(process.uptime()), services: statuses,
          recent: [...store.recent].reverse().map(publicEvent), dropped: store.dropped,
          maintenanceError, diskBytes: store.diskBytes, maxDiskBytes: store.maxDiskBytes,
          timezone: store.timezone, hotDays: store.hotDays, retentionDays: store.retentionDays });
      }
      if (reading >= 1) return send(res, 429, { error: 'Outra consulta ou exportação está em execução.' });
      reading++;
      try {
        if (url.pathname === '/statistics') return send(res, 200, await statistics.query({ from: url.searchParams.get('from'), to: url.searchParams.get('to') }));
        if (url.pathname === '/history') return send(res, 200, await store.query({
          from: url.searchParams.get('from'), to: url.searchParams.get('to'),
          cursor: url.searchParams.get('cursor') || undefined, limit: Number(url.searchParams.get('limit') || 100),
        }));
        if (url.pathname === '/archives') return send(res, 200, { archives: await store.days() });
        if (url.pathname === '/export') {
          const day = url.searchParams.get('day');
          if (!validDay(day)) return send(res, 400, { error: 'Data inválida.' });
          if (!(await store.days()).some((entry) => entry.day === day)) return send(res, 404, { error: 'Período não encontrado.' });
          const format = url.searchParams.get('format') === 'jsonl' ? 'jsonl' : 'log';
          async function* exportRows() {
            for await (const event of store.rows(day)) {
              const record = publicEvent(event);
              yield format === 'jsonl' ? JSON.stringify(record) + '\n'
                : `${record.timestamp} [${record.severity.toUpperCase()}] ${record.service || 'operations'}: ${record.title}${record.count === undefined ? '' : ` | quantidade=${record.count}`}${record.errors === undefined ? '' : ` | falhas=${record.errors}`}\n`;
            }
          }
          res.writeHead(200, { 'Content-Type': 'application/gzip', 'Content-Disposition': `attachment; filename="connect-operations-${day}.${format}.gz"` });
          await pipeline(Readable.from(exportRows()), zlib.createGzip({ level: 6 }), res);
          await store.append([{ event: 'diagnostic.exported', service: 'operations' }]);
          return;
        }
        return send(res, 404, { error: 'Not found' });
      } finally { reading--; }
    } catch {
      if (!res.headersSent) send(res, 400, { error: 'Não foi possível concluir a operação. Confira o período, os limites e a integridade do arquivo.' });
      else res.destroy();
    }
  });
  server.headersTimeout = 5000;
  server.requestTimeout = 10000;
  server.keepAliveTimeout = 5000;
  await store.append([{ event: 'agent.started', service: 'operations' }]);
  const checkTimer = setInterval(() => void tick(), 30000);
  const archiveTimer = setInterval(() => { void store.maintain().then(() => { maintenanceError = false; }).catch(() => { maintenanceError = true; }); }, 60000);
  checkTimer.unref(); archiveTimer.unref();
  void tick();
  const close = async () => {
    clearInterval(checkTimer); clearInterval(archiveTimer);
    await new Promise((resolve) => server.close(resolve));
    await store.chain;
  };
  return { server, store, close };
}
if (require.main === module) {
  createAgent().then(({ server, close }) => {
    server.listen(Number(process.env.OPERATIONS_PORT || 8092), '0.0.0.0');
    process.once('SIGTERM', () => void close());
    process.once('SIGINT', () => void close());
  }).catch(() => { console.error('Operations agent startup failed; verify configuration and data volume.'); process.exitCode = 1; });
}
module.exports = { createAgent, equalSecret };
