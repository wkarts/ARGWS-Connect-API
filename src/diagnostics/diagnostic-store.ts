import { randomUUID } from 'node:crypto';
import { createReadStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import { join } from 'node:path';

import {
  DIAGNOSTIC_CATEGORIES,
  DIAGNOSTIC_CODES,
  DIAGNOSTIC_LEVELS,
  DiagnosticEvent,
  DiagnosticFilter,
} from './diagnostic-types';

const MB = 1024 * 1024;
const MAX_PENDING = 1000;
const MAX_RECORD_BYTES = 64 * 1024;
const MAX_SEGMENT_BYTES = 4 * MB;
const MAX_SEGMENTS = 4096;
const COMPACT_AFTER = 256;
const HEADER_BYTES = 8192;
const SEGMENT = /^events-[0-9a-f-]{36}-\d{13}-\d{6,12}\.jsonl$/;
type Settings = { retentionDays: number; maxDiskMB: number };
type Segment = {
  name: string;
  bytes: number;
  count: number;
  newest: number;
  counts: Record<string, number>;
  categories: Record<string, number>;
};
type Cursor = { timestamp: string; id: string };

export class DiagnosticValidationError extends Error {
  readonly status = 400;
  constructor(message: string) {
    super(message);
    this.name = 'DiagnosticValidationError';
  }
}

function invalid(message: string): never {
  throw new DiagnosticValidationError(message);
}
function compare(a: Cursor, b: Cursor): number {
  return a.timestamp.localeCompare(b.timestamp) || a.id.localeCompare(b.id);
}
function settings(input: Partial<Settings>, current: Settings): Settings {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Configuração inválida.');
  for (const key of Object.keys(input))
    if (!['retentionDays', 'maxDiskMB'].includes(key)) invalid('Configuração desconhecida.');
  const result = { ...current, ...input };
  if (!Number.isInteger(result.retentionDays) || result.retentionDays < 1 || result.retentionDays > 30)
    invalid('Retenção deve ser de 1 a 30 dias.');
  if (!Number.isInteger(result.maxDiskMB) || result.maxDiskMB < 32 || result.maxDiskMB > 512)
    invalid('Quota deve ser de 32 a 512 MB.');
  return result;
}

export function validateDiagnosticFilter(input: DiagnosticFilter = {}): DiagnosticFilter {
  if (!input || typeof input !== 'object' || Array.isArray(input)) invalid('Filtro inválido.');
  const filter = { ...input };
  const keys = ['from', 'to', 'level', 'category', 'code', 'traceId', 'callId', 'instanceId', 'cursor', 'limit'];
  for (const key of Object.keys(filter)) if (!keys.includes(key)) invalid('Filtro desconhecido.');
  for (const key of ['from', 'to'] as const) {
    if (filter[key] !== undefined) {
      const value = filter[key];
      if (
        typeof value !== 'string' ||
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value) ||
        !Number.isFinite(Date.parse(value))
      )
        invalid('Data ISO UTC inválida.');
      const normalized = new Date(value).toISOString();
      if (normalized.slice(0, 19) !== value.slice(0, 19)) invalid('Data inválida.');
      filter[key] = normalized;
    }
  }
  if (filter.from && filter.to && filter.from > filter.to) invalid('Intervalo inválido.');
  if (filter.from && filter.to && Date.parse(filter.to) - Date.parse(filter.from) > 30 * 86400000)
    invalid('Intervalo máximo de 30 dias.');
  for (const [key, values] of [
    ['level', DIAGNOSTIC_LEVELS],
    ['category', DIAGNOSTIC_CATEGORIES],
    ['code', DIAGNOSTIC_CODES],
  ] as const) {
    if (filter[key] !== undefined && !(values as readonly string[]).includes(filter[key]))
      invalid('Classificação inválida.');
  }
  for (const key of ['traceId', 'callId', 'instanceId'] as const) {
    if (filter[key] !== undefined && (typeof filter[key] !== 'string' || !/^[A-Za-z0-9_.:-]{1,128}$/.test(filter[key])))
      invalid('Identificador inválido.');
  }
  if (filter.limit !== undefined && (!Number.isInteger(filter.limit) || filter.limit < 1 || filter.limit > 200))
    invalid('Limite deve ser de 1 a 200.');
  if (filter.cursor !== undefined) decodeCursor(filter.cursor);
  return filter;
}

