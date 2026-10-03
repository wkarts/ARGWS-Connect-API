import { TranscriptionService, TranscriptionServiceError } from '@api/services/transcription.service';
import { RequestHandler, Response, Router } from 'express';
import multer from 'multer';

function uploadLimit(): number {
  const value = Number.parseInt(process.env.TRANSCRIPTION_MAX_AUDIO_BYTES || '', 10);
  return Number.isFinite(value) ? Math.min(Math.max(value, 1), 250 * 1024 * 1024) : 25 * 1024 * 1024;
}

const uploadAudio = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: uploadLimit(), files: 1 },
});

export class TranscriptionRouter {
  public readonly router = Router();

  constructor(
    private readonly service: TranscriptionService,
    guard: RequestHandler,
  ) {
    this.router.use(guard);
    this.router.get('/', (req, res) => void this.list(req, res));
    this.router.post('/', (req, res) => void this.create(req, res));
    this.router.post('/upload', (req, res) => {
      uploadAudio.single('audio')(req, res, (error: any) => {
        if (error) {
          const status = error?.code === 'LIMIT_FILE_SIZE' ? 413 : 400;
          res.status(status).json({ status, error: status === 413 ? 'O áudio excede o limite configurado.' : 'Upload de áudio inválido.' });
          return;
        }
        void this.upload(req, res);
      });
    });
    this.router.get('/:jobId', (req, res) => void this.read(req, res));
    this.router.post('/:jobId/retry', (req, res) => void this.retry(req, res));
  }

  private async list(req: any, res: Response) {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await this.service.list(req.query?.limit));
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async create(req: any, res: Response) {
    try {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const job = await this.service.enqueue({ messageId: body.messageId, language: body.language, model: body.model });
      res.status(202).json(job);
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async upload(req: any, res: Response) {
    try {
      if (!req.file) throw new TranscriptionServiceError('Selecione um arquivo de áudio.', 400);
      const job = await this.service.enqueueUpload({
        buffer: req.file.buffer,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        language: req.body?.language,
        model: req.body?.model,
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
