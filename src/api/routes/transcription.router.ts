import { TranscriptionService, TranscriptionServiceError } from '@api/services/transcription.service';
import { RequestHandler, Response, Router } from 'express';

export class TranscriptionRouter {
  public readonly router = Router();

  constructor(private readonly service: TranscriptionService, guard: RequestHandler) {
    this.router.use(guard);
    this.router.post('/', (req, res) => void this.create(req, res));
    this.router.get('/:jobId', (req, res) => void this.read(req, res));
    this.router.post('/:jobId/retry', (req, res) => void this.retry(req, res));
  }

  private async create(req: any, res: Response) {
    try {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const job = await this.service.enqueue({
        messageId: body.messageId,
        language: body.language,
        model: body.model,
      });
      res.status(202).json(job);
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async read(req: any, res: Response) {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await this.service.get(req.params.jobId));
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async retry(req: any, res: Response) {
    try {
      res.status(202).json(await this.service.retry(req.params.jobId));
    } catch (error) {
      this.fail(error, res);
    }
  }

  private fail(error: unknown, res: Response) {
    const known = error instanceof TranscriptionServiceError;
    const status = known ? error.status : 503;
    res.status(status).json({
      status,
      error: known ? error.message : 'Serviço de transcrição temporariamente indisponível.',
    });
  }
}
