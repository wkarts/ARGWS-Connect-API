import { TranscriptionService, TranscriptionServiceError } from '@api/services/transcription.service';
import { RequestHandler, Response, Router } from 'express';

import { receiveSpeechUpload, speechUploadFailure } from './speech-upload.middleware';

export class SpeechRouter {
  public readonly router = Router({ mergeParams: true });

  constructor(
    private readonly service: TranscriptionService,
    guard: RequestHandler,
  ) {
    this.router.use(guard);
    this.router.use(async (req: any, res, next) => {
      try {
        if (req.params.instanceName)
          req.speechInstanceId = await this.service.resolveInstanceName(req.params.instanceName);
        next();
      } catch (error) {
        this.fail(error, res);
      }
    });
    this.router.get('/live', (_req, res) => res.set('Cache-Control', 'no-store').json({ status: 'alive' }));
    this.router.get('/ready', (req, res) => void this.ready(req, res));
    this.router.get('/health', (req, res) => void this.health(req, res));
    this.router.get('/models', (req, res) => void this.models(req, res));
    this.router.post('/models/:modelId/activate', (req, res) => void this.activateModel(req, res));
    this.router.post('/models/:modelId/download', (req, res) => void this.downloadModel(req, res));

    this.router.post(
      '/dictation',
      (req, res) => void receiveSpeechUpload(this.service, 'dictation', req, res, () => this.dictate(req, res)),
    );
    this.router.get('/dictation/:jobId', (req, res) => void this.readDictation(req, res));
    this.router.post('/dictation/:jobId/cancel', (req, res) => void this.cancel(req, res, 'dictation'));

    this.router.get('/transcriptions', (req, res) => void this.list(req, res));
    this.router.post('/transcriptions', (req, res) => {
      const contentType = String(req.headers['content-type'] || '').toLowerCase();
      if (contentType.startsWith('multipart/form-data')) {
        void receiveSpeechUpload(this.service, 'transcription', req, res, () => this.upload(req, res));
      } else {
        void this.createFromMessage(req, res);
      }
    });
    this.router.post(
      '/transcriptions/upload',
      (req, res) => void receiveSpeechUpload(this.service, 'transcription', req, res, () => this.upload(req, res)),
    );
    this.router.get('/transcriptions/:jobId', (req, res) => void this.read(req, res));
    this.router.post('/transcriptions/:jobId/cancel', (req, res) => void this.cancel(req, res, 'transcription'));
    this.router.post('/transcriptions/:jobId/retry', (req, res) => void this.retry(req, res, 'transcription'));
    this.router.delete('/transcriptions/:jobId', (req, res) => void this.remove(req, res, 'transcription'));
  }

