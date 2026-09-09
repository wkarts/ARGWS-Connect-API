import { operationsTarget } from '@api/services/operations.service';
import { Auth, configService } from '@config/env.config';
import { timingSafeEqual } from 'crypto';
import { Request, Response, Router } from 'express';
import http from 'http';

/** Administrative read-only facade. The agent is private to the Docker network;
 * the browser uses this same-origin endpoint and never receives its token.
 */
export class OperationsRouter {
  public readonly router = Router();
  private reading = 0;
  constructor() {
    this.router.use((req, res, next) => {
      const expected = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
      const supplied = req.get('apikey') || '';
      res.set('Cache-Control', 'no-store');
      if (typeof expected !== 'string' || !expected || !supplied)
        return res.status(403).json({ error: 'Acesso administrativo necessário.' });
      // Compare the configured API key directly; no password hash is stored.
      // timingSafeEqual requires equal byte lengths, not equal string lengths.
      const expectedBytes = Buffer.from(expected, 'utf8');
      const suppliedBytes = Buffer.from(supplied, 'utf8');
      if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes))
        return res.status(403).json({ error: 'Acesso administrativo necessário.' });
      next();
    });
    this.router.get('/snapshot', (req, res) => this.forward('/snapshot', req, res));
    this.router.get('/history', (req, res) => this.forward('/history', req, res));
    this.router.get('/archives', (req, res) => this.forward('/archives', req, res));
    this.router.get('/export', (req, res) => this.forward('/export', req, res));
  }
  private forward(endpoint: string, req: Request, res: Response) {
    const target = operationsTarget();
    if (!target)
      return res
        .status(503)
        .json({ enabled: false, error: 'Monitoramento operacional não habilitado nesta instalação.' });
    if (this.reading >= 4) return res.status(429).json({ error: 'Aguarde a consulta anterior.' });
    const url = new URL(endpoint, target.url);
    const allowed =
      endpoint === '/history' ? ['from', 'to', 'cursor', 'limit'] : endpoint === '/export' ? ['day', 'format'] : [];
    for (const key of allowed) {
      const value = req.query[key];
      if (value === undefined) continue;
      if (typeof value !== 'string' || value.length > 256)
        return res.status(400).json({ error: 'Parâmetro inválido.' });
      url.searchParams.set(key, value);
    }
    this.reading++;
    let done = false;
    const release = () => {
      if (!done) {
        done = true;
        this.reading--;
      }
    };
    const upstream = http.get(
      url,
      { headers: { authorization: `Bearer ${target.token}` }, timeout: 15000 },
      (response) => {
        res.status(response.statusCode || 502);
        res.set('Content-Type', response.headers['content-type'] || 'application/json');
        if (response.headers['content-disposition'])
          res.set('Content-Disposition', response.headers['content-disposition']);
        response.on('error', () => {
          res.destroy();
          release();
        });
        response.pipe(res);
      },
    );
    upstream.once('timeout', () => upstream.destroy());
    upstream.once('error', () => {
      if (!res.headersSent) res.status(503).json({ error: 'Serviço operacional indisponível.' });
      else res.destroy();
      release();
    });
    res.once('close', () => {
      upstream.destroy();
      release();
    });
    res.once('finish', release);
  }
}
