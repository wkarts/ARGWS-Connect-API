import { metaCloudGraphController } from '@api/server.module';
import { NextFunction, Request, Response, Router } from 'express';
import multer from 'multer';

import { MetaCloudGraphError } from './meta-cloud.error';
import { metaCloudMetrics } from './meta-cloud.metrics';
import { MetaCloudRateLimiter } from './meta-cloud-rate-limiter';
import { isMetaGraphVersion } from './meta-cloud-version';

export class MetaCloudGraphRouter {
  public readonly router = Router();
  private readonly upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 100 * 1024 * 1024 } });
  private readonly limiter = new MetaCloudRateLimiter();

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

    this.router.get(
      '/:version/:businessAccountId/message_templates',
      this.wrap(async (req, res) => {
        res.json(
          await metaCloudGraphController.listTemplates(
            req.params.version,
            req.params.businessAccountId,
            req.headers.authorization,
          ),
        );
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
    if ([400, 401, 404, 409].includes(status)) {
      const graphError = new MetaCloudGraphError(
        status,
        this.safeNativeMessage(error, status),
        status === 401 ? 190 : 100,
        status === 401 ? 'OAuthException' : 'GraphMethodException',
      );
      return res.status(status).json(graphError.toBody());
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
