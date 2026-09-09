import type { NextFunction, Request, Response } from 'express';
import http from 'http';

let count = 0, errors = 0, durationMs = 0, maxDurationMs = 0, publishing = false, lostBatches = 0;
let timer: NodeJS.Timeout | undefined;
const enabled = () => process.env.OPERATIONS_ENABLED === 'true';

export function operationsTarget(): { url: URL; token: string } | undefined {
  if (!enabled()) return undefined;
  const token = process.env.OPERATIONS_INTERNAL_TOKEN || '';
  if (token.length < 32 || token.startsWith('CHANGE_ME')) return undefined;
  try {
    const url = new URL(process.env.OPERATIONS_AGENT_URL || 'http://operations:8092');
    if (url.protocol !== 'http:' || url.username || url.password) return undefined;
    return { url, token };
  } catch { return undefined; }
}
function publishSummary() {
  if (publishing || (!count && !lostBatches)) return;
  const target = operationsTarget();
  if (!target) return;
  const event = { event: 'http.summary', service: 'api', count, errors, durationMs, maxDurationMs };
  count = errors = durationMs = maxDurationMs = 0;
  publishing = true;
  const payload = JSON.stringify({ events: [event, ...(lostBatches ? [{ event: 'telemetry.gap', service: 'api', count: lostBatches }] : [])] });
  lostBatches = 0;
  let accepted = false;
  const request = http.request(new URL('/events', target.url), { method: 'POST', timeout: 2000,
    headers: { authorization: `Bearer ${target.token}`, 'content-type': 'application/json', 'content-length': Buffer.byteLength(payload) } }, (response) => {
    accepted = response.statusCode === 202;
    response.resume();
    response.once('end', () => { publishing = false; });
  });
  request.once('timeout', () => request.destroy());
  request.once('error', () => { publishing = false; });
  request.once('close', () => { publishing = false; if (!accepted) lostBatches = Math.min(1000000, lostBatches + 1); });
  request.end(payload);
}
/** Aggregate numbers only. Never read request bodies, headers, URL parameters,
 * instance names, telephone identifiers or WhatsApp payloads for telemetry.
 */
export function observeOperations(req: Request, res: Response, next: NextFunction) {
  if (!enabled() || req.path === '/health' || req.path === '/metrics' || req.path.startsWith('/operations')) return next();
  if (!timer) { timer = setInterval(publishSummary, 30000); timer.unref(); }
  const start = Date.now();
  res.once('finish', () => {
    const elapsed = Math.min(3600000, Math.max(0, Date.now() - start));
    count = Math.min(1000000000, count + 1);
    if (res.statusCode >= 500) errors = Math.min(1000000000, errors + 1);
    durationMs = Math.min(Number.MAX_SAFE_INTEGER, durationMs + elapsed);
    maxDurationMs = Math.max(maxDurationMs, elapsed);
  });
  next();
}