function decodeCursor(value: string): Cursor {
  try {
    if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{1,300}$/.test(value)) throw new Error();
    const cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    if (
      Object.keys(cursor).sort().join(',') !== 'id,timestamp' ||
      typeof cursor.id !== 'string' ||
      !/^[A-Za-z0-9_.:-]{1,128}$/.test(cursor.id) ||
      new Date(cursor.timestamp).toISOString() !== cursor.timestamp
    )
      throw new Error();
    return cursor;
  } catch {
    return invalid('Cursor inválido.');
  }
}

function matches(event: DiagnosticEvent, filter: DiagnosticFilter): boolean {
  if (filter.from && event.timestamp < filter.from) return false;
  if (filter.to && event.timestamp > filter.to) return false;
  return (['level', 'category', 'code', 'traceId', 'callId', 'instanceId'] as const).every(
    (key) => filter[key] === undefined || event[key] === filter[key],
  );
}

function replacementNames(header: unknown, current: string): string[] | undefined {
  const value = header as { diagnosticSegment?: number; replaces?: unknown };
  if (!value || value.diagnosticSegment !== 1 || !Array.isArray(value.replaces)) return undefined;
  if (value.replaces.length < 2 || value.replaces.length > 64) return undefined;
  if (!value.replaces.every((name) => typeof name === 'string' && SEGMENT.test(name) && name !== current))
    return undefined;
  return value.replaces;
}

/** Private, single API volume; immutable segments also keep concurrent readers/writers safe. */
export class DiagnosticStore {
  private readonly runtimeId = randomUUID();
  private readonly now: () => number;
  private config: Settings = { retentionDays: 7, maxDiskMB: 128 };
  private segments = new Map<string, Segment>();
  private readers = new Map<string, number>();
  private obsolete = new Set<string>();
  private pending: DiagnosticEvent[] = [];
  private fallback: DiagnosticEvent[] = [];
  private initializing?: Promise<void>;
  private writing?: Promise<void>;
  private settingsWrite: Promise<unknown> = Promise.resolve();
  private pruning: Promise<void> = Promise.resolve();
  private timer?: ReturnType<typeof setTimeout>;
  private sequence = 0;
  private ready = false;
  private persistent = false;
  private storageError = false;
  private dropped = 0;

  constructor(
    private readonly dir: string,
    options: { clock?: () => number } = {},
  ) {
    this.now = options.clock || Date.now;
  }

  init(): Promise<void> {
    this.initializing ||= this.initialize();
    return this.initializing;
  }

  private async initialize(): Promise<void> {
    try {
      await fs.mkdir(this.dir, { recursive: true, mode: 0o700 });
      await fs.chmod(this.dir, 0o700);
      try {
        this.config = settings(JSON.parse(await fs.readFile(join(this.dir, 'settings.json'), 'utf8')), this.config);
      } catch (error) {
        if (error.code !== 'ENOENT') this.storageError = true;
      }
      const names: string[] = [];
      const replaced = new Set<string>();
      for await (const entry of await fs.opendir(this.dir)) {
        if (!entry.isFile()) continue;
        if (SEGMENT.test(entry.name)) {
          names.push(entry.name);
          for (const oldName of await this.readReplacementHeader(entry.name)) replaced.add(oldName);
        } else if (entry.name.endsWith('.tmp') && SEGMENT.test(entry.name.slice(0, -4))) {
          // Each private volume has one API process. Only abandoned store-owned staging files qualify.
          await fs.unlink(join(this.dir, entry.name));
        }
      }
      for (const name of names) {
        if (replaced.has(name)) {
          await fs.unlink(join(this.dir, name));
          continue;
        }
        const stat = await fs.stat(join(this.dir, name));
        const segment: Segment = {
          name,
          bytes: stat.size,
          count: 0,
          newest: 0,
          counts: {},
          categories: {},
        };
        for await (const event of this.readSegment(segment.name)) this.count(segment, event);
        this.segments.set(segment.name, segment);
      }
      this.persistent = true;
      await this.prune();
    } catch {
      this.storageError = true;
      this.persistent = false;
    } finally {
      this.ready = true;
    }
  }

