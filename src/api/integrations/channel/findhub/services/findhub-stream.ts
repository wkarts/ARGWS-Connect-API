import type { Request, Response } from 'express';

interface StreamSource {
  snapshot(instanceName: string): Promise<any>;
  subscribe(instanceName: string, listener: (event: any) => void): () => void;
}

/** Existing instance/API-key guards run before this handler. Scope is never provided by the event payload. */
export async function findHubStream(req: Request, res: Response, source: StreamSource): Promise<void> {
  const name = req.params.instanceName;
  let closed = false,
    initialized = false;
  const pending: any[] = [];
  let stop: (() => void) | undefined;
  let heartbeat: NodeJS.Timeout | undefined, expiry: NodeJS.Timeout | undefined;
  const close = () => {
    if (closed) return;
    closed = true;
    stop?.();
    clearInterval(heartbeat);
    clearTimeout(expiry);
    pending.length = 0;
    if (!res.writableEnded) res.end();
  };
  const write = (event: any) => {
    if (closed || res.writableEnded) return;
    if (res.writableLength > 256 * 1024) {
      close();
      return;
    }
    try {
      res.write('event: update\ndata: ' + JSON.stringify(event) + '\n\n');
    } catch {
      close();
    }
  };
  try {
    stop = source.subscribe(name, (event) => {
      if (!initialized) {
        if (pending.length >= 100) close();
        else pending.push(event);
      } else write(event);
    });
    res.on('close', close);
    const snapshot = await source.snapshot(name);
    if (closed || res.destroyed || req.aborted) {
      close();
      return;
    }
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-store, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    write({ event: 'snapshot', data: snapshot });
    initialized = true;
    pending.splice(0).forEach(write);
    heartbeat = setInterval(() => {
      if (closed) return;
      if (res.writableLength > 256 * 1024) {
        close();
        return;
      }
      try {
        res.write(': heartbeat\n\n');
      } catch {
        close();
      }
    }, 15000);
    // Reconnect re-runs authorization and refreshes the snapshot. No API keys in URL or persistent browser storage.
    expiry = setTimeout(close, 120000);
    heartbeat.unref?.();
    expiry.unref?.();
  } catch (error) {
    stop?.();
    clearInterval(heartbeat);
    clearTimeout(expiry);
    if (res.headersSent) close();
    else throw error;
  }
}
