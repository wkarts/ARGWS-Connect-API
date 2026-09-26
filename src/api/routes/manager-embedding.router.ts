import { ManagerEmbeddingError, ManagerEmbeddingService } from '@api/services/manager-embedding.service';
import { Auth, configService } from '@config/env.config';
import { timingSafeEqual } from 'crypto';
import { Request, Response, Router } from 'express';

function globalAdmin(req: Request, res: Response, next: () => void) {
  const expected = configService.get<Auth>('AUTHENTICATION').API_KEY.KEY;
  const supplied = req.get('apikey') || '';
  res.set('Cache-Control', 'no-store');
  res.set('X-Content-Type-Options', 'nosniff');
  if (typeof expected !== 'string' || !expected || !supplied || supplied.length > 4096) {
    return res.status(403).json({ error: 'Acesso administrativo necessário.' });
  }
  const expectedBytes = Buffer.from(expected, 'utf8');
  const suppliedBytes = Buffer.from(supplied, 'utf8');
  if (expectedBytes.length !== suppliedBytes.length || !timingSafeEqual(expectedBytes, suppliedBytes)) {
    return res.status(403).json({ error: 'Acesso administrativo necessário.' });
  }
  next();
}

export class ManagerEmbeddingRouter {
  public readonly router = Router();

  constructor(private readonly service: ManagerEmbeddingService) {
    this.router.use(globalAdmin);
    this.router.get('/embedding', (_req, res) => this.read(res));
    this.router.put('/embedding', (req, res) => this.save(req, res));
  }

  private fail(error: unknown, res: Response) {
    const known = error instanceof ManagerEmbeddingError;
    res.status(known ? error.status : 503).json({
      error: known ? error.message : 'Configuração de iframe temporariamente indisponível.',
    });
  }

  private async read(res: Response) {
    try {
      res.json(await this.service.settings());
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async save(req: Request, res: Response) {
    try {
      const input = req.body;
      if (!input || typeof input !== 'object' || Array.isArray(input)) {
        throw new ManagerEmbeddingError('Configuração de iframe inválida.');
      }
      const allowed = ['version', 'enabled', 'allowedOrigins'];
      if (Object.keys(input).some((key) => !allowed.includes(key))) {
        throw new ManagerEmbeddingError('Configuração de iframe contém campos não reconhecidos.');
      }
      res.json(
        await this.service.save({
          version: input.version,
          enabled: input.enabled,
          allowedOrigins: input.allowedOrigins,
        }),
      );
    } catch (error) {
      this.fail(error, res);
    }
  }
}
