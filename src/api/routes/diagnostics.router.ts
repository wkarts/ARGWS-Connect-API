import { Auth, configService } from '@config/env.config';
import { timingSafeEqual } from 'crypto';
import { Request, Response, Router } from 'express';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { createGzip } from 'zlib';

import { diagnostics } from '../../diagnostics/diagnostics.service';

type Filter = Record<string, string | number>;
interface DiagnosticsApiService {
  status(): unknown | Promise<unknown>;
  events(filter: Filter): unknown | Promise<unknown>;
  exportRecords(filter: Filter): AsyncIterable<unknown>;
  settings(input: { retentionDays: number; maxDiskMB: number }): unknown | Promise<unknown>;
  record(input: Record<string, unknown>): unknown;
}

const FILTERS = ['from', 'to', 'level', 'category', 'code', 'traceId', 'callId', 'instanceId'];
const CLIENT_KINDS = ['window_error', 'unhandled_rejection', 'vue_error'];
const CLIENT_PAGES = ['calls', 'diagnostics', 'instances', 'login', 'settings', 'unknown'];
const IDENTIFIER = /^[A-Za-z0-9_.:-]{1,128}$/;

/** Private diagnostic facade: only the configured global administrator key is accepted. */
export class DiagnosticsRouter {
  public readonly router = Router();
  private reading = 0;
  private exporting = 0;
  private clientWindow = 0;
  private clientCount = 0;