  private async dictate(req: any, res: Response) {
    try {
      if (!req.file) throw new TranscriptionServiceError('Grave uma fala antes de iniciar o ditado.', 400);
      const job = await this.service.enqueueDictation({
        filePath: req.file.path,
        reservationId: req.speechReservationId,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        language: req.body?.language,
        model: req.body?.model,
        instanceId: this.uploadInstanceId(req),
        durationMs: req.body?.durationMs,
        idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey,
      });
      res.status(202).set('Cache-Control', 'no-store').json({ id: job.id, status: job.status, mode: job.mode });
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async upload(req: any, res: Response) {
    try {
      if (!req.file) throw new TranscriptionServiceError('Selecione um arquivo de áudio.', 400);
      const job = await this.service.enqueueUpload({
        filePath: req.file.path,
        reservationId: req.speechReservationId,
        fileName: req.file.originalname,
        mimeType: req.file.mimetype,
        language: req.body?.language,
        model: req.body?.model,
        instanceId: this.uploadInstanceId(req),
        idempotencyKey: req.get('Idempotency-Key') || req.body?.idempotencyKey,
      });
      res.status(202).set('Cache-Control', 'no-store').json(job);
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async createFromMessage(req: any, res: Response) {
    try {
      const body = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
      const job = await this.service.enqueue({
        messageId: body.messageId,
        instanceId: this.instanceId(req, body.instanceId),
        language: body.language,
        model: body.model,
        idempotencyKey: req.get('Idempotency-Key') || body.idempotencyKey,
      });
      res.status(202).set('Cache-Control', 'no-store').json(job);
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async list(req: any, res: Response) {
    try {
      res.set('Cache-Control', 'no-store');
      res.json(await this.service.list(req.query?.limit, 'transcription', req.speechInstanceId));
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async read(req: any, res: Response) {
    try {
      res.set('Cache-Control', 'no-store');
      const job = await this.service.get(req.params.jobId, req.speechInstanceId);
      if (job.mode !== 'transcription') throw new TranscriptionServiceError('Transcrição não encontrada.', 404);
      res.json(job);
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async readDictation(req: any, res: Response) {
    try {
      res.set('Cache-Control', 'no-store');
      const job = await this.service.get(req.params.jobId, req.speechInstanceId);
      if (job.mode !== 'dictation') throw new TranscriptionServiceError('Ditado não encontrado.', 404);
      res.json(job);
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async cancel(req: any, res: Response, mode?: 'dictation' | 'transcription') {
    try {
      res.set('Cache-Control', 'no-store');
      if (mode && (await this.service.get(req.params.jobId, req.speechInstanceId)).mode !== mode) {
        throw new TranscriptionServiceError('Job de voz não encontrado.', 404);
      }
      res.json(await this.service.cancel(req.params.jobId, req.speechInstanceId));
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async retry(req: any, res: Response, mode: 'transcription' = 'transcription') {
    try {
      if ((await this.service.get(req.params.jobId, req.speechInstanceId)).mode !== mode) {
        throw new TranscriptionServiceError('Transcrição não encontrada.', 404);
      }
      res.status(202).json(await this.service.retry(req.params.jobId, req.speechInstanceId));
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async remove(req: any, res: Response, mode: 'transcription' = 'transcription') {
    try {
      res.set('Cache-Control', 'no-store');
      if ((await this.service.get(req.params.jobId, req.speechInstanceId)).mode !== mode) {
        throw new TranscriptionServiceError('Transcrição não encontrada.', 404);
      }
      res.json(await this.service.delete(req.params.jobId, req.speechInstanceId));
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async ready(req: any, res: Response) {
    try {
      const health = await this.service.health(req.speechInstanceId);
      const requestedMode = String(req.query?.mode || 'all');
      if (!['all', 'dictation', 'transcription'].includes(requestedMode))
        throw new TranscriptionServiceError('mode inválido.', 400);
      const ready =
        health.enabled &&
        (requestedMode === 'dictation'
          ? health.dictationWorkerReady
          : requestedMode === 'transcription'
            ? health.workerReady
            : health.workerReady && (!this.service.isDictationEnabled() || health.dictationWorkerReady));
      res
        .set('Cache-Control', 'no-store')
        .status(ready ? 200 : 503)
        .json({ status: ready ? 'ready' : 'not_ready', ...health });
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async health(req: any, res: Response) {
    try {
      res.set('Cache-Control', 'no-store').json(await this.service.health(req.speechInstanceId));
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async models(req: any, res: Response) {
    try {
      const [health, modelDownload] = await Promise.all([
        this.service.health(req.speechInstanceId),
        this.service.modelDownloadStatus(),
      ]);
      const id = String(health.model || 'Xenova/whisper-small');
      res.set('Cache-Control', 'no-store').json({
        provider: health.provider,
        models: [
          {
            id,
            name: id.split('/').pop(),
            language: process.env.SPEECH_LANGUAGE || 'pt-BR',
            status: modelDownload.status,
            downloadAvailable: modelDownload.available,
            installed: modelDownload.installed,
            progressPercent: modelDownload.progressPercent,
            downloadedBytes: modelDownload.downloadedBytes,
            totalBytes: modelDownload.totalBytes,
            errorMessage: modelDownload.errorMessage,
            revision: modelDownload.revision,
            workerReady: health.workerReady || health.dictationWorkerReady,
            active: true,
          },
        ],
      });
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async activateModel(req: any, res: Response) {
    try {
      this.requireAdministration(req);
      const health = await this.service.health(req.speechInstanceId);
      if (String(req.params.modelId) !== String(health.model)) {
        throw new TranscriptionServiceError(
          'Somente o modelo já configurado e provisionado pode ser ativado. Altere SPEECH_MODEL e reinicie os workers.',
          409,
        );
      }
      res
        .set('Cache-Control', 'no-store')
        .json({ id: health.model, active: true, ready: health.workerReady || health.dictationWorkerReady });
    } catch (error) {
      this.fail(error, res);
    }
  }

  private async downloadModel(req: any, res: Response) {
    try {
      this.requireAdministration(req);
      const status = await this.service.downloadModel(String(req.params.modelId || ''), req.body?.force === true);
      res
        .set('Cache-Control', 'no-store')
        .status(status.installed ? 200 : 202)
        .json(status);
    } catch (error) {
      this.fail(error, res);
    }
  }

  private uploadInstanceId(req: any): string | undefined {
    const admitted = req.speechUploadInstanceId;
    if (req.body?.instanceId && String(req.body.instanceId) !== String(admitted || '')) {
      throw new TranscriptionServiceError(
        'Para associar o upload a uma instância, use a rota /instances/:instanceName ou X-Speech-Instance-Id antes do corpo.',
        400,
      );
    }
    return admitted;
  }

  private instanceId(req: any, supplied?: unknown): string | undefined {
    if (req.speechInstanceId) {
      if (supplied && String(supplied) !== req.speechInstanceId)
        throw new TranscriptionServiceError('O escopo informado diverge da instância autenticada.', 403);
      return req.speechInstanceId;
    }
    return supplied ? String(supplied) : undefined;
  }

  private requireAdministration(req: any) {
    if (req.speechInstanceId)
      throw new TranscriptionServiceError('A administração de modelos exige a credencial global.', 403);
  }

  private fail(error: unknown, res: Response) {
    speechUploadFailure(error, res);
  }
}
