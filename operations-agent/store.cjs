'use strict';
const fs = require('node:fs');
const fsp = fs.promises;
const path = require('node:path');
const crypto = require('node:crypto');
const zlib = require('node:zlib');
const readline = require('node:readline');
const { Transform, Writable } = require('node:stream');
const { pipeline } = require('node:stream/promises');

const TITLES = Object.freeze({
  'agent.started': 'Monitoramento iniciado',
  'api.started': 'API iniciada',
  'service.available': 'Serviço acessível',
  'service.unavailable': 'Serviço indisponível',
  'http.summary': 'Resumo das requisições',
  'telemetry.gap': 'Intervalo sem coleta de telemetria',
  'backup.created': 'Arquivo de backup criado',
  'backup.verified': 'Integridade do backup verificada',
  'backup.failed': 'Falha no backup',
  'backup.restored': 'Comando de restauração executado',
  'diagnostic.exported': 'Diagnóstico exportado',
});
const SERVICES = ['api', 'database', 'cache', 'events', 'storage', 'docs', 'operations', 'backup'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const NUMBER_FIELDS = ['count', 'errors', 'durationMs', 'maxDurationMs', 'bytes'];
function validDay(day) {
  if (typeof day !== 'string' || !DAY.test(day)) return false;
  const parsed = Date.parse(day);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === day;
}
function dayAt(ms, timezone = 'UTC') {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(new Date(ms));
  const get = (key) => parts.find((part) => part.type === key).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}
function safeEvent(input, now) {
  if (!input || typeof input !== 'object' || !Object.hasOwn(TITLES, input.event)) throw new Error('Invalid operational event');
  // Positive allowlist. Never retain free-form strings, payload, actor, JID, IP,
  // phone, credentials, QR, message content, URL or provider error objects.
  const result = { id: crypto.randomUUID(), timestamp: new Date(now).toISOString(), event: input.event };
  result.severity = input.event.endsWith('.failed') || input.event.endsWith('.unavailable') || input.event === 'telemetry.gap' ? 'warning' : 'info';
  if (SERVICES.includes(input.service)) result.service = input.service;
  for (const field of NUMBER_FIELDS) {
    const value = input[field];
    if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= Number.MAX_SAFE_INTEGER) result[field] = value;
  }
  return result;
}
function publicEvent(event) { return { ...event, title: TITLES[event.event] || 'Evento operacional' }; }
async function syncFile(file) {
  const handle = await fsp.open(file, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function syncDirectory(dir) {
  const handle = await fsp.open(dir, 'r');
  try { await handle.sync(); } finally { await handle.close(); }
}
async function atomicJson(file, value) {
  const temporary = `${file}.part`;
  await fsp.writeFile(temporary, JSON.stringify(value) + '\n', { mode: 0o600 });
  await syncFile(temporary);
  await fsp.rename(temporary, file);
  await syncDirectory(path.dirname(file));
}
async function fileHash(file) {
  const hash = crypto.createHash('sha256');
  await pipeline(fs.createReadStream(file), new Writable({ write(chunk, _encoding, done) { hash.update(chunk); done(); } }));
  return hash.digest('hex');
}
async function exists(file) { try { await fsp.access(file); return true; } catch { return false; } }

class OperationalStore {
  constructor(dir, options = {}) {
    this.dir = path.resolve(dir);
    this.live = path.join(this.dir, 'live');
    this.archives = path.join(this.dir, 'archives');
    this.timezone = options.timezone || 'UTC';
    dayAt(Date.now(), this.timezone);
    this.clock = options.clock || Date.now;
    this.hotDays = Math.max(1, Number(options.hotDays) || 3);
    this.retentionDays = Math.max(this.hotDays + 1, Number(options.retentionDays) || 90);
    this.maxDayBytes = options.maxDayBytes || 16 * 1024 * 1024;
    this.maxDiskBytes = options.maxDiskBytes || 512 * 1024 * 1024;
    this.chain = Promise.resolve();
    this.pending = 0;
    this.dropped = 0;
    this.diskBytes = 0;
    this.recent = [];
    this.verified = new Map();
    this.queryBusy = false;
  }
  async init() {
    await fsp.mkdir(this.live, { recursive: true, mode: 0o700 });
    await fsp.mkdir(this.archives, { recursive: true, mode: 0o700 });
    await this.maintain();
  }
  serialize(work) {
    if (this.pending >= 64) { this.dropped++; return Promise.reject(new Error('Operational queue is full')); }
    this.pending++;
    const task = this.chain.then(work);
    this.chain = task.catch(() => undefined).finally(() => this.pending--);
    return task;
  }
  append(inputs) {
    if (!Array.isArray(inputs) || !inputs.length || inputs.length > 64) return Promise.reject(new Error('Invalid event batch'));
    const timestamp = this.clock();
    let events;
    try { events = inputs.map((input) => safeEvent(input, timestamp)); } catch (error) { return Promise.reject(error); }
    return this.serialize(async () => {
      const day = dayAt(timestamp, this.timezone);
      const file = path.join(this.live, `${day}.jsonl`);
      const old = await fsp.stat(file).catch(() => null);
      if (!old && await exists(path.join(this.archives, `${day}.jsonl.gz`))) throw new Error('Clock points into an archived day');
      const payload = events.map((event) => JSON.stringify(event)).join('\n') + '\n';
      const bytes = Buffer.byteLength(payload);
      if ((old?.size || 0) + bytes > this.maxDayBytes || this.diskBytes + bytes > this.maxDiskBytes) {
        this.dropped += events.length;
        throw new Error('Operational storage limit reached');
      }
      const handle = await fsp.open(file, 'a', 0o600);
      try { await handle.writeFile(payload); await handle.sync(); } finally { await handle.close(); }
      this.diskBytes += bytes;
      this.recent = [...this.recent, ...events].slice(-20);
      return events.length;
    });
  }
  async verifyArchive(day) {
    const file = path.join(this.archives, `${day}.jsonl.gz`);
    const manifest = JSON.parse(await fsp.readFile(path.join(this.archives, `${day}.json`), 'utf8'));
    if (manifest.day !== day || manifest.format !== 1 || manifest.plainBytes > this.maxDayBytes) throw new Error('Invalid archive manifest');
    const stat = await fsp.stat(file);
    const key = `${stat.size}:${stat.mtimeMs}`;
    if (this.verified.get(day) !== key) {
      if (stat.size !== manifest.bytes || await fileHash(file) !== manifest.sha256) throw new Error('Archive checksum mismatch');
      this.verified.set(day, key);
      if (this.verified.size > 128) this.verified.delete(this.verified.keys().next().value);
    }
    return manifest;
  }
  async archiveDay(day) {
    const source = path.join(this.live, `${day}.jsonl`);
    const destination = path.join(this.archives, `${day}.jsonl.gz`);
    const sourceStat = await fsp.stat(source);
    if (sourceStat.size > this.maxDayBytes) throw new Error('Live log exceeds configured limit');
    const sourceHash = await fileHash(source);
    if (await exists(path.join(this.archives, `${day}.json`))) {
      const old = await this.verifyArchive(day);
      if (old.plainSha256 !== sourceHash) throw new Error('Archived day changed; refusing to delete live log');
      return;
    }
    const temporary = `${destination}.part`;
    await pipeline(fs.createReadStream(source), zlib.createGzip({ level: 6 }), fs.createWriteStream(temporary, { mode: 0o600 }));
    const plainHash = crypto.createHash('sha256');
    let plainBytes = 0, count = 0;
    await pipeline(fs.createReadStream(temporary), zlib.createGunzip(), new Writable({
      write(chunk, _encoding, done) {
        plainBytes += chunk.length;
        plainHash.update(chunk);
        for (const byte of chunk) if (byte === 10) count++;
        done();
      },
    }));
    if (plainBytes !== sourceStat.size || plainHash.digest('hex') !== sourceHash) throw new Error('Archive verification failed');
    await syncFile(temporary);
    await fsp.rename(temporary, destination);
    const manifest = { format: 1, day, count, plainBytes, plainSha256: sourceHash,
      bytes: (await fsp.stat(destination)).size, sha256: await fileHash(destination),
      verifiedAt: new Date(this.clock()).toISOString() };
    await atomicJson(path.join(this.archives, `${day}.json`), manifest);
  }
  maintain() {
    return this.serialize(async () => {
      const today = dayAt(this.clock(), this.timezone);
      const age = (day) => Math.floor((Date.parse(today) - Date.parse(day)) / 86400000);
      for (const name of (await fsp.readdir(this.live)).sort()) {
        const day = name.slice(0, 10);
        if (name !== `${day}.jsonl` || !validDay(day) || day >= today) continue;
        await this.archiveDay(day);
        // Delete ONLY after compression, decompression/hash verification and
        // durable manifest publication. The business database is never touched.
        if (age(day) >= this.hotDays) await fsp.unlink(path.join(this.live, name));
      }
      for (const name of await fsp.readdir(this.archives)) {
        const day = name.slice(0, 10);
        if (name !== `${day}.json` || !validDay(day) || age(day) < this.retentionDays) continue;
        if (await exists(path.join(this.live, `${day}.jsonl`))) continue;
        await fsp.unlink(path.join(this.archives, `${day}.jsonl.gz`));
        await fsp.unlink(path.join(this.archives, name));
        this.verified.delete(day);
      }
      this.diskBytes = 0;
      for (const dir of [this.live, this.archives]) {
        for (const name of await fsp.readdir(dir)) this.diskBytes += (await fsp.stat(path.join(dir, name))).size;
      }
    });
  }
  async days() {
    const result = new Map();
    for (const name of await fsp.readdir(this.archives)) {
      const day = name.slice(0, 10);
      if (name !== `${day}.json` || !validDay(day)) continue;
      const value = JSON.parse(await fsp.readFile(path.join(this.archives, name), 'utf8'));
      result.set(day, { day, archived: true, count: value.count, bytes: value.bytes, verifiedAt: value.verifiedAt });
    }
    for (const name of await fsp.readdir(this.live)) {
      const day = name.slice(0, 10);
      if (name !== `${day}.jsonl` || !validDay(day)) continue;
      if (!result.has(day)) result.set(day, { day, archived: false, bytes: (await fsp.stat(path.join(this.live, name))).size });
    }
    return [...result.values()].sort((a, b) => b.day.localeCompare(a.day));
  }
  async *rows(day) {
    if (!validDay(day)) throw new Error('Invalid day');
    const live = path.join(this.live, `${day}.jsonl`);
    const useLive = await exists(live);
    if (!useLive) await this.verifyArchive(day);
    const file = useLive ? live : path.join(this.archives, `${day}.jsonl.gz`);
    const stat = await fsp.stat(file);
    if (stat.size === 0) return;
    const source = fs.createReadStream(file, { end: stat.size - 1 });
    const decoded = useLive ? source : source.pipe(zlib.createGunzip());
    let size = 0;
    const bounded = new Transform({ transform: (chunk, _encoding, done) => {
      size += chunk.length;
      done(size > this.maxDayBytes ? new Error('Log read limit exceeded') : null, chunk);
    } });
    decoded.on('error', (error) => bounded.destroy(error));
    source.on('error', (error) => bounded.destroy(error));
    const lines = readline.createInterface({ input: decoded.pipe(bounded), crlfDelay: Infinity });
    try {
      for await (const line of lines) {
        if (!line) continue;
        if (line.length > 4096) throw new Error('Invalid operational record');
        const record = JSON.parse(line);
        if (!Object.hasOwn(TITLES, record.event) || typeof record.id !== 'string') throw new Error('Invalid operational record');
        const timestamp = Date.parse(record.timestamp);
        if (!Number.isFinite(timestamp)) throw new Error('Invalid record timestamp');
        const safe = safeEvent(record, timestamp);
        safe.id = /^[0-9a-f-]{36}$/.test(record.id) ? record.id : safe.id;
        yield safe;
      }
    } finally { lines.close(); source.destroy(); decoded.destroy(); bounded.destroy(); }
  }
  async query({ from, to, cursor, limit = 100 }) {
    if (!validDay(from) || !validDay(to) || from > to || (Date.parse(to) - Date.parse(from)) / 86400000 > 30) throw new Error('Use a period of up to 31 days');
    if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('Invalid page size');
    if (this.queryBusy) throw new Error('Another history query is running');
    let resume;
    if (cursor) {
      if (typeof cursor !== 'string' || cursor.length > 256) throw new Error('Invalid cursor');
      resume = JSON.parse(Buffer.from(cursor, 'base64url').toString());
      if (!validDay(resume.day) || resume.day < from || resume.day > to || !Number.isSafeInteger(resume.line) || resume.line < 0 || resume.line > 1000000) throw new Error('Invalid cursor');
    }
    this.queryBusy = true;
    try {
      const days = (await this.days()).map((item) => item.day).filter((day) => day >= from && day <= to && (!resume || day >= resume.day)).sort();
      const events = [];
      for (const day of days) {
        let line = 0;
        for await (const event of this.rows(day)) {
          if (resume && day === resume.day && line++ < resume.line) continue;
          if (!resume || day !== resume.day) line++;
          events.push(publicEvent(event));
          if (events.length === limit) return { events, nextCursor: Buffer.from(JSON.stringify({ day, line })).toString('base64url') };
        }
      }
      return { events, nextCursor: null };
    } finally { this.queryBusy = false; }
  }
}
module.exports = { OperationalStore, safeEvent, publicEvent, TITLES, SERVICES, validDay, dayAt };
