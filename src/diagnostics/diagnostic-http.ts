import { randomUUID } from 'node:crypto';

import { NextFunction, Request, Response } from 'express';

import { diagnosticContext } from './diagnostic-context';
import { diagnostics } from './diagnostics.service';

const PREFIXES = new Set([
  'call',
  'instance',
  'message',
  'chat',
  'group',
  'business',
  'localTemplate',
  'template',
  'settings',
  'proxy',
  'label',
  'webhook',
  'graph',
  'compat',
  'integrations',
  'storage',
]);

export function createDiagnosticObserver(sink: Pick<typeof diagnostics, 'record'> = diagnostics) {
  return (req: Request, res: Response, next: NextFunction) => {
    const traceId = randomUUID();
    const started = performance.now();
    const prefix = req.path.split('/')[1];
    // Polling the diagnostics screen must not fill its own history. No URL is retained.
    const skip = ['diagnostics', 'operations', 'health', 'metrics', 'manager', 'store'].includes(prefix);
    let finished = false;
    res.setHeader('X-Request-Id', traceId);
    const complete = (aborted: boolean) => {
      if (finished) return;
      finished = true;
      if (skip && res.statusCode < 400 && !aborted) return;
      const template = typeof req.route?.path === 'string' ? req.route.path : '/unknown';
      const route = `${PREFIXES.has(prefix) ? `/${prefix}` : ''}${template}`;
      sink.record({
        code: 'http.request',
        traceId,
        method: req.method,
        route,
        status: res.statusCode,
        durationMs: performance.now() - started,
        aborted,
      });
    };
    res.once('finish', () => complete(false));
    res.once('close', () => complete(!res.writableFinished));
    diagnosticContext.run({ traceId }, next);
  };
}

export const observeDiagnostics = createDiagnosticObserver();
