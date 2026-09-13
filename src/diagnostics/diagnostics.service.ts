import { join } from 'node:path';

import { diagnosticContext } from './diagnostic-context';
import { sanitizeDiagnostic } from './diagnostic-sanitizer';
import { DiagnosticStore } from './diagnostic-store';
import { DiagnosticFilter } from './diagnostic-types';

/** Technical metadata only. Never forward arbitrary logger values or HTTP payloads to disk. */
export class DiagnosticsService {
  private readonly startedAt = new Date().toISOString();
  private started?: Promise<void>;
  private sampleTimer?: ReturnType<typeof setInterval>;
  private version = 'unknown';

  constructor(private readonly store: DiagnosticStore) {}

  start(version: string): Promise<void> {
    this.version = /^\d+\.\d+\.\d+(?:[-.][A-Za-z0-9]+)*$/.test(version) ? version : 'unknown';
    this.started ||= this.initialize();
    return this.started;
  }

  private async initialize(): Promise<void> {
    await this.store.init();
    this.record({
      code: 'runtime.started',
      version: this.version,
      nodeVersion: process.version,
      component: 'diagnostics',
    });
    this.sample();
    this.sampleTimer = setInterval(() => this.sample(), 60_000);
    this.sampleTimer.unref();
  }

  private sample(): void {
    const memory = process.memoryUsage();
    const cpu = process.cpuUsage();
    this.record({
      code: 'runtime.sample',
      uptimeSeconds: process.uptime(),
      rssBytes: memory.rss,
      heapUsedBytes: memory.heapUsed,
      heapTotalBytes: memory.heapTotal,
      externalBytes: memory.external,
      cpuUserMicros: cpu.user,
      cpuSystemMicros: cpu.system,
    });
  }

  record(input: any): void {
    try {
      const event = sanitizeDiagnostic({ ...input, traceId: input?.traceId ?? diagnosticContext.getStore()?.traceId });
      if (event) this.store.append(event);
    } catch {
      /* Diagnostics must never interrupt a call, request or application error handler. */
    }
  }

  traceId(): string | undefined {
    return diagnosticContext.getStore()?.traceId;
  }

  callTrace(line: string): void {
    try {
      const prefix = '[ZapoCallTrace] ';
      if (!line.startsWith(prefix)) return;
      const record = JSON.parse(line.slice(prefix.length));
      this.record({
        code: ['state', 'incoming', 'ended'].includes(record.kind) ? 'call.state' : 'call.signaling',
        record,
      });
    } catch {
      /* The strict sanitizer is still applied to every trace. */
    }
  }

  async status() {
    return {
      ...(await this.store.snapshot()),
      schemaVersion: 1,
      service: 'ARGWS Connect API',
      version: this.version,
      startedAt: this.startedAt,
      privacy: 'technical_metadata_only',
    };
  }

  events(filter: DiagnosticFilter) {
    return this.store.query(filter);
  }
  exportRecords(filter: DiagnosticFilter) {
    return this.store.exportRecords(filter);
  }
  async settings(input: { retentionDays?: number; maxDiskMB?: number }) {
    const settings = await this.store.updateSettings(input);
    this.record({
      code: 'diagnostics.settings',
      retentionDays: settings.retentionDays,
      maxStorageMb: settings.maxDiskMB,
    });
    return settings;
  }
  flush() {
    return this.store.flush();
  }
  async stop() {
    clearInterval(this.sampleTimer);
    await this.flush();
  }
}

// The existing instances volume is persistent in the supported container deployment.
// Initialization does not depend on Prisma, a provider session, operations-agent or an env flag.
export const diagnostics = new DiagnosticsService(
  new DiagnosticStore(join(process.cwd(), 'instances', '_diagnostics')),
);
