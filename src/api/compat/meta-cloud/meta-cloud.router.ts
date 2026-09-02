import { authGuard } from '@api/guards/auth.guard';
import { instanceExistsGuard, instanceLoggedGuard } from '@api/guards/instance.guard';
import { metaCloudController } from '@api/server.module';
import { NextFunction, Request, Response, Router } from 'express';

import { MetaCloudGraphError } from './meta-cloud.error';

export class MetaCloudAdminRouter {
  public readonly router = Router();

  constructor() {
    const guards = [instanceExistsGuard, instanceLoggedGuard, authGuard['apikey']];
    this.router.get(
      '/:instanceName/window/:recipient',
      ...guards,
      this.wrap(async (req, res) => {
        res.json(await metaCloudController.inspectWindow(req.params.instanceName, req.params.recipient));
      }),
    );
    this.router.get(
      '/:instanceName',
      ...guards,
      this.wrap(async (req, res) => {
        res.json(await metaCloudController.getCompatibility(req.params.instanceName));
      }),
    );
    this.router.put(
      '/:instanceName',
      ...guards,
      this.wrap(async (req, res) => {
        res.json(await metaCloudController.setCompatibility(req.params.instanceName, req.body || {}));
      }),
    );
  }

  private wrap(handler: (req: Request, res: Response) => Promise<void | Response>) {
    return async (req: Request, res: Response, next: NextFunction) => {
      try {
        await handler(req, res);
      } catch (error) {
        if (error instanceof MetaCloudGraphError) return res.status(error.httpStatus).json(error.toBody());
        return next(error);
      }
    };
  }
}
