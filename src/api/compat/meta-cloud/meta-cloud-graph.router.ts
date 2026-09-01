import { metaCloudAuthService, metaCloudGraphController, metaCloudIdentityResolver } from '@api/server.module';
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
    this.router.use('/:version', (req, _res, next) => {
      try {
        if (!isMetaGraphVersion(req.params.version)) throw new MetaCloudGraphError(400, 'Invalid Graph API version.');
        this.limiter.assertAllowed(`${req.ip || 'unknown'}:${req.params.version}`);
        metaCloudMetrics.increment('connect_meta_compat_requests_total');
        next();
      } catch (error) {
        this.handleError(error, _res, next);
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
      this.upload.single('file'),
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
    const safe = new MetaCloudGraphError(500, 'Internal provider error.');
    if (res.headersSent) return next(error);
    return res.status(500).json(safe.toBody());
  }
}

// Keep explicit imports alive for dependency-graph visibility and avoid accidental native auth reuse.
void metaCloudAuthService;
void metaCloudIdentityResolver;
