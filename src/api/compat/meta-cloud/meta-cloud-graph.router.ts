import { metaCloudGraphController } from '@api/server.module';
import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';
import { pipeline } from 'stream/promises';

import { MetaCloudGraphError } from './meta-cloud.error';
import { metaCloudMetrics } from './meta-cloud.metrics';
import { MetaCloudRateLimiter } from './meta-cloud-rate-limiter';
import { isMetaGraphVersion } from './meta-cloud-version';

function transcriptionUploadLimit(): number {
  const value = Number.parseInt(process.env.TRANSCRIPTION_MAX_AUDIO_BYTES || '', 10);
  return Number.isFinite(value) ? Math.min(Math.max(value, 1), 250 * 1024 * 1024) : 25 * 1024 * 1024;
}

function graphPhoneNumberId(value: unknown): string {
  const digits = String(value || '').replace(/\D/g, '');
  if (!/^\d{8,15}$/.test(digits)) {
    throw new MetaCloudGraphError(400, 'phoneNumberId must contain 8 to 15 digits.');
  }
  return digits;
}

function boundedQueryInteger(value: unknown, fallback: number, maximum: number): number {
  const parsed = Number.parseInt(String(value || ''), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(Math.max(parsed, 1), maximum);
}

export class MetaCloudGraphRouter {
  public readonly router = Router();
  private readonly upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
  private readonly transcriptionUpload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: transcriptionUploadLimit(), files: 1 },
  });
  private readonly limiter = new MetaCloudRateLimiter();
  private readonly mediaContentPath = '/:version/:mediaId/content';

  constructor() {
    this.router.use('/:version', (req, res, next) => {
      try {
        if (!isMetaGraphVersion(req.params.version)) throw new MetaCloudGraphError(400, 'Invalid Graph API version.');
        this.limiter.assertAllowed(`${req.ip || 'unknown'}:${req.params.version}`);
        metaCloudMetrics.increment('connect_meta_compat_requests_total');
        next();
      } catch (error) {
        this.handleError(error, res, next);
      }
    });

    this.router.post(
      '/:version/:phoneNumberId/messages',
      this.wrap(async (req, res) => {
        res.json(
          await metaCloudGraphController.send(
            req.params.version,
            req.params.phoneNumberId,
            req.headers.authorization,
            req.body,
          ),
        );
      }),
    );

    this.router.post(
      '/:version/:phoneNumberId/media',
      (req, res, next) => this.mediaUpload(req, res, next),
      this.wrap(async (req, res) => {
        res.json(
          await metaCloudGraphController.upload(
            req.params.version,
            req.params.phoneNumberId,
            req.headers.authorization,
            (req as any).file,
            req.body?.type,
          ),
        );
      }),
    );

    this.router.post(
      '/:version/:phoneNumberId/status',
      (req, res, next) => this.statusUploadMiddleware(req, res, next),
      this.wrap(async (req, res) => {
        res.json(
          await metaCloudGraphController.publishStatus(
            req.params.version,
            req.params.phoneNumberId,
            req.headers.authorization,
            req.body,
            this.uploadedFile(req, ['file', 'media']),
          ),
        );
      }),
    );

    this.router.get(
      '/:version/:phoneNumberId/statuses',
      this.wrap(async (req, res) => {
        res.set('Cache-Control', 'no-store');
        const phoneNumberId = graphPhoneNumberId(req.params.phoneNumberId);
        res.json(
          await metaCloudGraphController.listStatuses(req.params.version, phoneNumberId, req.headers.authorization, {
            page: boundedQueryInteger(req.query.page, 1, 10000),
            limit: boundedQueryInteger(req.query.limit, 50, 500),
          }),
        );
      }),
    );

    this.router.delete(
      '/:version/:phoneNumberId/statuses/:statusId',
      this.wrap(async (req, res) => {
        const phoneNumberId = graphPhoneNumberId(req.params.phoneNumberId);
        res.json(
          await metaCloudGraphController.deleteStatus(
            req.params.version,
            phoneNumberId,
            req.headers.authorization,
            req.params.statusId,
          ),
        );
      }),
    );

    this.router.post(
      '/:version/:phoneNumberId/transcriptions',
      (req, res, next) => this.transcriptionUploadMiddleware(req, res, next),
      this.wrap(async (req, res) => {
        res
          .status(202)
          .json(
            await metaCloudGraphController.transcribe(
              req.params.version,
              req.params.phoneNumberId,
              req.headers.authorization,
              req.body,
              this.uploadedFile(req, ['audio', 'file']),
            ),
          );
      }),
    );

    this.router.post(
      '/:version/:phoneNumberId/transcriptions/:jobId/retry',
      this.wrap(async (req, res) => {
        res
          .status(202)
          .json(
            await metaCloudGraphController.retryTranscription(
              req.params.version,
              req.params.phoneNumberId,
              req.headers.authorization,
              req.params.jobId,
            ),
          );
      }),
    );

    this.router.get(
      '/:version/:phoneNumberId/transcriptions/:jobId',
      this.wrap(async (req, res) => {
        res.json(
          await metaCloudGraphController.getTranscription(
            req.params.version,
            req.params.phoneNumberId,
            req.headers.authorization,
            req.params.jobId,
          ),
        );
      }),
    );

    this.router.delete(
      '/:version/:phoneNumberId/transcriptions/:jobId',
      this.wrap(async (req, res) => {
        res.json(
          await metaCloudGraphController.deleteTranscription(
            req.params.version,
            req.params.phoneNumberId,
            req.headers.authorization,
            req.params.jobId,
          ),
        );
      }),
    );

    this.router.get(
      '/:version/:businessAccountId/message_templates',
      this.wrap(async (req, res) => {
        res.set('Cache-Control', 'no-store');
        res.json(
          await metaCloudGraphController.listTemplates(
            req.params.version,
            req.params.businessAccountId,
            req.headers.authorization,
            req.query,
          ),
        );
      }),
    );

    // Internal transport for the temporary URL returned by the documented
    // media descriptor. Keep it out of generated OpenAPI: consumers still use
    // GET /:mediaId and follow its opaque temporary `url`, as in Meta Cloud.
    this.router.get(
      this.mediaContentPath,
      this.wrap(async (req, res) => {
        const token = typeof req.query.token === 'string' ? req.query.token : undefined;
        const media = await metaCloudGraphController.downloadMedia(req.params.mediaId, token);
        const safeName = String(media.fileName || 'media.bin').replace(/["\r\n]/g, '_');

        res.setHeader('Content-Type', media.mimetype || 'application/octet-stream');
        res.setHeader('Content-Disposition', `inline; filename="${safeName}"`);
        res.setHeader('Cache-Control', 'private, max-age=300');
        await pipeline(media.stream, res);
      }),
    );

    this.router.get(
      '/:version/:mediaId',
      this.wrap(async (req, res) => {
        res.json(
          await metaCloudGraphController.getMedia(req.params.version, req.params.mediaId, req.headers.authorization),
        );
      }),
    );
  }

  private mediaUpload(req: Request, res: Response, next: NextFunction) {
    this.upload.single('file')(req, res, (error: any) => {
      if (!error) return next();
      const message =
        error?.code === 'LIMIT_FILE_SIZE'
          ? 'Media file exceeds the 100 MB compatibility limit.'
          : 'Invalid multipart media payload.';
      return this.handleError(new MetaCloudGraphError(400, message), res, next);
    });
  }

  private statusUploadMiddleware(req: Request, res: Response, next: NextFunction) {
    this.upload.fields([
      { name: 'file', maxCount: 1 },
      { name: 'media', maxCount: 1 },
    ])(req, res, (error: any) => {
      if (!error) return next();
      const message =
        error?.code === 'LIMIT_FILE_SIZE'
          ? 'Status media file exceeds the 100 MB compatibility limit.'
          : 'Invalid multipart status payload.';
      return this.handleError(new MetaCloudGraphError(400, message), res, next);
    });
  }

  private transcriptionUploadMiddleware(req: Request, res: Response, next: NextFunction) {
    this.transcriptionUpload.fields([
      { name: 'audio', maxCount: 1 },
      { name: 'file', maxCount: 1 },
    ])(req, res, (error: any) => {
      if (!error) return next();
      const message =
        error?.code === 'LIMIT_FILE_SIZE'
          ? 'Audio file exceeds the configured transcription limit.'
          : 'Invalid multipart transcription payload.';
      return this.handleError(new MetaCloudGraphError(400, message), res, next);
    });
  }

  private uploadedFile(req: Request, names: string[]) {
    const files = (req as any).files as Record<string, any[]> | undefined;
    for (const name of names) {
      const file = files?.[name]?.[0];
      if (file) return file;
    }
    return undefined;
  }

  private wrap(handler: (req: Request, res: Response) => Promise<void | Response>) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        await handler(req, res);
      } catch (error) {
        this.handleError(error, res, next);
      }
    };
  }

  private handleError(error: any, res: Response, next: NextFunction) {
    if (error instanceof MetaCloudGraphError) return res.status(error.httpStatus).json(error.toBody());
    if (res.headersSent) return next(error);

    const status = Number(error?.status);
    if ([400, 401, 404, 409, 413, 415, 422].includes(status)) {
      const graphStatus = [413, 415, 422].includes(status) ? 400 : status;
      const graphError = new MetaCloudGraphError(
        graphStatus,
        this.safeNativeMessage(error, status),
        status === 401 ? 190 : 100,
        status === 401 ? 'OAuthException' : 'GraphMethodException',
      );
      return res.status(graphStatus).json(graphError.toBody());
    }

    const safe = new MetaCloudGraphError(500, 'Internal provider error.');
    return res.status(500).json(safe.toBody());
  }

  private safeNativeMessage(error: any, status: number): string {
    const raw = error?.message;
    if (typeof raw === 'string' && raw.trim()) return raw.trim().slice(0, 500);
    if (Array.isArray(raw)) {
      const text = raw
        .flat(2)
        .map((item) => (typeof item === 'string' ? item : item?.message))
        .filter((item) => typeof item === 'string' && item.trim())
        .join('; ');
      if (text) return text.slice(0, 500);
    }

    if (status === 401) return 'Invalid OAuth access token.';
    if (status === 404) return 'Requested Graph resource was not found.';
    if (status === 409) return 'WhatsApp instance is disconnected.';
    return 'Invalid Graph API request.';
  }
}
