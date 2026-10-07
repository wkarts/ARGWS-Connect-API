import { TranscriptionService, TranscriptionServiceError } from '@api/services/transcription.service';
import { RequestHandler, Response, Router } from 'express';

import { receiveSpeechUpload, speechUploadFailure } from './speech-upload.middleware';

export class TranscriptionRouter {
  public readonly router = Router();

  constructor(
    private readonly service: TranscriptionService,
    guard: RequestHandler,
  ) {
    this.router.use(guard);
    this.router.get('/', (req, res) => void this.list(req, res));
    this.router.get('/health', (req, res) => void this.health(req, res));
    this.router.post('/', (req, res) => void this.create(req, res));
    this.router.post('/cleanup', (req, res) => void this.cleanup(req, res));
    this.router.post(
      '/upload',
      (req, res) => void receiveSpeechUpload(this.service, 'transcription', req, res, () => this.upload(req, res)),
    );
    this.router.get('/:jobId', (req, res) => void this.read(req, res));
    this.router.post('/:jobId/retry', (req, res) => void this.retry(req, res));
    this.router.post('/:jobId/cancel', (req, res) => void this.cancel(req, res));
    this.router.delete('/:jobId', (req, res) => void this.remove(req, res));
  }

  private async list(req: any, res: Response) {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await this.service.list(req.query?.limit));
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async health(_req: any, res: Response) {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await this.service.health());
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async create(req: any, res: Response) {
    try {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const job = await this.service.enqueue({
        messageId: body.messageId,
        language: body.language,
        model: body.model,
        idempotencyKey: req.get('Idempotency-Key') || body.idempotencyKey,
      });
      res.status(202).json(job);
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async upload(req: any, res: Response) {
    try {
      if (req.body?.instanceId && String(req.body.instanceId) !== String(req.speechUploadInstanceId || ''))
        throw new TranscriptionServiceError(
          'Informe X-Speech-Instance-Id antes do corpo para associar o upload a uma instância.',
          400,
        );
      if (!req.file) throw new TranscriptionServiceError('Selecione um arquivo de áudio.', 400);
      const job = await this.service.enqueueUpload({
        filePath: req.file.path,
        reservationId: req.speechReservationId,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        language: req.body?.language,
        model: req.body?.model,
        instanceId: req.speechUploadInstanceId,
        idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey,
      });
      res.status(202).json(job);
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async cleanup(req: any, res: Response) {
    try {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      if (body.confirm !== true) {
        throw new TranscriptionServiceError(
          'A limpeza exige confirm=true para evitar remoção acidental de áudios temporários.',
          400,
        );
      }
      res.set('Cache-Control', 'no-store');
      res.json(
        await this.service.cleanupExpiredUploads({
          olderThanSeconds: body.olderThanSeconds,
          limit: body.limit,
          cursor: typeof body.cursor === 'string' ? body.cursor : undefined,
        }),
      );
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

  private async cancel(req: any, res: Response) {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await this.service.cancel(req.params.jobId));
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async remove(req: any, res: Response) {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await this.service.delete(req.params.jobId));
    } catch (error) {
      this.fail(error, res);
    }
  }

  private fail(error: unknown, res: Response) {
    speechUploadFailure(error, res);
  }
}
