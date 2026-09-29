import { globalAdmin } from '@api/routes/manager-embedding.router';
import { TraccarManagerError, TraccarManagerService } from '@api/services/traccar-manager.service';
import { Response, Router } from 'express';

export class ManagerTraccarRouter {
  public readonly router = Router();

  constructor(private readonly service: TraccarManagerService) {
    this.router.use(globalAdmin);
    this.router.get('/traccar/status', (_req, res) => {
      res.set('Cache-Control', 'no-store');
      res.json({ available: this.service.available() });
    });
    this.router.get('/traccar/overview', (_req, res) => void this.readOverview(res));
  }

  private async readOverview(res: Response): Promise<void> {
    try {
      res.set('Cache-Control', 'no-store');
      res.set('X-Content-Type-Options', 'nosniff');
      res.json(await this.service.overview());
    } catch (error) {
      const known = error instanceof TraccarManagerError;
      res.status(known ? error.status : 503).json({
        error: known ? error.message : 'Traccar interno temporariamente indisponível.',
      });
    }
  }
}