  constructor(private readonly service: DiagnosticsApiService = diagnostics) {
    this.router.use((req, res, next) => {
      res.set('Cache-Control', 'no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      const expected = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
      const supplied = req.get('apikey');
      if (typeof expected !== 'string' || !expected || !supplied || supplied.length > 4096)
        return res.status(403).json({ error: 'Acesso administrativo necessário.' });
      const expectedBytes = Buffer.from(expected, 'utf8');
      const suppliedBytes = Buffer.from(supplied, 'utf8');
      if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes))
        return res.status(403).json({ error: 'Acesso administrativo necessário.' });
      next();
    });
    this.router.get('/status', (req, res) => this.read(req, res, () => this.service.status(), []));
    this.router.get('/events', (req, res) => this.read(req, res, () => this.service.events(this.filter(req, true))));
    this.router.get('/export', (req, res) => this.export(req, res));
    this.router.put('/settings', (req, res) => this.settings(req, res));
    this.router.post('/client-events', (req, res) => this.clientEvent(req, res));
  }

  private invalid(): never {
    const error = new Error('Parâmetro inválido.');
    error.name = 'DiagnosticValidationError';
    throw error;
  }

  private queryKeys(req: Request, allowed: string[]) {
    if (Object.keys(req.query).some((key) => !allowed.includes(key))) this.invalid();
  }

  private filter(req: Request, pagination: boolean): Filter {
    this.queryKeys(req, [...FILTERS, ...(pagination ? ['cursor', 'limit'] : ['format'])]);
    const result: Filter = {};
    for (const key of [...FILTERS, ...(pagination ? ['cursor', 'limit'] : [])]) {
      const value = req.query[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || !value || value.length > (key === 'cursor' ? 512 : 128)) this.invalid();
      if (key === 'limit') {
        if (!/^\d{1,3}$/.test(value) || Number(value) < 1 || Number(value) > 200) this.invalid();
        result[key] = Number(value);
      } else {
        if (['traceId', 'callId', 'instanceId'].includes(key) && !IDENTIFIER.test(value)) this.invalid();
        result[key] = value;
      }
    }
    return result;
  }

  private reserve(res: Response, exporting = false): (() => void) | null {
    if (this.reading >= 4 || (exporting && this.exporting >= 2)) {
      res.set('Retry-After', '2');
      res.status(429).json({ error: 'Aguarde a consulta anterior.' });
      return null;
    }
    this.reading++;
    if (exporting) this.exporting++;
    let released = false;
    const release = () => {
      if (released) return;
      released = true;
      this.reading--;
      if (exporting) this.exporting--;
    };
    res.once('close', release);
    res.once('finish', release);
    return release;
  }

  private fail(error: unknown, res: Response) {
    if (res.destroyed || res.writableEnded) return;
    if (res.headersSent) return res.destroy();
    const invalid = error instanceof Error && error.name === 'DiagnosticValidationError';
    res.status(invalid ? 400 : 503).json({
      error: invalid ? 'Parâmetro inválido.' : 'Diagnóstico temporariamente indisponível.',
    });
  }

  private async read(req: Request, res: Response, operation: () => unknown, allowed?: string[]) {
    const release = this.reserve(res);
    if (!release) return;
    try {
      if (allowed) this.queryKeys(req, allowed);
      const result = await operation();
      if (!res.destroyed) res.json(result);
    } catch (error) {
      this.fail(error, res);
    } finally {
      release();
    }
  }

  private async settings(req: Request, res: Response) {
    await this.read(
      req,
      res,
      async () => {
        const input = req.body;
        if (!input || typeof input !== 'object' || Array.isArray(input)) this.invalid();
        if (Object.keys(input).some((key) => !['retentionDays', 'maxDiskMB'].includes(key))) this.invalid();
        if (!Number.isInteger(input.retentionDays) || input.retentionDays < 1 || input.retentionDays > 30)
          this.invalid();
        if (!Number.isInteger(input.maxDiskMB) || input.maxDiskMB < 32 || input.maxDiskMB > 512) this.invalid();
        await this.service.settings({ retentionDays: input.retentionDays, maxDiskMB: input.maxDiskMB });
        return this.service.status();
      },
      [],
    );
  }

  private clientEvent(req: Request, res: Response) {
    try {
      this.queryKeys(req, []);
      const input = req.body;
      if (!input || typeof input !== 'object' || Array.isArray(input)) this.invalid();
      if (Object.keys(input).some((key) => !['kind', 'page', 'traceId'].includes(key))) this.invalid();
      if (!CLIENT_KINDS.includes(input.kind) || !CLIENT_PAGES.includes(input.page)) this.invalid();
      if (input.traceId !== undefined && (typeof input.traceId !== 'string' || !IDENTIFIER.test(input.traceId)))
        this.invalid();
      const now = Date.now();
      if (now - this.clientWindow >= 60000) {
        this.clientWindow = now;
        this.clientCount = 0;
      }
      if (this.clientCount >= 60) {
        res.set('Retry-After', '60');
        return res.status(429).json({ error: 'Limite de eventos atingido.' });
      }
      this.clientCount++;
      this.service.record({ code: 'frontend.error', kind: input.kind, page: input.page, traceId: input.traceId });
      res.status(202).json({ accepted: true });
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async export(req: Request, res: Response) {
    const release = this.reserve(res, true);
    if (!release) return;
    let iterator: AsyncIterator<unknown> | undefined;
    let stream: Readable | undefined;
    const started = Date.now();
    let count = 0;
    try {
      const filter = this.filter(req, false);
      const format = req.query.format || 'gzip';
      if (format !== 'jsonl' && format !== 'gzip') this.invalid();
      // Advance before emitting HTTP headers: store validation errors remain clean 400 responses.
      iterator = this.service.exportRecords(filter)[Symbol.asyncIterator]();
      const first = await iterator.next();
      const manifest = {
        type: 'manifest',
        schemaVersion: 1,
        exportedAt: new Date().toISOString(),
        filters: filter,
        diagnostics: await this.service.status(),
      };
      if (res.destroyed) return;
      const records = iterator;
      stream = Readable.from(
        (async function* () {
          yield `${JSON.stringify(manifest)}\n`;
          let item = first;
          while (!item.done) {
            count++;
            yield `${JSON.stringify(item.value)}\n`;
            item = await records.next();
          }
        })(),
      );
      const day = new Date().toISOString().slice(0, 10).replace(/-/g, '');
      res.set('Content-Type', format === 'gzip' ? 'application/gzip' : 'application/x-ndjson; charset=utf-8');
      res.set(
        'Content-Disposition',
        `attachment; filename="connect-diagnostics-${day}.jsonl${format === 'gzip' ? '.gz' : ''}"`,
      );
      if (format === 'gzip') await pipeline(stream, createGzip(), res);
      else await pipeline(stream, res);
      this.service.record({ code: 'diagnostics.exported', format, count, durationMs: Date.now() - started });
    } catch (error) {
      this.fail(error, res);
    } finally {
      stream?.destroy();
      // Close the store reader on completion, transport errors and client aborts.
      try {
        await iterator?.return?.();
      } catch {
        // Storage failure is reported by the store; never return its raw exception to the browser.
      }
      release();
    }
  }
}