  append(event: DiagnosticEvent): void {
    try {
      const serialized = JSON.stringify(event);
      if (Buffer.byteLength(serialized) > MAX_RECORD_BYTES || this.pending.length >= MAX_PENDING) {
        this.dropped++;
        return;
      }
      // Capture the already-sanitized event by value: callers cannot mutate stored records later.
      this.pending.push(JSON.parse(serialized));
      if (!this.timer) {
        this.timer = setTimeout(() => {
          this.timer = undefined;
          void this.flush();
        }, 250);
        this.timer.unref();
      }
    } catch {
      this.dropped++;
    }
  }

  async flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    await this.init();
    if (this.writing) {
      await this.writing;
      if (this.pending.length) await this.flush();
      return;
    }
    if (!this.pending.length) return;
    this.writing = this.drain();
    try {
      await this.writing;
    } finally {
      this.writing = undefined;
    }
  }

  private async drain(): Promise<void> {
    while (this.pending.length) {
      const events: DiagnosticEvent[] = [];
      let content = '';
      while (this.pending.length && events.length < 200) {
        const line = JSON.stringify(this.pending[0]) + '\n';
        if (content && Buffer.byteLength(content) + Buffer.byteLength(line) > MAX_SEGMENT_BYTES) break;
        content += line;
        events.push(this.pending.shift());
      }
      const name = `events-${this.runtimeId}-${String(this.now()).padStart(13, '0')}-${String(this.sequence++).padStart(6, '0')}.jsonl`;
      const temporary = join(this.dir, `${name}.tmp`);
      let committed = false;
      try {
        if (!this.persistent) throw new Error('Storage unavailable');
        await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
        await fs.rename(temporary, join(this.dir, name));
        const segment: Segment = {
          name,
          bytes: Buffer.byteLength(content),
          count: 0,
          newest: 0,
          counts: {},
          categories: {},
        };
        events.forEach((event) => this.count(segment, event));
        this.segments.set(name, segment);
        committed = true;
        await this.prune();
      } catch {
        this.storageError = true;
        if (!committed) this.fallback.push(...events);
        if (this.fallback.length > MAX_PENDING)
          this.dropped += this.fallback.splice(0, this.fallback.length - MAX_PENDING).length;
        await fs.unlink(temporary).catch(() => undefined);
      }
    }
  }

  private count(segment: Segment, event: DiagnosticEvent): void {
    segment.count++;
    segment.newest = Math.max(segment.newest, Date.parse(event.timestamp));
    segment.counts[event.level] = (segment.counts[event.level] || 0) + 1;
    segment.categories[event.category] = (segment.categories[event.category] || 0) + 1;
  }

  private async readReplacementHeader(name: string): Promise<string[]> {
    const file = await fs.open(join(this.dir, name), 'r');
    try {
      const buffer = Buffer.alloc(HEADER_BYTES);
      const { bytesRead } = await file.read(buffer, 0, buffer.length, 0);
      const firstLine = buffer.subarray(0, bytesRead).toString('utf8').split('\n', 1)[0];
      try {
        return replacementNames(JSON.parse(firstLine), name) || [];
      } catch {
        return [];
      }
    } finally {
      await file.close();
    }
  }

  private async compact(): Promise<boolean> {
    const sources: Segment[] = [];
    let bytes = HEADER_BYTES;
    for (const candidate of [...this.segments.values()].sort(
      (a, b) => a.newest - b.newest || a.name.localeCompare(b.name),
    )) {
      if (this.readers.has(candidate.name) || bytes + candidate.bytes > MAX_SEGMENT_BYTES) continue;
      sources.push(candidate);
      bytes += candidate.bytes;
      if (sources.length === 64) break;
    }
    if (sources.length < 2) return false;
    const name = `events-${this.runtimeId}-${String(this.now()).padStart(13, '0')}-${String(this.sequence++).padStart(6, '0')}.jsonl`;
    let content = JSON.stringify({ diagnosticSegment: 1, replaces: sources.map((source) => source.name) }) + '\n';
    const segment: Segment = { name, bytes: 0, count: 0, newest: 0, counts: {}, categories: {} };
    for (const source of sources)
      for await (const event of this.readSegment(source.name)) {
        content += JSON.stringify(event) + '\n';
        this.count(segment, event);
      }
    const temporary = join(this.dir, `${name}.tmp`);
    try {
      await fs.writeFile(temporary, content, { encoding: 'utf8', mode: 0o600, flag: 'wx' });
      await fs.rename(temporary, join(this.dir, name));
      segment.bytes = Buffer.byteLength(content);
      this.segments.set(name, segment);
      // The replacement header commits first; restart can finish deletions without duplicating events.
      for (const source of sources) {
        this.segments.delete(source.name);
        this.obsolete.add(source.name);
      }
      for (const source of sources) {
        await fs.unlink(join(this.dir, source.name)).catch((error) => {
          if (error.code !== 'ENOENT') throw error;
        });
        this.obsolete.delete(source.name);
      }
      return true;
    } finally {
      await fs.unlink(temporary).catch(() => undefined);
    }
  }

  private prune(): Promise<void> {
    const task = this.pruning.then(() => this.pruneSegments());
    this.pruning = task.catch(() => undefined);
    return task;
  }

  private async pruneSegments(): Promise<void> {
    // Finish interrupted deletions before their replacement can itself expire or be compacted.
    for (const name of this.obsolete) {
      await fs.unlink(join(this.dir, name)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      this.obsolete.delete(name);
    }
    while (this.segments.size > COMPACT_AFTER && (await this.compact())) {
      /* merge sparse batches before enforcing bounds */
    }
    const cutoff = this.now() - this.config.retentionDays * 86400000;
    const ordered = [...this.segments.values()].sort((a, b) => a.newest - b.newest || a.name.localeCompare(b.name));
    let bytes = ordered.reduce((total, segment) => total + segment.bytes, 0);
    let count = ordered.length;
    for (const segment of ordered) {
      if (segment.newest >= cutoff && bytes <= this.config.maxDiskMB * MB && count <= MAX_SEGMENTS) break;
      if (this.readers.has(segment.name)) continue;
      await fs.unlink(join(this.dir, segment.name)).catch((error) => {
        if (error.code !== 'ENOENT') throw error;
      });
      this.segments.delete(segment.name);
      bytes -= segment.bytes;
      count--;
    }
    this.fallback = this.fallback.filter((event) => Date.parse(event.timestamp) >= cutoff);
  }

  private async *readSegment(name: string): AsyncGenerator<DiagnosticEvent> {
    const stream = createReadStream(join(this.dir, name), { encoding: 'utf8', highWaterMark: MAX_RECORD_BYTES });
    let pending = '';
    let skipping = false;
    try {
      for await (const chunk of stream) {
        pending += chunk;
        let newline: number;
        while ((newline = pending.indexOf('\n')) !== -1) {
          const line = pending.slice(0, newline);
          pending = pending.slice(newline + 1);
          if (!skipping) {
            try {
              if (!line || Buffer.byteLength(line) > MAX_RECORD_BYTES) throw new Error();
              const event = JSON.parse(line) as DiagnosticEvent;
              if (replacementNames(event, name)) continue;
              if (
                !event ||
                typeof event.id !== 'string' ||
                !Number.isFinite(Date.parse(event.timestamp)) ||
                !DIAGNOSTIC_LEVELS.includes(event.level) ||
                !DIAGNOSTIC_CATEGORIES.includes(event.category)
              )
                throw new Error();
              yield event;
            } catch {
              this.storageError = true;
            }
          }
          skipping = false;
        }
        if (skipping || Buffer.byteLength(pending) > MAX_RECORD_BYTES) {
          pending = '';
          skipping = true;
          this.storageError = true;
        }
      }
      if (pending || skipping) this.storageError = true;
    } catch (error) {
      if (error.code !== 'ENOENT') this.storageError = true;
    } finally {
      stream.destroy();
    }
  }

  async *exportRecords(input: DiagnosticFilter = {}): AsyncGenerator<DiagnosticEvent> {
    const filter = validateDiagnosticFilter(input);
    await this.flush();
    await this.pruning;
    // Pin immutable names until download finishes: retention must not truncate an in-flight export.
    const names = [...this.segments.keys()].sort();
    for (const name of names) this.readers.set(name, (this.readers.get(name) || 0) + 1);
    const fallback = this.fallback.slice();
    const cutoff = new Date(this.now() - this.config.retentionDays * 86400000).toISOString();
    try {
      for (const name of names)
        for await (const event of this.readSegment(name))
          if (event.timestamp >= cutoff && matches(event, filter)) yield event;
      for (const event of fallback) if (event.timestamp >= cutoff && matches(event, filter)) yield event;
    } finally {
      for (const name of names) {
        const remaining = this.readers.get(name) - 1;
        if (remaining) this.readers.set(name, remaining);
        else this.readers.delete(name);
      }
      try {
        if (this.persistent) await this.prune();
      } catch {
        this.storageError = true;
      }
    }
  }

  async query(input: DiagnosticFilter = {}): Promise<{ events: DiagnosticEvent[]; nextCursor: string | null }> {
    const filter = validateDiagnosticFilter(input);
    const cursor = filter.cursor ? decodeCursor(filter.cursor) : undefined;
    const limit = filter.limit || 100;
    const events: DiagnosticEvent[] = [];
    for await (const event of this.exportRecords(filter)) {
      if (cursor && compare(event, cursor) >= 0) continue;
      if (events.length === limit + 1 && compare(event, events[limit]) <= 0) continue;
      events.push(event);
      events.sort((a, b) => compare(b, a));
      if (events.length > limit + 1) events.pop();
    }
    const more = events.length > limit;
    if (more) events.pop();
    const last = events[events.length - 1];
    return {
      events,
      nextCursor: more
        ? Buffer.from(JSON.stringify({ timestamp: last.timestamp, id: last.id })).toString('base64url')
        : null,
    };
  }

  async snapshot() {
    await this.flush();
    try {
      if (this.persistent) await this.prune();
    } catch {
      this.storageError = true;
    }
    const counts = { info: 0, warn: 0, error: 0 };
    const categories: Record<string, number> = {};
    let diskBytes = 0;
    let storedEvents = 0;
    for (const segment of this.segments.values()) {
      diskBytes += segment.bytes;
      storedEvents += segment.count;
      for (const level of DIAGNOSTIC_LEVELS) counts[level] += segment.counts[level] || 0;
      for (const [category, count] of Object.entries(segment.categories))
        categories[category] = (categories[category] || 0) + count;
    }
    for (const event of this.fallback) {
      storedEvents++;
      counts[event.level]++;
      categories[event.category] = (categories[event.category] || 0) + 1;
    }
    return {
      ready: this.ready,
      persistent: this.persistent,
      storageError: this.storageError,
      diskBytes,
      maxDiskBytes: this.config.maxDiskMB * MB,
      retentionDays: this.config.retentionDays,
      storedEvents,
      dropped: this.dropped,
      counts,
      categories,
    };
  }

  updateSettings(input: Partial<Settings>): Promise<Settings> {
    const task = this.settingsWrite.then(() => this.persistSettings(input));
    this.settingsWrite = task.catch(() => undefined);
    return task;
  }

  private async persistSettings(input: Partial<Settings>): Promise<Settings> {
    await this.flush();
    const next = settings(input, this.config);
    const temporary = join(this.dir, `settings-${this.runtimeId}.tmp`);
    try {
      await fs.writeFile(temporary, JSON.stringify(next) + '\n', { mode: 0o600 });
      await fs.rename(temporary, join(this.dir, 'settings.json'));
      this.config = next;
      await this.prune();
      return { ...this.config };
    } catch (error) {
      this.storageError = true;
      await fs.unlink(temporary).catch(() => undefined);
      throw error;
    }
  }
}
