import { globalAdmin } from '@api/routes/manager-embedding.router';
import { ManagerStorageError, ManagerStorageService } from '@api/services/manager-storage.service';
import { Request, Response, Router } from 'express';

export class ManagerStorageRouter {
  public readonly router = Router();

  constructor(private readonly service: ManagerStorageService) {
    this.router.use(globalAdmin);
    this.router.get('/storage/overview', (req, res) => void this.overview(req, res));
    this.router.post('/storage/cleanup/preview', (req, res) => void this.preview(req, res));
    this.router.post('/storage/cleanup', (req, res) => void this.cleanup(req, res));
  }

  private async overview(req: Request, res: Response) {
    try {
      const instanceId = String(req.query.instanceId || '').trim() || undefined;
      res.set('Cache-Control', 'no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      res.json(await this.service.overview(instanceId));
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async preview(req: Request, res: Response) {
    try {
      res.set('Cache-Control', 'no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      res.json(await this.service.cleanupPreview(req.body || {}));
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async cleanup(req: Request, res: Response) {
    try {
      res.set('Cache-Control', 'no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      res.json(await this.service.cleanup(req.body || {}));
    } catch (error) {
      this.fail(error, res);
    }
  }

  private fail(error: unknown, res: Response) {
    const known = error instanceof ManagerStorageError;
    res.status(known ? error.status : 503).json({
      error: known ? error.message : 'Armazenamento temporariamente indisponível.',
    });
  }
}
